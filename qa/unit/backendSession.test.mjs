import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackendTransport } from '../../src/services/api/backend/transport.ts';
import { BackendSession } from '../../src/services/api/backend/session.ts';
import { refreshCredentials, text } from '../../src/services/api/backend/decoders.ts';
import { createRequesterApi } from '../../src/services/api/backend/requester.ts';

const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const now = Date.parse('2026-11-03T10:00:00Z');
const future = '2026-11-04T10:00:00Z';
const sessionData = (suffix = 'first', overrides = {}) => ({
  userId: id, sessionId: id, assurance: 'AAL1', accessToken: `synthetic.access.${suffix}`,
  accessTokenExpiresAt: future, refreshToken: `synthetic-refresh-for-unit-test-${suffix}`, refreshTokenExpiresAt: future,
  ...overrides,
});
const success = (data, init) => Response.json({ data, meta: { requestId: id } }, init);
const failure = (code, status = 401) => Response.json({
  error: { code, message: 'Request rejected.', retryable: false }, meta: { requestId: id },
}, { status });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture(handler, initialSession = sessionData()) {
  const calls = [];
  const vault = {
    value: null,
    async read() { return this.value; },
    async write(value) { this.value = structuredClone(value); },
    async clear() { this.value = null; },
  };
  const transport = new BackendTransport({
    origin: 'https://api.example.test',
    fetch: async (url, init) => {
      const call = { path: new URL(url).pathname, query: new URL(url).searchParams, ...init };
      calls.push(call);
      if (call.path.endsWith('/otp-verifications')) return success(initialSession, { status: 201 });
      if (call.path.endsWith('/sessions/current')) return new Response(null, { status: 204 });
      return handler(call, vault);
    },
  });
  const session = new BackendSession(transport, vault, () => now);
  return { session, vault, calls, transport, login: () => session.verifyOtp(id, '123456') };
}

const read = { path: '/api/v1/me', decode: text };

test('MFA step-up replaces access token without changing or exposing refresh credentials', async () => {
  const f = fixture(async (call) => {
    if (call.path.endsWith('/mfa-challenges')) return success({ challengeId: otherId, nextStep: 'TOTP', expiresAt: future });
    if (call.path.endsWith('/verifications')) return success({ userId: id, sessionId: id, assurance: 'AAL2', accessToken: 'synthetic.stepup', accessTokenExpiresAt: future });
    assert.equal(call.headers.Authorization, 'Bearer synthetic.stepup');
    return success('ok');
  });
  await f.login();
  const original = structuredClone(f.vault.value);
  const challenge = await f.session.beginStepUp();
  assert.equal(challenge.data.challengeId, otherId);
  assert.deepEqual(await f.session.verifyStepUp(otherId, '123456'), { userId: id, sessionId: id, assurance: 'AAL2' });
  assert.deepEqual(f.vault.value, original);
  assert.equal((await f.session.request(read)).data, 'ok');
});

test('late MFA success after logout cannot resurrect authentication', async () => {
  const entered = deferred(), response = deferred();
  const f = fixture(async () => { entered.resolve(); return response.promise; });
  await f.login();
  const verification = f.session.verifyStepUp(otherId, '123456');
  await entered.promise;
  await f.session.logout();
  response.resolve(success({ userId: id, sessionId: id, assurance: 'AAL2', accessToken: 'synthetic.stepup', accessTokenExpiresAt: future }));
  await assert.rejects(verification, { code: 'CLIENT.SESSION_CHANGED' });
  assert.equal(f.session.identity(), null);
  assert.equal(f.vault.value, null);
});

test('MFA rejects another session and never retries an ambiguous verification', async () => {
  const f = fixture(async () => success({ userId: id, sessionId: otherId, assurance: 'AAL2', accessToken: 'synthetic.stepup', accessTokenExpiresAt: future }));
  await f.login();
  await assert.rejects(f.session.verifyStepUp(otherId, '123456'), { code: 'CLIENT.INVALID_RESPONSE' });
  assert.equal(f.session.identity().assurance, 'AAL1');
  let calls = 0;
  const lost = fixture(async () => { calls++; throw new Error('lost after verification'); });
  await lost.login();
  await assert.rejects(lost.session.verifyStepUp(otherId, '123456'), { code: 'CLIENT.NETWORK_ERROR' });
  assert.equal(calls, 1);
});

