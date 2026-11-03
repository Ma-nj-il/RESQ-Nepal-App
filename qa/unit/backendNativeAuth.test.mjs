import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecureRefreshVault, refreshVaultKey } from '../../src/services/api/backend/secureRefreshVault.ts';
import { resolveBackendPreview } from '../../src/services/api/backend/previewConfig.ts';
import { getNativeBackendRuntime } from '../../src/services/api/backend/nativeRuntime.ts';
import { createBackendAuthController } from '../../src/services/api/backend/authController.ts';
import { BackendSession } from '../../src/services/api/backend/session.ts';
import { BackendTransport } from '../../src/services/api/backend/transport.ts';
import { refreshCredentials, text } from '../../src/services/api/backend/decoders.ts';

const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const scope = { origin: 'https://api.example.test', environment: 'test' };
const startTime = Date.parse('2026-11-03T10:00:00Z');
const future = '2026-11-04T10:00:00Z';
const phone = '+9779800000000';
const tokens = (suffix = 'first') => ({
  userId: id, sessionId: id, assurance: 'AAL1', accessToken: `synthetic.access.${suffix}`,
  accessTokenExpiresAt: future, refreshToken: `synthetic-refresh-for-unit-tests-${suffix}`, refreshTokenExpiresAt: future,
});
const account = { id, status: 'ACTIVE', displayName: null, phoneMasked: '+97798******00', locale: 'ne-NP',
  version: 1, createdAt: future, updatedAt: future };
const accepted = { challengeId: id, expiresAt: future, deliveryState: 'ACCEPTED' };
const success = (data, status = 200) => Response.json({ data, meta: { requestId: id } }, { status });
const failure = (code, status, retryAfter) => Response.json({
  error: { code, message: 'Request rejected.', retryable: false }, meta: { requestId: id },
}, { status, headers: retryAfter ? { 'Retry-After': String(retryAfter) } : undefined });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function nativeStore() {
  const values = new Map(), calls = [];
  return {
    values, calls, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
    async isAvailableAsync() { return true; },
    async getItemAsync(key, options) { calls.push({ method: 'read', key, options }); return values.get(key) ?? null; },
    async setItemAsync(key, value, options) { calls.push({ method: 'write', key, options }); values.set(key, value); },
    async deleteItemAsync(key, options) { calls.push({ method: 'clear', key, options }); values.delete(key); },
  };
}

function fixture(handler = () => undefined) {
  const storage = nativeStore(), calls = [];
  const vault = createSecureRefreshVault(storage, scope);
  let clock = startTime;
  const transport = new BackendTransport({ origin: scope.origin, fetch: async (url, init) => {
    const call = { path: new URL(url).pathname, ...init };
    calls.push(call);
    const response = await handler(call);
    if (response) return response;
    if (call.path.endsWith('/otp-challenges')) return success(accepted, 202);
    if (call.path.endsWith('/otp-verifications')) return success(tokens(), 201);
    if (call.path.endsWith('/refresh')) return success(tokens('rotated'));
    if (call.path.endsWith('/sessions/current')) return new Response(null, { status: 204 });
    return success(account);
  } });
  const session = new BackendSession(transport, vault, () => clock);
  const auth = createBackendAuthController(session, () => clock);
  return { auth, session, storage, vault, calls, advance: (ms) => { clock += ms; },
    login: async () => { await auth.start(); await auth.requestCode(phone); await auth.verifyCode('123456'); } };
}

test('secure vault stores one scoped refresh record with device-only accessibility and no access token', async () => {
  const storage = nativeStore(), vault = createSecureRefreshVault(storage, scope);
  await vault.write(tokens());
  assert.equal(storage.values.size, 1);
  const key = refreshVaultKey(scope), raw = storage.values.get(key);
  assert.match(key, /^[a-zA-Z0-9._-]+$/);
  assert.ok(raw.length < 2048);
  assert.deepEqual(JSON.parse(raw), { formatVersion: 1, ...scope, credentials: refreshCredentials(tokens()) });
  assert.deepEqual(await vault.read(), refreshCredentials(tokens()));
  await vault.clear();
  assert.equal(storage.values.size, 0);
  for (const call of storage.calls) {
    assert.deepEqual(call.options, { keychainService: key, keychainAccessible: 7, requireAuthentication: false });
  }
});

