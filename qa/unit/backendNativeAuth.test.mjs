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
const password = '  synthetic password  ';
const identifier = 'admin@example.test';
const totp = { challengeId: otherId, expiresAt: future, nextStep: 'TOTP' };
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
    if (call.path.endsWith('/password-sessions')) return success(totp);
    if (call.path.endsWith('/verifications')) return success({ ...tokens(), assurance: 'AAL2' });
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

async function passwordChallenge(f) {
  await f.auth.start(); f.auth.changeMethod('PASSWORD');
  await f.auth.requestPassword(` ${identifier} `, password);
}

test('password sign-in requires TOTP and a verified profile; only refresh credentials reach secure storage', async () => {
  const f = fixture(), snapshots = [];
  f.auth.store.subscribe(state => snapshots.push(JSON.stringify(state)));
  await passwordChallenge(f);
  assert.equal(f.session.identity(), null);
  assert.equal(f.storage.values.size, 0);
  assert.deepEqual(f.auth.store.getState().challenge, totp);
  assert.deepEqual(JSON.parse(f.calls[0].body), { identifier, password, clientType: 'MOBILE' });
  await f.auth.verifyCode('123456');
  assert.equal(f.auth.store.getState().status, 'authenticated');
  assert.deepEqual(f.auth.store.getState().identity, { userId: id, sessionId: id, assurance: 'AAL2' });
  assert.deepEqual(f.auth.store.getState().profile, account);
  assert.equal(f.calls[1].path, `/api/v1/auth/mfa-challenges/${otherId}/verifications`);
  assert.deepEqual(JSON.parse(f.calls[1].body), { code: '123456' });
  assert.equal(f.calls[1].headers.Authorization, undefined);
  for (const snapshot of snapshots) for (const secret of [password, identifier, '123456', 'synthetic.access', 'synthetic-refresh']) {
    assert.equal(snapshot.includes(secret), false);
  }
  assert.deepEqual(await f.vault.read(), refreshCredentials(tokens()));
  const saved = [...f.storage.values.values()].join();
  for (const secret of [password, identifier, '123456', 'synthetic.access']) assert.equal(saved.includes(secret), false);
});

test('password and verification duplicate presses coalesce and pending requests cannot change method', async () => {
  const challenge = deferred(), verified = deferred();
  const f = fixture(call => call.path.endsWith('/password-sessions') ? challenge.promise :
    call.path.endsWith('/verifications') ? verified.promise : undefined);
  await f.auth.start(); f.auth.changeMethod('PASSWORD');
  const send = f.auth.requestPassword(identifier, password);
  await f.auth.requestPassword(identifier, password); f.auth.changeMethod('OTP');
  assert.equal(f.auth.store.getState().method, 'PASSWORD');
  challenge.resolve(success(totp)); await send;
  const verify = f.auth.verifyCode('123456');
  await f.auth.verifyCode('123456'); f.auth.changePhone();
  verified.resolve(success({ ...tokens(), assurance: 'AAL2' })); await verify;
  assert.equal(f.calls.filter(call => call.path.endsWith('/password-sessions')).length, 1);
  assert.equal(f.calls.filter(call => call.path.endsWith('/verifications')).length, 1);
});

test('password and code validation rejects malformed input before network dispatch', async () => {
  const f = fixture(); await f.auth.start(); f.auth.changeMethod('PASSWORD');
  for (const [name, value] of [['ab', password], ['a'.repeat(321), password], [identifier, 'short'], [identifier, 'p'.repeat(1025)]]) {
    await f.auth.requestPassword(name, value);
    assert.equal(f.auth.store.getState().issue.code, 'CLIENT.CREDENTIALS_INVALID');
  }
  assert.equal(f.calls.length, 0);
  await f.auth.requestPassword(identifier, password);
  for (const code of ['12345', '1234567', 'abcdef']) await f.auth.verifyCode(code);
  assert.equal(f.calls.length, 1);
  assert.equal(f.auth.store.getState().issue.code, 'CLIENT.MFA_CODE_INVALID');
});

test('password challenge decoder rejects direct tokens, wrong next steps and malformed identities', async () => {
  for (const data of [tokens(), { ...totp, nextStep: 'WEBAUTHN' }, { ...totp, challengeId: '../other' }, { ...totp, expiresAt: 'tomorrow' }]) {
    const f = fixture(call => call.path.endsWith('/password-sessions') ? success(data) : undefined);
    await passwordChallenge(f);
    assert.equal(f.auth.store.getState().status, 'signedOut');
    assert.equal(f.auth.store.getState().issue.code, 'CLIENT.INVALID_RESPONSE');
    assert.equal(f.auth.store.getState().challenge, null);
    assert.equal(f.storage.values.size, 0);
  }
});