test('MFA waits for an older refresh so its successor credential is retained with AAL2', async () => {
  const entered = deferred(), verification = deferred(), refreshing = deferred(), rotated = deferred();
  const f = fixture(async (call) => {
    if (call.path.endsWith('/verifications')) { entered.resolve(); return verification.promise; }
    if (call.path.endsWith('/refresh')) { refreshing.resolve(); return rotated.promise; }
    if (call.headers.Authorization.endsWith('.first')) return failure('AUTH.ACCESS_TOKEN_EXPIRED');
    return success('ok');
  });
  await f.login();
  const stepUp = f.session.verifyStepUp(otherId, '123456');
  await entered.promise;
  const request = f.session.request(read);
  await refreshing.promise;
  verification.resolve(success({ userId: id, sessionId: id, assurance: 'AAL2', accessToken: 'synthetic.stepup', accessTokenExpiresAt: future }));
  rotated.resolve(success(sessionData('next')));
  await Promise.all([stepUp, request]);
  assert.equal(f.session.identity().assurance, 'AAL2');
  assert.equal(f.vault.value.refreshToken, sessionData('next').refreshToken);
  await f.session.request(read);
  assert.equal(f.calls.at(-1).headers.Authorization, 'Bearer synthetic.stepup');
});

test('parallel access-token expiry rotates once and publishes only persisted successor credentials', async () => {
  let rotations = 0;
  const entered = deferred(), release = deferred();
  const f = fixture(async (call, vault) => {
    if (call.path.endsWith('/refresh')) {
      rotations++;
      assert.equal(vault.value, null, 'consumed token must be removed before dispatch');
      entered.resolve();
      await release.promise;
      return success(sessionData('next'));
    }
    assert.equal(call.headers.Authorization, 'Bearer synthetic.access.next');
    assert.equal(vault.value.refreshToken, 'synthetic-refresh-for-unit-test-next');
    return success('ok');
  }, sessionData('first', { accessTokenExpiresAt: '2026-11-03T10:00:05Z' }));
  await f.login();
  const requests = Array.from({ length: 12 }, () => f.session.request(read));
  await entered.promise;
  release.resolve();
  assert.equal((await Promise.all(requests)).length, 12);
  assert.equal(rotations, 1);
  assert.deepEqual(Object.keys(f.vault.value).sort(), ['refreshToken', 'refreshTokenExpiresAt', 'sessionId', 'userId']);
  assert.deepEqual(f.session.identity(), { userId: id, sessionId: id, assurance: 'AAL1' });
});

test('late 401 from an older access token reuses the successor without another rotation', async () => {
  let rotations = 0, oldCalls = 0;
  const late = deferred(), bothEntered = deferred();
  const f = fixture(async (call) => {
    if (call.path.endsWith('/refresh')) { rotations++; return success(sessionData('next')); }
    if (call.headers.Authorization.endsWith('.first')) {
      if (++oldCalls === 2) { bothEntered.resolve(); return late.promise; }
      await bothEntered.promise;
      return failure('AUTH.ACCESS_TOKEN_EXPIRED');
    }
    return success('ok');
  });
  await f.login();
  const first = f.session.request(read), second = f.session.request(read);
  assert.equal((await first).data, 'ok');
  late.resolve(failure('AUTH.ACCESS_TOKEN_EXPIRED'));
  assert.equal((await second).data, 'ok');
  assert.equal(rotations, 1);
});

test('rotation response loss clears the session and is never retried or restored', async () => {
  let rotations = 0;
  const f = fixture(async (call) => {
    if (call.path.endsWith('/refresh')) { rotations++; throw new Error('response lost after commit'); }
    return failure('AUTH.ACCESS_TOKEN_EXPIRED');
  });
  await f.login();
  await assert.rejects(f.session.request(read), { code: 'CLIENT.NETWORK_ERROR' });
  assert.equal(f.vault.value, null);
  assert.equal(f.session.identity(), null);
  await assert.rejects(f.session.request(read), { code: 'AUTH.AUTHENTICATION_REQUIRED' });
  assert.equal(await new BackendSession(f.transport, f.vault, () => now).restore(), null);
  assert.equal(rotations, 1);
});

test('logout during refresh cannot resurrect state or persist a late successor', async () => {
  const entered = deferred(), response = deferred();
  const f = fixture(async (call) => {
    if (call.path.endsWith('/refresh')) { entered.resolve(); return response.promise; }
    return failure('AUTH.ACCESS_TOKEN_EXPIRED');
  });
  await f.login();
  const pending = assert.rejects(f.session.request(read), { code: 'CLIENT.SESSION_CHANGED' });
  await entered.promise;
  assert.deepEqual(await f.session.logout(), { remoteRevocation: 'CONFIRMED' });
  response.resolve(success(sessionData('next')));
  await pending;
  assert.equal(f.session.identity(), null);
  assert.equal(f.vault.value, null);
});