test('vault keys canonicalize origins without colliding across scheme, port, punctuation or environment', () => {
  assert.equal(refreshVaultKey(scope), refreshVaultKey({ ...scope, origin: 'https://API.example.test:443/' }));
  const keys = [
    scope, { ...scope, origin: 'http://api.example.test' }, { ...scope, origin: 'https://api.example.test:8443' },
    { ...scope, environment: 'staging' }, { ...scope, origin: 'https://api-example.test' },
  ].map(refreshVaultKey);
  assert.equal(new Set(keys).size, keys.length);
  for (const origin of ['https://user:pass@api.example.test', 'https://api.example.test/path', 'https://api.example.test?key=value']) {
    assert.throws(() => refreshVaultKey({ ...scope, origin }), { message: 'Invalid API storage scope.' });
  }
});

test('corrupt and cross-environment vault records fail closed and do not surface raw contents', async () => {
  const storage = nativeStore(), vault = createSecureRefreshVault(storage, scope);
  for (const raw of ['not JSON', 'null', '[]', JSON.stringify({ formatVersion: 1, ...scope, environment: 'staging', credentials: tokens() })]) {
    storage.values.set(refreshVaultKey(scope), raw);
    await assert.rejects(vault.read(), { code: 'CLIENT.SESSION_STORAGE_INVALID' });
  }
});

test('unavailable or failing native storage never falls back to plaintext', async () => {
  const storage = nativeStore(), vault = createSecureRefreshVault(storage, scope);
  storage.isAvailableAsync = async () => false;
  for (const operation of [() => vault.read(), () => vault.write(tokens()), () => vault.clear()]) {
    await assert.rejects(operation(), { code: 'CLIENT.SECURE_STORAGE_UNAVAILABLE' });
  }
  assert.equal(storage.calls.length, 0);
  storage.isAvailableAsync = async () => true;
  storage.getItemAsync = async () => { throw new Error('sensitive native dump'); };
  await assert.rejects(vault.read(), (error) => {
    assert.equal(error.code, 'CLIENT.SECURE_STORAGE_UNAVAILABLE');
    assert.equal(error.cause, undefined);
    assert.ok(!error.message.includes('sensitive'));
    return true;
  });
});

test('invalid saved session clears only its own secure key and cannot authenticate', async () => {
  const f = fixture();
  f.storage.values.set(refreshVaultKey(scope), 'corrupt');
  f.storage.values.set('unrelated', 'preserve');
  await f.auth.start();
  assert.equal(f.auth.store.getState().status, 'signedOut');
  assert.equal(f.auth.store.getState().issue.code, 'CLIENT.SESSION_STORAGE_INVALID');
  assert.deepEqual([...f.storage.values], [['unrelated', 'preserve']]);
  assert.equal(f.calls.length, 0);
});

test('restoration/remount shares one rotation and requires the matching active profile', async () => {
  const f = fixture((call) => {
    if (call.path.endsWith('/refresh')) {
      assert.equal(f.storage.values.has(refreshVaultKey(scope)), false);
    }
  });
  await f.vault.write(refreshCredentials(tokens()));
  const first = f.auth.start(), second = f.auth.start();
  assert.equal(first, second);
  await first;
  assert.equal(f.calls.filter((call) => call.path.endsWith('/refresh')).length, 1);
  assert.equal(f.auth.store.getState().status, 'authenticated');
  assert.deepEqual(f.auth.store.getState().profile, account);
  assert.equal(JSON.stringify(f.auth.store.getState()).includes('synthetic'), false);
});

