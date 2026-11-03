import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MfaEnrollment, totpEnrollment } from '../../src/services/api/backend/mfaEnrollment.ts';
import { BackendSession } from '../../src/services/api/backend/session.ts';
import { BackendTransport } from '../../src/services/api/backend/transport.ts';
import { text } from '../../src/services/api/backend/decoders.ts';

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const now = Date.parse('2026-11-04T10:00:00Z');
const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const data = () => ({ factorId: id, sharedSecret: secret, expiresAt: new Date(now + 600000).toISOString() });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  let listener, time = now, creates = 0, verifies = 0;
  const port = {
    identity: () => ({ userId: id, sessionId: id, assurance: 'AAL1' }),
    subscribe: value => { listener = value; return () => { listener = undefined; }; },
    createTotpEnrollment: async () => { creates++; return { data: data() }; },
    verifyTotpEnrollment: async () => { verifies++; return port.identity(); },
    ...overrides,
  };
  const enrollment = new MfaEnrollment(port, () => time); enrollment.connect(); enrollment.setActive(true);
  return { enrollment, identity: value => listener?.(value), time: value => { time = value; }, counts: () => ({ creates, verifies }) };
}

test('enrollment decoder bounds setup keys and ignores provisioning links', () => {
  assert.deepEqual(totpEnrollment({ ...data(), provisioningUri: 'https://untrusted.invalid' }), data());
  for (const sharedSecret of ['', 'secret', 'A'.repeat(129), 'JBSWY3DP=']) assert.throws(() => totpEnrollment({ ...data(), sharedSecret }));
});

test('enrollment stays memory-only, hides setup key on background and consumes the code once', async () => {
  const f = fixture();
  try {
    await Promise.all([f.enrollment.start('Primary'), f.enrollment.start('Duplicate')]);
    assert.equal(f.counts().creates, 1); assert.equal(f.enrollment.getSnapshot().sharedSecret, secret);
    f.enrollment.setActive(false); assert.equal(f.enrollment.getSnapshot().sharedSecret, undefined);
    f.enrollment.setActive(true);
    await Promise.all([f.enrollment.verify('123456'), f.enrollment.verify('123456')]);
    assert.equal(f.counts().verifies, 1); assert.equal(f.enrollment.getSnapshot().status, 'complete');
    assert.equal(JSON.stringify(f.enrollment.getSnapshot()).includes(secret), false);
  } finally { f.enrollment.dispose(); }
});

test('session replacement and cancelled setup reject a late enrollment response', async () => {
  for (const change of ['identity', 'background', 'cancel']) {
    const gate = deferred(); const f = fixture({ createTotpEnrollment: () => gate.promise });
    try {
      const start = f.enrollment.start('Primary');
      if (change === 'identity') f.identity({ userId: other, sessionId: other, assurance: 'AAL1' });
      if (change === 'background') f.enrollment.setActive(false);
      if (change === 'cancel') f.enrollment.cancel();
      gate.resolve({ data: data() }); await start;
      assert.equal(f.enrollment.getSnapshot().sharedSecret, undefined);
      assert.notEqual(f.enrollment.getSnapshot().status, 'pending');
    } finally { f.enrollment.dispose(); }
  }
});

test('expiry and clock rollback forbid enrollment verification and discard its key', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  try {
    await f.enrollment.start('Primary'); t.mock.timers.tick(600000);
    assert.equal(f.enrollment.getSnapshot().status, 'error'); assert.equal(f.enrollment.getSnapshot().sharedSecret, undefined);
    await f.enrollment.start('Primary'); f.time(now - 1); await f.enrollment.verify('123456');
    assert.equal(f.counts().verifies, 0); assert.equal(f.enrollment.getSnapshot().sharedSecret, undefined);
  } finally { f.enrollment.dispose(); }
});

test('ambiguous verification never replays or reports success, including background cancellation', async () => {
  for (const background of [false, true]) {
    let calls = 0; const gate = deferred();
    const f = fixture({ verifyTotpEnrollment: async () => { calls++; if (background) await gate.promise; else throw new Error('lost response'); } });
    try {
      await f.enrollment.start('Primary'); const verify = f.enrollment.verify('123456');
      if (background) { f.enrollment.setActive(false); gate.resolve(); }
      await verify; f.enrollment.setActive(true); await f.enrollment.verify('123456'); await f.enrollment.start('Another');
      assert.equal(calls, 1); assert.equal(f.counts().creates, 1);
      assert.equal(f.enrollment.getSnapshot().status, 'unknown'); assert.equal(f.enrollment.getSnapshot().sharedSecret, undefined);
    } finally { f.enrollment.dispose(); }
  }
});

