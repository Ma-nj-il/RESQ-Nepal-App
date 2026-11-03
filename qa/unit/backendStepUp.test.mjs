import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MfaStepUp } from '../../src/services/api/backend/mfaStepUp.ts';
import { BackendError } from '../../src/services/api/backend/errors.ts';

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const now = Date.parse('2026-11-04T10:00:00Z');
const challenge = { challengeId: other, nextStep: 'TOTP', expiresAt: new Date(now + 300000).toISOString() };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const error = (code, status, retryAfterSeconds) => new BackendError({ code, status, retryAfterSeconds, message: 'Rejected' });

function fixture(overrides = {}) {
  let identity = { userId: id, sessionId: id, assurance: 'AAL1' }, clock = now;
  const listeners = new Set(), calls = [];
  const port = {
    identity: () => identity,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    beginStepUp: async signal => { calls.push({ operation: 'start', signal }); return { data: challenge }; },
    verifyStepUp: async (challengeId, code, signal) => { calls.push({ operation: 'verify', challengeId, code, signal }); return { ...identity, assurance: 'AAL2' }; },
    ...overrides,
  };
  const stepUp = new MfaStepUp(port, () => clock); stepUp.connect(); stepUp.setActive(true);
  return { stepUp, calls, time: value => { clock = value; }, identity: value => { identity = value; for (const listener of listeners) listener(value); } };
}

test('step-up snapshots contain only the challenge and coalesce duplicate starts and verification', async () => {
  const f = fixture(), snapshots = [];
  f.stepUp.subscribe(() => snapshots.push(JSON.stringify(f.stepUp.getSnapshot())));
  try {
    await Promise.all([f.stepUp.start(), f.stepUp.start()]);
    assert.equal(f.calls.length, 1); assert.deepEqual(f.stepUp.getSnapshot().challenge, challenge);
    await f.stepUp.verify('bad'); assert.equal(f.calls.length, 1);
    await Promise.all([f.stepUp.verify('123456'), f.stepUp.verify('123456')]);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].challengeId, other);
    assert.equal(f.stepUp.getSnapshot().status, 'complete');
    assert.equal(f.stepUp.getSnapshot().challenge, undefined);
    assert.ok(snapshots.every(value => !value.includes('123456')));
  } finally { f.stepUp.dispose(); }
});

test('step-up preserves idle challenges across authenticator app switching but never dispatches while inactive', async () => {
  const f = fixture();
  try {
    await f.stepUp.start(); f.stepUp.setActive(false);
    await f.stepUp.verify('123456'); assert.equal(f.calls.length, 1);
    assert.deepEqual(f.stepUp.getSnapshot().challenge, challenge);
    f.stepUp.setActive(true); await f.stepUp.verify('123456');
    assert.equal(f.stepUp.getSnapshot().status, 'complete');
  } finally { f.stepUp.dispose(); }
});

test('expiry timers and foreground rollback checks prevent challenge dispatch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  try {
    await f.stepUp.start(); t.mock.timers.tick(300000);
    assert.equal(f.stepUp.getSnapshot().status, 'error');
    await f.stepUp.verify('123456'); assert.equal(f.calls.length, 1);
    await f.stepUp.start(); f.stepUp.setActive(false); f.time(now - 1); f.stepUp.setActive(true);
    assert.equal(f.stepUp.getSnapshot().challenge, undefined);
    await f.stepUp.verify('123456'); assert.equal(f.calls.length, 2);
  } finally { f.stepUp.dispose(); }
});

test('expired, excessive-lifetime and malformed step-up challenges are rejected', async () => {
  for (const data of [{ ...challenge, expiresAt: new Date(now).toISOString() },
    { ...challenge, expiresAt: new Date(now + 3600001).toISOString() },
    { ...challenge, nextStep: 'PASSWORD' }, { ...challenge, challengeId: 'invalid' }]) {
    const f = fixture({ beginStepUp: async () => ({ data }) });
    try {
      await f.stepUp.start();
      assert.equal(f.stepUp.getSnapshot().status, 'error');
      assert.equal(f.stepUp.getSnapshot().challenge, undefined);
    } finally { f.stepUp.dispose(); }
  }
});