test('password verification rejects AAL1, web/access-only and expired sessions without saving them', async () => {
  const { refreshToken: _refresh, ...accessOnly } = { ...tokens(), assurance: 'AAL2' };
  for (const data of [tokens(), accessOnly, { ...tokens(), assurance: 'AAL2', accessTokenExpiresAt: '2026-11-02T00:00:00Z' }]) {
    const f = fixture(call => call.path.endsWith('/verifications') ? success(data) : undefined);
    await passwordChallenge(f); await f.auth.verifyCode('123456');
    assert.equal(f.auth.store.getState().status, 'signedOut');
    assert.equal(f.auth.store.getState().issue.code, 'CLIENT.INVALID_RESPONSE');
    assert.equal(f.auth.store.getState().challenge, null);
    assert.equal(f.session.identity(), null);
    assert.equal(f.storage.values.size, 0);
    assert.equal(f.calls.some(call => call.path === '/api/v1/me'), false);
  }
});

test('definitive MFA rejection permits correction; rate limits survive invalid input and method switching', async () => {
  let rejected = 'AUTH.MFA_INVALID';
  const f = fixture(call => call.path.endsWith('/verifications')
    ? failure(rejected, rejected === 'AUTH.MFA_INVALID' ? 401 : 429, 120) : undefined);
  await passwordChallenge(f); await f.auth.verifyCode('111111');
  assert.equal(f.auth.store.getState().status, 'codeSent');
  rejected = 'RATE_LIMIT.EXCEEDED'; await f.auth.verifyCode('222222');
  const count = f.calls.length;
  await f.auth.verifyCode('bad'); await f.auth.verifyCode('333333');
  assert.equal(f.calls.length, count);
  f.auth.changeMethod('OTP'); await f.auth.requestCode(phone);
  f.auth.changeMethod('PASSWORD'); await f.auth.requestPassword(identifier, password);
  assert.equal(f.calls.length, count);
  f.advance(120000); await f.auth.requestPassword(identifier, password);
  rejected = 'AUTH.MFA_ATTEMPTS_EXCEEDED'; await f.auth.verifyCode('444444');
  assert.equal(f.auth.store.getState().status, 'signedOut');
  assert.equal(f.auth.store.getState().challenge, null);
});

test('password challenge expiry and clock rollback fence both challenge responses and verification', async () => {
  for (const delta of [-1, 86400001]) {
    const f = fixture(); await passwordChallenge(f); f.advance(delta);
    await f.auth.verifyCode('123456');
    assert.equal(f.auth.store.getState().issue.code, 'CLIENT.CHALLENGE_EXPIRED');
    assert.equal(f.auth.store.getState().challenge, null);
    assert.equal(f.calls.length, 1);
    const pending = deferred();
    const late = fixture(call => call.path.endsWith('/password-sessions') ? pending.promise : undefined);
    await late.auth.start(); late.auth.changeMethod('PASSWORD');
    const send = late.auth.requestPassword(identifier, password); late.advance(delta);
    pending.resolve(success(totp)); await send;
    assert.equal(late.auth.store.getState().issue.code, 'CLIENT.CHALLENGE_EXPIRED');
    assert.equal(late.auth.store.getState().challenge, null);
  }
});

test('lost password or MFA responses never replay and do not retain secrets in error state', async () => {
  for (const endpoint of ['/password-sessions', '/verifications']) {
    const f = fixture(call => { if (call.path.endsWith(endpoint)) throw new Error(`lost ${password}`); });
    await passwordChallenge(f); await f.auth.verifyCode('123456'); await f.auth.verifyCode('123456');
    assert.equal(f.auth.store.getState().status, 'signedOut');
    assert.equal(f.auth.store.getState().issue.code, 'CLIENT.NETWORK_ERROR');
    assert.equal(f.auth.store.getState().challenge, null);
    assert.equal(JSON.stringify(f.auth.store.getState()).includes(password), false);
    assert.equal(f.calls.filter(call => call.path.endsWith(endpoint)).length, 1);
    assert.equal(f.storage.values.size, 0);
  }
  const f = fixture(call => call.path.endsWith('/verifications') ? failure('AUTH.MFA_INVALID', 500) : undefined);
  await passwordChallenge(f); await f.auth.verifyCode('123456');
  assert.equal(f.auth.store.getState().challenge, null, 'contradictory server failure cannot authorize replay');
});