test('logout serializes vault clearing behind an already-started successor write', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture(async (call) => call.path.endsWith('/refresh')
    ? success(sessionData('next')) : failure('AUTH.ACCESS_TOKEN_EXPIRED'));
  await f.login();
  f.vault.write = async (value) => { entered.resolve(); await release.promise; f.vault.value = value; };
  const pending = assert.rejects(f.session.request(read), { code: 'CLIENT.SESSION_CHANGED' });
  await entered.promise;
  const logout = f.session.logout();
  assert.equal(f.session.identity(), null);
  release.resolve();
  await Promise.all([pending, logout]);
  assert.equal(f.vault.value, null);
});

test('secure-storage failure prevents refresh dispatch', async () => {
  let rotations = 0;
  const f = fixture(async (call) => {
    if (call.path.endsWith('/refresh')) { rotations++; return success(sessionData('next')); }
    return failure('AUTH.ACCESS_TOKEN_EXPIRED');
  });
  await f.login();
  f.vault.clear = async () => { throw new Error('native storage failure'); };
  await assert.rejects(f.session.request(read), { code: 'CLIENT.SECURE_STORAGE_UNAVAILABLE' });
  assert.equal(f.session.identity(), null);
  assert.equal(rotations, 0);
});

test('restore is single-flight and never exposes stored credentials as authenticated state', async () => {
  let rotations = 0;
  const entered = deferred(), release = deferred();
  const f = fixture(async () => {
    rotations++; entered.resolve(); await release.promise; return success(sessionData('next'));
  });
  f.vault.value = refreshCredentials(sessionData());
  const first = f.session.restore(), second = f.session.restore();
  await entered.promise;
  assert.equal(f.session.identity(), null);
  release.resolve();
  assert.deepEqual(await first, await second);
  assert.equal(rotations, 1);
});

test('refresh cannot change identity or reuse the same refresh token', async () => {
  for (const data of [sessionData('next', { userId: otherId }), sessionData()]) {
    const f = fixture(async (call) => call.path.endsWith('/refresh')
      ? success(data) : failure('AUTH.ACCESS_TOKEN_EXPIRED'));
    await f.login();
    await assert.rejects(f.session.request(read), { code: 'CLIENT.INVALID_RESPONSE' });
    assert.equal(f.vault.value, null);
    assert.equal(f.session.identity(), null);
  }
});

test('revocation clears authentication; permission/precondition failures do not', async () => {
  for (const [code, status, authenticated] of [
    ['AUTH.SESSION_REVOKED', 401, false], ['ACCESS.STEP_UP_REQUIRED', 403, true],
    ['REQUEST.STALE_VERSION', 409, true], ['REQUEST.PRECONDITION_REQUIRED', 428, true],
  ]) {
    const f = fixture(async () => failure(code, status));
    await f.login();
    await assert.rejects(f.session.request(read), { code, status });
    assert.equal(f.session.identity() !== null, authenticated);
    assert.equal(f.calls.filter((call) => call.path.endsWith('/refresh')).length, 0);
  }
});

test('a second auth rejection stops after one refresh', async () => {
  let rotations = 0, attempts = 0;
  const f = fixture(async (call) => {
    if (call.path.endsWith('/refresh')) { rotations++; return success(sessionData('next')); }
    attempts++; return failure('AUTH.ACCESS_TOKEN_EXPIRED');
  });
  await f.login();
  await assert.rejects(f.session.request(read), { code: 'AUTH.ACCESS_TOKEN_EXPIRED' });
  assert.equal(attempts, 2);
  assert.equal(rotations, 1);
  assert.equal(f.vault.value, null);
});

test('commands keep their exact original body, key and precondition across guard rejection', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture(async (call) => {
    if (call.path.endsWith('/refresh')) { entered.resolve(); await release.promise; return success(sessionData('next')); }
    return call.headers.Authorization.endsWith('.first') ? failure('AUTH.ACCESS_TOKEN_EXPIRED') : success('ok');
  });
  await f.login();
  const body = { message: 'original' };
  const input = { path: '/api/v1/support/tickets', method: 'POST', decode: text, body,
    idempotencyKey: 'same-command-intent', expectedVersion: 3 };
  const pending = f.session.request(input);
  await entered.promise;
  body.message = 'edited'; input.idempotencyKey = 'different-intent-key'; input.expectedVersion = 4;
  release.resolve();
  await pending;
  const calls = f.calls.filter((call) => call.path.endsWith('/support/tickets'));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[1].headers['Idempotency-Key'], 'same-command-intent');
  assert.equal(calls[1].headers['If-Match'], '"3"');
});