test('session replacement, logout, background and close fence late step-up challenges', async () => {
  for (const change of ['replacement', 'logout', 'background', 'cancel', 'dispose']) {
    const gate = deferred(); let signal;
    const f = fixture({ beginStepUp: value => { signal = value; return gate.promise; } });
    try {
      const starting = f.stepUp.start();
      if (change === 'replacement') f.identity({ userId: id, sessionId: other, assurance: 'AAL1' });
      if (change === 'logout') f.identity(null);
      if (change === 'background') f.stepUp.setActive(false);
      if (change === 'cancel') f.stepUp.cancel();
      if (change === 'dispose') f.stepUp.dispose();
      assert.equal(signal.aborted, true);
      gate.resolve({ data: challenge }); await starting;
      assert.equal(f.stepUp.getSnapshot().challenge, undefined);
      assert.notEqual(f.stepUp.getSnapshot().status, 'pending');
    } finally { f.stepUp.dispose(); }
  }
});

test('unknown step-up outcomes never replay and background abort cannot report success', async () => {
  for (const background of [false, true]) {
    const gate = deferred(); let signal, attempts = 0;
    const f = fixture({ verifyStepUp: async (_id, _code, value) => {
      attempts++; signal = value;
      if (background) await gate.promise; else throw new Error('lost response');
    } });
    try {
      await f.stepUp.start(); const verifying = f.stepUp.verify('123456');
      if (background) { f.stepUp.setActive(false); assert.equal(signal.aborted, true); gate.resolve(); }
      await verifying; f.stepUp.setActive(true);
      await f.stepUp.start(); await f.stepUp.verify('123456');
      assert.equal(attempts, 1);
      assert.equal(f.stepUp.getSnapshot().status, 'unknown');
      assert.equal(f.stepUp.getSnapshot().challenge, undefined);
      f.stepUp.cancel(); await f.stepUp.start();
      assert.equal(f.stepUp.getSnapshot().status, 'pending');
    } finally { f.stepUp.dispose(); }
  }
});

test('definitive code rejection keeps the challenge; Retry-After survives close and blocks restart', async () => {
  let rejection = error('AUTH.MFA_INVALID', 401), attempts = 0;
  const f = fixture({ verifyStepUp: async () => { attempts++; throw rejection; } });
  try {
    await f.stepUp.start(); await f.stepUp.verify('123456');
    assert.equal(f.stepUp.getSnapshot().status, 'pending');
    rejection = error('RATE_LIMIT.EXCEEDED', 429, 120); await f.stepUp.verify('123456');
    await f.stepUp.verify('bad'); await f.stepUp.verify('123456');
    assert.equal(attempts, 2);
    f.stepUp.cancel(); await f.stepUp.start(); assert.equal(f.calls.length, 1);
    f.time(now + 120000); await f.stepUp.start(); assert.equal(f.calls.length, 2);
    rejection = error('AUTH.MFA_ATTEMPTS_EXCEEDED', 429); await f.stepUp.verify('123456');
    assert.equal(f.stepUp.getSnapshot().status, 'error');
    assert.equal(f.stepUp.getSnapshot().challenge, undefined);
  } finally { f.stepUp.dispose(); }
});

test('session rotation preserves challenge ownership while replacement clears completed verification', async () => {
  const f = fixture();
  try {
    await f.stepUp.start(); f.identity({ userId: id, sessionId: id, assurance: 'AAL2' });
    assert.deepEqual(f.stepUp.getSnapshot().challenge, challenge);
    await f.stepUp.verify('123456');
    f.identity({ userId: other, sessionId: other, assurance: 'AAL1' });
    assert.equal(f.stepUp.getSnapshot().status, 'idle');
  } finally { f.stepUp.dispose(); }
});

test('effect reconnect and synchronous subscriber cancellation fence dispatch and expiry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  try {
    const old = f.stepUp.connect(), current = f.stepUp.connect(); old(); f.stepUp.setActive(true);
    const cancelStart = f.stepUp.subscribe(() => { if (f.stepUp.getSnapshot().status === 'starting') f.stepUp.cancel(); });
    await f.stepUp.start(); assert.equal(f.calls.length, 0); cancelStart();
    await f.stepUp.start();
    const cancelVerify = f.stepUp.subscribe(() => { if (f.stepUp.getSnapshot().status === 'verifying') f.stepUp.cancel(); });
    await f.stepUp.verify('123456'); assert.equal(f.calls.length, 1); cancelVerify();
    t.mock.timers.tick(300001); assert.equal(f.stepUp.getSnapshot().status, 'idle');
    await f.stepUp.start(); assert.equal(f.calls.length, 2); current();
    await f.stepUp.start(); assert.equal(f.calls.length, 2);
  } finally { f.stepUp.dispose(); }
});