test('authenticator app switching preserves idle TOTP; changing method discards the challenge', async () => {
  const f = fixture(); await passwordChallenge(f);
  await f.auth.suspendPasswordSignIn();
  assert.equal(f.auth.store.getState().status, 'codeSent');
  assert.deepEqual(f.auth.store.getState().challenge, totp);
  await f.auth.verifyCode('123456');
  assert.equal(f.auth.store.getState().status, 'authenticated');
  await f.auth.suspendPasswordSignIn();
  assert.equal(f.auth.store.getState().status, 'authenticated', 'successful form unmount must preserve its session');
  const other = fixture(); await passwordChallenge(other); other.auth.changeMethod('OTP');
  await other.auth.verifyCode('123456');
  assert.equal(other.auth.store.getState().challenge, null);
  assert.equal(other.calls.length, 1);
});

test('suspension aborts in-flight password, MFA and profile requests and ignores late responses', async () => {
  for (const endpoint of ['/password-sessions', '/verifications', '/me']) {
    const entered = deferred(), response = deferred();
    const f = fixture(call => { if (call.path.endsWith(endpoint)) { entered.resolve(call); return response.promise; } });
    const login = (async () => { await passwordChallenge(f); await f.auth.verifyCode('123456'); })();
    const call = await entered.promise;
    await f.auth.suspendPasswordSignIn();
    assert.equal(call.signal.aborted, true);
    response.resolve(success(endpoint === '/password-sessions' ? totp : endpoint === '/me' ? account : { ...tokens(), assurance: 'AAL2' }));
    await login;
    assert.equal(f.auth.store.getState().status, 'signedOut');
    assert.equal(f.auth.store.getState().profile, null);
    assert.equal(f.session.identity(), null);
    assert.equal(f.storage.values.size, 0);
  }
});

test('suspension during native credential persistence queues cleanup and never publishes the late session', async () => {
  const f = fixture(), entered = deferred(), release = deferred(), seen = [];
  const write = f.storage.setItemAsync.bind(f.storage);
  f.storage.setItemAsync = async (...args) => { entered.resolve(); await release.promise; return write(...args); };
  f.session.subscribe(identity => { if (identity) seen.push(identity); });
  await passwordChallenge(f);
  const verification = f.auth.verifyCode('123456'); await entered.promise;
  const cancel = f.auth.suspendPasswordSignIn(); release.resolve();
  await Promise.all([verification, cancel]);
  assert.deepEqual(seen, []);
  assert.equal(f.storage.values.size, 0);
  assert.equal(f.auth.store.getState().status, 'signedOut');
});

test('synchronous store listeners cannot dispatch cancelled sign-in work or capture logout ownership', async () => {
  for (const stage of ['requestingCode', 'verifying', 'clearingSession', 'loadingProfile']) {
    const f = fixture(); await f.auth.start(); f.auth.changeMethod('PASSWORD');
    let cancelled, verifyingUpdates = 0;
    f.auth.store.subscribe(state => {
      if (state.status === 'verifying') verifyingUpdates++;
      if (!cancelled && (state.status === stage || (stage === 'clearingSession' && verifyingUpdates === 2))) {
        cancelled = true; void f.auth.suspendPasswordSignIn();
      }
    });
    await f.auth.requestPassword(identifier, password); await f.auth.verifyCode('123456');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true, stage);
    assert.equal(f.auth.store.getState().status, 'signedOut', stage);
    assert.equal(f.session.identity(), null, stage);
    assert.equal(f.storage.values.size, 0, stage);
    const blocked = stage === 'requestingCode' ? '/password-sessions' : stage === 'loadingProfile' ? '/me' : '/verifications';
    assert.equal(f.calls.some(call => call.path.endsWith(blocked)), false, stage);
  }
});

test('password sessions require matching ACTIVE profiles and retry only profile reads after network failure', async () => {
  for (const profile of [{ ...account, id: otherId }, { ...account, status: 'SUSPENDED' }]) {
    const f = fixture(call => call.path === '/api/v1/me' ? success(profile) : undefined);
    await passwordChallenge(f); await f.auth.verifyCode('123456');
    assert.equal(f.auth.store.getState().status, 'profileError');
    assert.equal(f.auth.store.getState().profile, null);
  }
  let offline = true;
  const f = fixture(call => { if (offline && call.path === '/api/v1/me') throw new Error('offline'); });
  await passwordChallenge(f); await f.auth.verifyCode('123456');
  assert.equal(f.auth.store.getState().status, 'profileError');
  offline = false; await f.auth.retryProfile();
  assert.equal(f.auth.store.getState().status, 'authenticated');
  assert.equal(f.calls.filter(call => call.path.endsWith('/verifications')).length, 1);
});