test('six-digit OTP uses challenge identity and does not persist OTPs in auth state', async () => {
  const f = fixture();
  await f.auth.start();
  await f.auth.requestCode(phone);
  assert.equal(f.auth.store.getState().status, 'codeSent');
  assert.match(f.auth.store.getState().notice, /accepted/);
  assert.equal(f.session.identity(), null);
  await f.auth.verifyCode('1234');
  assert.equal(f.calls.length, 1);
  await f.auth.verifyCode('123456');
  assert.equal(f.auth.store.getState().status, 'authenticated');
  assert.equal(f.auth.store.getState().challenge, null);
  assert.deepEqual(JSON.parse(f.calls[1].body), { challengeId: id, otp: '123456', clientType: 'MOBILE' });
  assert.equal(JSON.stringify(f.auth.store.getState()).includes('123456'), false);
  assert.equal(JSON.stringify(f.auth.store.getState()).includes(phone), false);
});

test('duplicate send and verify presses issue exactly one corresponding HTTP request', async () => {
  const challenge = deferred(), verify = deferred();
  const f = fixture((call) => call.path.endsWith('/otp-challenges') ? challenge.promise :
    call.path.endsWith('/otp-verifications') ? verify.promise : undefined);
  await f.auth.start();
  const send = f.auth.requestCode(phone);
  await f.auth.requestCode(phone);
  challenge.resolve(success(accepted, 202));
  await send;
  const verification = f.auth.verifyCode('123456');
  await f.auth.verifyCode('123456');
  verify.resolve(success(tokens(), 201));
  await verification;
  assert.equal(f.calls.filter((call) => call.path.endsWith('/otp-challenges')).length, 1);
  assert.equal(f.calls.filter((call) => call.path.endsWith('/otp-verifications')).length, 1);
});

test('OTP rejection permits correction, while attempt exhaustion discards the challenge', async () => {
  let rejected = 'AUTH.OTP_INVALID';
  const f = fixture((call) => call.path.endsWith('/otp-verifications')
    ? failure(rejected, rejected === 'AUTH.OTP_INVALID' ? 401 : 429) : undefined);
  await f.auth.start(); await f.auth.requestCode(phone); await f.auth.verifyCode('111111');
  assert.equal(f.auth.store.getState().status, 'codeSent');
  assert.equal(f.auth.store.getState().challenge.challengeId, id);
  rejected = 'AUTH.OTP_ATTEMPTS_EXCEEDED';
  await f.auth.verifyCode('222222');
  assert.equal(f.auth.store.getState().status, 'signedOut');
  assert.equal(f.auth.store.getState().challenge, null);
});

test('server Retry-After and expired challenge prevent premature network requests', async () => {
  let limited = true;
  const f = fixture((call) => limited && call.path.endsWith('/otp-challenges')
    ? failure('RATE_LIMIT.EXCEEDED', 429, 120) : undefined);
  await f.auth.start(); await f.auth.requestCode(phone);
  await f.auth.requestCode(phone);
  assert.equal(f.calls.length, 1);
  f.advance(120000); limited = false;
  await f.auth.requestCode(phone);
  assert.equal(f.calls.length, 2);
  f.advance(86400001);
  await f.auth.verifyCode('123456');
  assert.equal(f.calls.length, 2);
  assert.equal(f.auth.store.getState().challenge, null);
});

test('lost OTP verification response requires a new challenge instead of replay', async () => {
  const f = fixture((call) => {
    if (call.path.endsWith('/otp-verifications')) throw new Error('lost after commit');
  });
  await f.login();
  assert.equal(f.auth.store.getState().status, 'signedOut');
  assert.equal(f.auth.store.getState().challenge, null);
  await f.auth.verifyCode('123456');
  assert.equal(f.calls.filter((call) => call.path.endsWith('/otp-verifications')).length, 1);
});

test('profile network failure stays unauthenticated until explicit profile retry succeeds', async () => {
  let offline = true;
  const f = fixture((call) => { if (offline && call.path === '/api/v1/me') throw new Error('offline'); });
  await f.login();
  assert.equal(f.auth.store.getState().status, 'profileError');
  assert.equal(f.auth.store.getState().profile, null);
  assert.ok(f.auth.store.getState().identity);
  offline = false;
  await f.auth.retryProfile();
  assert.equal(f.auth.store.getState().status, 'authenticated');
  assert.equal(f.calls.filter((call) => call.path.endsWith('/otp-verifications')).length, 1);
});