test('cancelling one waiter does not cancel a shared refresh for other requests', async () => {
  const entered = deferred(), release = deferred(), controller = new AbortController();
  const f = fixture(async (call) => {
    if (call.path.endsWith('/refresh')) { entered.resolve(); await release.promise; return success(sessionData('next')); }
    return success('ok');
  }, sessionData('first', { accessTokenExpiresAt: '2026-11-03T10:00:05Z' }));
  await f.login();
  const cancelled = assert.rejects(f.session.request({ ...read, signal: controller.signal }), { code: 'CLIENT.CANCELLED' });
  const active = f.session.request(read);
  await entered.promise;
  controller.abort(); release.resolve();
  await cancelled;
  assert.equal((await active).data, 'ok');
  assert.ok(f.session.identity());
});

test('product adapter uses self routes, version-zero creation, bounded cursor, and natural mark-read', async () => {
  const defaults = { bookingUpdates: true, tripUpdates: true, supportUpdates: true, marketing: false };
  const f = fixture(async (call) => {
    if (call.path.endsWith('/notification-preferences')) return success({ ...defaults, version: 1 });
    if (call.path.endsWith('/read')) return success({ id, read: true });
    return success({ items: [], nextAfterId: null });
  });
  await f.login();
  const api = createRequesterApi(f.session);
  await api.replacePreferences(defaults, { idempotencyKey: 'preferences-intent-1', expectedVersion: 0 });
  await api.notifications(otherId);
  await api.markRead(id);
  const [, put, list, mark] = f.calls;
  assert.equal(put.headers['If-Match'], '"0"');
  assert.deepEqual(JSON.parse(put.body), defaults);
  assert.equal(list.query.get('afterId'), otherId);
  assert.equal(mark.method, 'PUT');
  assert.equal(mark.headers['Idempotency-Key'], undefined);
  assert.equal(mark.headers['If-Match'], undefined);
  assert.ok(f.calls.every((call) => call.headers['x-tenant-id'] === undefined));
});

test('pre-cancelled session requests do not consume stored refresh credentials', async () => {
  const f = fixture(async () => { throw new Error('Unexpected network call'); });
  f.vault.value = refreshCredentials(sessionData());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.session.request({ ...read, signal: controller.signal }), { code: 'CLIENT.CANCELLED' });
  assert.equal(f.calls.length, 0);
  assert.ok(f.vault.value);
});

test('an ordinary command network failure neither refreshes nor replays the mutation', async () => {
  const f = fixture(async () => { throw new Error('response lost'); });
  await f.login();
  await assert.rejects(createRequesterApi(f.session).createTicket({ category: 'ACCOUNT', message: 'Help' }, 'ticket-intent-key-1'),
    { code: 'CLIENT.NETWORK_ERROR' });
  assert.equal(f.calls.length, 2); // OTP verification and one product attempt.
  assert.ok(f.session.identity());
});

test('logout reports an unconfirmed server revocation while still clearing local state', async () => {
  const f = fixture(async () => success('ok'));
  await f.login();
  const offline = new BackendTransport({ origin: 'https://api.example.test', fetch: async (url) => {
    if (url.endsWith('/refresh')) return success(sessionData('restored'));
    throw new Error('offline');
  } });
  const session = new BackendSession(offline, f.vault, () => now);
  await session.restore();
  await assert.rejects(session.logout(), { code: 'CLIENT.NETWORK_ERROR' });
  assert.equal(session.identity(), null);
  assert.equal(f.vault.value, null);
  assert.deepEqual(await session.logout(), { remoteRevocation: 'NOT_ATTEMPTED' });
});

test('OTP challenge acceptance is distinct from delivery and verification explicitly requests MOBILE tokens', async () => {
  const f = fixture(async (call) => {
    assert.deepEqual(JSON.parse(call.body), { phoneNumber: '+9779800000000', purpose: 'REGISTRATION_OR_LOGIN' });
    assert.equal(call.headers.Authorization, undefined);
    return success({ challengeId: id, expiresAt: future, deliveryState: 'ACCEPTED' }, { status: 202 });
  });
  const challenge = await f.session.requestOtp('+9779800000000');
  assert.equal(challenge.data.deliveryState, 'ACCEPTED');
  assert.equal(f.session.identity(), null);
  await f.login();
  assert.deepEqual(JSON.parse(f.calls[1].body), { challengeId: id, otp: '123456', clientType: 'MOBILE' });
});