test('enrollment access upgrade validates identity and keeps refresh credentials untouched', async () => {
  for (const sessionId of [id, other]) {
    let saved; const current = { userId: id, sessionId: id, assurance: 'AAL1', accessToken: 'old.access',
      accessTokenExpiresAt: new Date(now + 3600000).toISOString(), refreshToken: 'synthetic-refresh-credential-enrollment-0001',
      refreshTokenExpiresAt: new Date(now + 86400000).toISOString() };
    const session = new BackendSession(new BackendTransport({ origin: 'https://api.example.test', fetch: async url => Response.json({
      data: url.endsWith('/otp-verifications') ? current : { userId: id, sessionId, assurance: 'AAL2', accessToken: 'new.access', accessTokenExpiresAt: current.accessTokenExpiresAt },
      meta: { requestId: id },
    }) }), { read: async () => null, write: async value => { saved = value; }, clear: async () => { saved = null; } }, () => now);
    await session.verifyOtp(id, '123456'); const original = structuredClone(saved);
    if (sessionId === id) assert.equal((await session.verifyTotpEnrollment(id, '123456')).assurance, 'AAL2');
    else { await assert.rejects(session.verifyTotpEnrollment(id, '123456'), { code: 'CLIENT.INVALID_RESPONSE' }); assert.equal(session.identity().assurance, 'AAL1'); }
    assert.deepEqual(saved, original);
  }
});

test('late enrollment upgrades preserve concurrent refresh successors and honor cancellation during rotation', async () => {
  for (const cancel of [false, true]) {
    const verification = deferred(), rotating = deferred(), successor = deferred();
    let saved, time = now, sent = 0;
    const current = { userId: id, sessionId: id, assurance: 'AAL1', accessToken: 'old.access',
      accessTokenExpiresAt: new Date(now + 60000).toISOString(), refreshToken: 'synthetic-refresh-credential-enrollment-0001',
      refreshTokenExpiresAt: new Date(now + 86400000).toISOString() };
    const next = { ...current, accessToken: 'rotated.access', accessTokenExpiresAt: new Date(now + 600000).toISOString(),
      refreshToken: 'synthetic-refresh-credential-enrollment-0002' };
    const success = data => Response.json({ data, meta: { requestId: id } });
    const session = new BackendSession(new BackendTransport({ origin: 'https://api.example.test', fetch: async (url, options) => {
      if (url.endsWith('/otp-verifications')) return success(current);
      if (url.endsWith('/verification')) { sent++; return verification.promise; }
      if (url.endsWith('/tokens/refresh')) { rotating.resolve(); return successor.promise; }
      return success(new Headers(options.headers).get('authorization'));
    } }), { read: async () => null, write: async value => { saved = value; }, clear: async () => { saved = null; } }, () => time);
    await session.verifyOtp(id, '123456');
    const abort = new AbortController();
    const upgrade = session.verifyTotpEnrollment(id, '123456', abort.signal);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(sent, 1);
    time += 40000;
    const request = session.request({ path: '/api/v1/test', decode: text });
    await rotating.promise;
    verification.resolve(success({ userId: id, sessionId: id, assurance: 'AAL2', accessToken: 'upgraded.access', accessTokenExpiresAt: next.accessTokenExpiresAt }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(session.identity().assurance, 'AAL1');
    if (cancel) abort.abort();
    const checked = cancel ? assert.rejects(upgrade, { code: 'CLIENT.CANCELLED' }) : upgrade;
    successor.resolve(success(next));
    await Promise.all([checked, request]);
    assert.equal(saved.refreshToken, next.refreshToken);
    assert.equal(session.identity().assurance, cancel ? 'AAL1' : 'AAL2');
    assert.equal((await session.request({ path: '/api/v1/test', decode: text })).data,
      cancel ? 'Bearer rotated.access' : 'Bearer upgraded.access');
    assert.equal(sent, 1);
  }
});

test('effect reconnect fences old cleanup and foreground checks expired enrollment immediately', async () => {
  const f = fixture();
  try {
    const old = f.enrollment.connect(); f.enrollment.setActive(true);
    await f.enrollment.start('Old effect');
    const current = f.enrollment.connect(); old();
    assert.equal(f.enrollment.getSnapshot().sharedSecret, undefined);
    let updates = 0; const unsubscribe = f.enrollment.subscribe(() => { updates++; });
    await f.enrollment.start('Current effect');
    assert.equal(f.enrollment.getSnapshot().sharedSecret, secret);
    f.enrollment.setActive(false); f.time(now + 600001); f.enrollment.setActive(true);
    assert.equal(f.enrollment.getSnapshot().status, 'error');
    await f.enrollment.verify('123456'); assert.equal(f.counts().verifies, 0);
    assert.ok(updates > 0); unsubscribe(); current();
  } finally { f.enrollment.dispose(); }
});

test('listener cancellation fences enrollment dispatch and its expiry timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  try {
    const stop = f.enrollment.subscribe(() => {
      if (f.enrollment.getSnapshot().status === 'starting') f.enrollment.cancel();
    });
    await f.enrollment.start('Cancelled'); assert.equal(f.counts().creates, 0); stop();
    const hide = f.enrollment.subscribe(() => {
      if (f.enrollment.getSnapshot().status === 'pending') f.enrollment.cancel();
    });
    await f.enrollment.start('Closed'); hide();
    t.mock.timers.tick(600001);
    assert.equal(f.enrollment.getSnapshot().status, 'idle');
  } finally { f.enrollment.dispose(); }
});