test('mismatched or inactive profiles cannot enter authenticated UI', async () => {
  for (const data of [{ ...account, id: otherId }, { ...account, status: 'SUSPENDED' }]) {
    const f = fixture((call) => call.path === '/api/v1/me' ? success(data) : undefined);
    await f.login();
    assert.equal(f.auth.store.getState().status, 'profileError');
    assert.equal(f.auth.store.getState().profile, null);
  }
});

test('logout invalidates a pending profile and clears UI data synchronously', async () => {
  const entered = deferred(), response = deferred();
  const f = fixture((call) => {
    if (call.path === '/api/v1/me') { entered.resolve(); return response.promise; }
  });
  const login = f.login();
  await entered.promise;
  const logout = f.auth.logout();
  assert.equal(f.auth.store.getState().identity, null);
  assert.equal(f.auth.store.getState().profile, null);
  await logout;
  response.resolve(success(account));
  await login;
  assert.equal(f.auth.store.getState().status, 'signedOut');
  assert.equal(f.storage.values.size, 0);
});

test('a product-request revocation immediately clears the separate auth store', async () => {
  const f = fixture((call) => call.path.endsWith('/me/notifications') ? failure('AUTH.SESSION_REVOKED', 401) : undefined);
  await f.login();
  await assert.rejects(f.session.request({ path: '/api/v1/me/notifications', decode: text }), { code: 'AUTH.SESSION_REVOKED' });
  assert.equal(f.auth.store.getState().status, 'signedOut');
  assert.equal(f.auth.store.getState().profile, null);
  assert.equal(f.auth.store.getState().identity, null);
});

test('late OTP acceptance cannot reopen a cancelled sign-in flow', async () => {
  const response = deferred();
  const f = fixture((call) => call.path.endsWith('/otp-challenges') ? response.promise : undefined);
  await f.auth.start();
  const send = f.auth.requestCode(phone);
  await f.auth.logout();
  response.resolve(success(accepted, 202));
  await send;
  assert.equal(f.auth.store.getState().status, 'signedOut');
  assert.equal(f.auth.store.getState().challenge, null);
});

test('throwing identity listeners cannot poison a saved session or expose tokens', async () => {
  const f = fixture(), seen = [];
  f.session.subscribe(() => { throw new Error('consumer failed'); });
  const remove = f.session.subscribe((identity) => { if (identity) seen.push(identity); });
  await f.login();
  assert.equal(f.auth.store.getState().status, 'authenticated');
  assert.deepEqual(seen, [{ userId: id, sessionId: id, assurance: 'AAL1' }]);
  remove();
  await f.auth.logout();
  assert.equal(seen.length, 1);
});

test('logout failure does not claim server revocation or retain authenticated UI', async () => {
  const f = fixture((call) => { if (call.path.endsWith('/sessions/current')) throw new Error('offline'); });
  await f.login(); await f.auth.logout();
  const state = f.auth.store.getState();
  assert.equal(state.status, 'signedOut');
  assert.equal(state.profile, null);
  assert.match(state.notice, /could not be confirmed/);
});

test('preview is explicit, dev-only and validates non-secret environment configuration', () => {
  const enabled = { development: true, enabled: '1', ...scope };
  assert.equal(resolveBackendPreview(enabled).kind, 'enabled');
  assert.equal(resolveBackendPreview({ ...enabled, development: false }).kind, 'disabled');
  assert.equal(resolveBackendPreview({ ...enabled, enabled: undefined }).kind, 'disabled');
  for (const value of [{ origin: 'http://api.example.test' }, { origin: 'https://u:password@api.example.test' },
    { environment: 'production' }, { origin: undefined }, { environment: undefined }]) {
    const config = resolveBackendPreview({ ...enabled, ...value });
    assert.equal(config.kind, 'invalid');
    assert.ok(!config.message.includes('password'));
  }
});

test('web runtime refuses native token storage without a browser fallback', async () => {
  await assert.rejects(getNativeBackendRuntime(scope), { code: 'CLIENT.NATIVE_REQUIRED' });
});
