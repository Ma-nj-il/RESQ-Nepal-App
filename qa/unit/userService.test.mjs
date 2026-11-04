import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapUserServiceUser,
  userService,
  UserServiceError,
} from '../../src/services/api/userService.ts';

const userDto = {
  id: '8bc4e87e-329a-44dd-90dd-4f032e1939c3',
  email: 'patient@resq.local',
  phone_number: '+9779800000000',
  first_name: 'Resq',
  last_name: 'Patient',
  role: 'rider',
  is_active: true,
  is_verified: false,
  account_status: 'active',
  terms_version: '2026-11',
  terms_accepted_at: '2026-11-03T00:00:00Z',
  profile_image: null,
  created_at: '2026-11-03T00:00:00Z',
  updated_at: '2026-11-03T00:00:00Z',
};

const sessionDto = {
  id: '54e05f89-ed82-4f31-9b46-f77ccbc2637f',
  remember_me: true,
  device_name: 'Pixel 10',
  ip_address: '127.0.0.1',
  user_agent: 'RESQ unit test',
  created_at: '2026-11-03T00:00:00Z',
  last_used_at: '2026-11-03T00:00:00Z',
  expires_at: '2026-12-03T00:00:00Z',
  current: true,
};

const loginDto = {
  user: userDto,
  token: 'signed.jwt.token',
  access_token: 'signed.jwt.token',
  refresh_token: 'opaque-refresh-token-with-at-least-32-characters',
  token_type: 'Bearer',
  expires_in: 900,
  session: sessionDto,
};

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify({ success: true, data }),
});

const withMockFetch = async (implementation, run) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.EXPO_PUBLIC_AUTH_API_URL;
  process.env.EXPO_PUBLIC_AUTH_API_URL = 'http://user-service.test:8081/';
  globalThis.fetch = implementation;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_AUTH_API_URL;
    else process.env.EXPO_PUBLIC_AUTH_API_URL = originalUrl;
  }
};

const runContract = async ({ path, method = 'GET', token, body, data }, invoke) => {
  let requestCount = 0;
  const result = await withMockFetch(
    async (url, options) => {
      requestCount += 1;
      assert.equal(url, `http://user-service.test:8081${path}`);
      assert.equal(options.method, method);
      assert.equal(options.headers.Accept, 'application/json');
      assert.equal(options.headers.Authorization, token ? `Bearer ${token}` : undefined);
      assert.equal(options.headers['Content-Type'], body === undefined ? undefined : 'application/json');
      assert.deepEqual(options.body === undefined ? undefined : JSON.parse(options.body), body);
      return jsonResponse(data);
    },
    invoke,
  );
  assert.equal(requestCount, 1);
  return result;
};

test('maps the backend user DTO to the mobile user model', () => {
  assert.deepEqual(mapUserServiceUser(userDto), {
    mode: 'user',
    user: {
      id: userDto.id,
      auth_source: 'user-service',
      full_name: 'Resq Patient',
      first_name: 'Resq',
      last_name: 'Patient',
      email: userDto.email,
      phone: userDto.phone_number,
      avatar_url: undefined,
      is_verified: false,
      mode: 'user',
      created_at: userDto.created_at,
      updated_at: userDto.updated_at,
    },
  });
});

test('rejects backend roles that do not have approved Patient Mode access', () => {
  assert.throws(
    () => mapUserServiceUser({ ...userDto, role: 'driver' }),
    (error) => error instanceof UserServiceError && error.code === 'UNSUPPORTED_ROLE',
  );
  assert.throws(
    () => mapUserServiceUser({ ...userDto, role: 'admin' }),
    (error) => error instanceof UserServiceError && error.code === 'UNSUPPORTED_ROLE',
  );
});

test('registration sends rider terms acceptance and parses the sanitized user', async () => {
  const input = {
    email: userDto.email,
    password: 'ResqTest123!',
    phone_number: userDto.phone_number,
    first_name: userDto.first_name,
    last_name: userDto.last_name,
    role: 'rider',
    terms_version: '2026-11',
  };
  const response = await runContract(
    {
      path: '/api/v1/auth/register',
      method: 'POST',
      body: input,
      data: userDto,
    },
    () => userService.register(input),
  );

  assert.equal(response.id, userDto.id);
  assert.equal(response.terms_version, input.terms_version);
  assert.equal(Object.hasOwn(response, 'password'), false);
  assert.equal(Object.hasOwn(response, 'password_hash'), false);
});

test('login sends remember-me device metadata and parses the complete token contract', async () => {
  const input = {
    email: userDto.email,
    password: 'ResqTest123!',
    remember_me: true,
    device_name: 'Pixel 10',
  };
  const response = await runContract(
    {
      path: '/api/v1/auth/login',
      method: 'POST',
      body: input,
      data: loginDto,
    },
    () => userService.login(input),
  );

  assert.equal(response.token, response.access_token);
  assert.equal(response.refresh_token, loginDto.refresh_token);
  assert.equal(response.token_type, 'Bearer');
  assert.equal(response.expires_in, 900);
  assert.deepEqual(response.session, sessionDto);
  assert.equal(response.user.id, userDto.id);
});

test('gets the authenticated profile with its bearer token', async () => {
  const response = await runContract(
    {
      path: '/api/v1/auth/profile',
      token: 'signed.jwt.token',
      data: userDto,
    },
    () => userService.getProfile('signed.jwt.token'),
  );

  assert.equal(response.email, userDto.email);
});

test('profile update uses PATCH and sends only supported fields', async () => {
  const input = {
    first_name: 'Updated',
    last_name: 'Patient',
    phone_number: '+9779811111111',
    profile_image: 'https://cdn.resq.local/patient.png',
    current_password: 'ResqTest123!',
  };
  const updated = { ...userDto, ...input };
  delete updated.current_password;

  const response = await runContract(
    {
      path: '/api/v1/auth/profile',
      method: 'PATCH',
      token: 'signed.jwt.token',
      body: input,
      data: updated,
    },
    () => userService.updateProfile('signed.jwt.token', input),
  );

  assert.equal(response.first_name, 'Updated');
  assert.equal(response.phone_number, '+9779811111111');
  assert.equal(Object.hasOwn(response, 'current_password'), false);
});

test('refresh rotates through the opaque refresh-token endpoint', async () => {
  const response = await runContract(
    {
      path: '/api/v1/auth/token/refresh',
      method: 'POST',
      body: { refresh_token: 'old-opaque-refresh-token-with-32-characters' },
      data: loginDto,
    },
    () => userService.refresh('old-opaque-refresh-token-with-32-characters'),
  );

  assert.equal(response.access_token, loginDto.access_token);
  assert.equal(response.session.id, sessionDto.id);
});

test('logout calls the server with the current bearer token', async () => {
  const response = await runContract(
    {
      path: '/api/v1/auth/logout',
      method: 'POST',
      token: 'signed.jwt.token',
      data: { message: 'logged out' },
    },
    () => userService.logout('signed.jwt.token'),
  );

  assert.equal(response.message, 'logged out');
});

test('session contracts list, revoke one, and revoke all sessions', async () => {
  const sessions = [
    sessionDto,
    { ...sessionDto, id: '75c0a4bd-59f8-4b51-ad7b-b4a498f6225a', current: false },
  ];
  const listed = await runContract(
    {
      path: '/api/v1/auth/sessions',
      token: 'signed.jwt.token',
      data: sessions,
    },
    () => userService.listSessions('signed.jwt.token'),
  );
  assert.deepEqual(listed, sessions);

  const revoked = await runContract(
    {
      path: `/api/v1/auth/sessions/${sessions[1].id}`,
      method: 'DELETE',
      token: 'signed.jwt.token',
      data: { message: 'session revoked' },
    },
    () => userService.revokeSession('signed.jwt.token', sessions[1].id),
  );
  assert.equal(revoked.message, 'session revoked');

  const revokedAll = await runContract(
    {
      path: '/api/v1/auth/sessions/revoke-all',
      method: 'POST',
      token: 'signed.jwt.token',
      body: { current_password: 'ResqTest123!' },
      data: { message: 'all sessions revoked' },
    },
    () => userService.revokeAllSessions('signed.jwt.token', 'ResqTest123!'),
  );
  assert.equal(revokedAll.message, 'all sessions revoked');
});

test('password and recovery contracts send confirmation secrets in request bodies', async () => {
  const changed = await runContract(
    {
      path: '/api/v1/auth/password/change',
      method: 'POST',
      token: 'signed.jwt.token',
      body: {
        current_password: 'ResqTest123!',
        new_password: 'ResqChanged456!',
      },
      data: { message: 'password changed' },
    },
    () => userService.changePassword('signed.jwt.token', {
      current_password: 'ResqTest123!',
      new_password: 'ResqChanged456!',
    }),
  );
  assert.equal(changed.message, 'password changed');

  const recoveryCodes = ['ABCD-EFGH-JKLM-NPQR', 'STUV-WXYZ-2345-6789'];
  const generated = await runContract(
    {
      path: '/api/v1/auth/recovery-codes/regenerate',
      method: 'POST',
      token: 'signed.jwt.token',
      body: { current_password: 'ResqChanged456!' },
      data: { recovery_codes: recoveryCodes },
    },
    () => userService.regenerateRecoveryCodes('signed.jwt.token', 'ResqChanged456!'),
  );
  assert.deepEqual(generated, recoveryCodes);

  const reset = await runContract(
    {
      path: '/api/v1/auth/password/reset/recovery-code',
      method: 'POST',
      body: {
        email: userDto.email,
        recovery_code: recoveryCodes[0],
        new_password: 'ResqRecovered789!',
      },
      data: { message: 'password reset; all sessions revoked' },
    },
    () => userService.resetPasswordWithRecoveryCode({
      email: userDto.email,
      recovery_code: recoveryCodes[0],
      new_password: 'ResqRecovered789!',
    }),
  );
  assert.equal(reset.message, 'password reset; all sessions revoked');
});

test('account lifecycle contracts deactivate, reactivate, and delete', async () => {
  const deactivated = await runContract(
    {
      path: '/api/v1/auth/account/deactivate',
      method: 'POST',
      token: 'signed.jwt.token',
      body: { current_password: 'ResqTest123!' },
      data: { message: 'account deactivated' },
    },
    () => userService.deactivateAccount('signed.jwt.token', 'ResqTest123!'),
  );
  assert.equal(deactivated.message, 'account deactivated');

  const reactivateInput = {
    email: userDto.email,
    password: 'ResqTest123!',
    remember_me: true,
    device_name: 'Replacement phone',
  };
  const reactivated = await runContract(
    {
      path: '/api/v1/auth/account/reactivate',
      method: 'POST',
      body: reactivateInput,
      data: loginDto,
    },
    () => userService.reactivate(reactivateInput),
  );
  assert.equal(reactivated.session.current, true);
  assert.equal(reactivated.user.account_status, 'active');

  const deleted = await runContract(
    {
      path: '/api/v1/auth/account',
      method: 'DELETE',
      token: 'signed.jwt.token',
      body: { current_password: 'ResqTest123!' },
      data: { message: 'account deleted' },
    },
    () => userService.deleteAccount('signed.jwt.token', 'ResqTest123!'),
  );
  assert.equal(deleted.message, 'account deleted');
});

test('surfaces backend error messages, stable codes, and correlation IDs', async () => {
  await withMockFetch(
    async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({
        success: false,
        error: {
          code: 401,
          error_code: 'AUTH_INVALID_CREDENTIALS',
          message: 'invalid credentials',
        },
        correlation_id: 'request-123',
      }),
    }),
    async () => {
      await assert.rejects(
        userService.login({
          email: userDto.email,
          password: 'wrong-password',
          remember_me: false,
          device_name: 'Unit test',
        }),
        (error) => {
          assert.ok(error instanceof UserServiceError);
          assert.equal(error.status, 401);
          assert.equal(error.code, 'AUTH_INVALID_CREDENTIALS');
          assert.equal(error.correlationId, 'request-123');
          assert.equal(error.message, 'invalid credentials');
          return true;
        },
      );
    },
  );
});

test('rejects malformed response envelopes with a typed parsing error', async () => {
  await withMockFetch(
    async () => ({
      ok: false,
      status: 502,
      text: async () => '<html>bad gateway</html>',
    }),
    async () => {
      await assert.rejects(
        userService.getProfile('signed.jwt.token'),
        (error) => {
          assert.ok(error instanceof UserServiceError);
          assert.equal(error.status, 502);
          assert.equal(error.code, 'INVALID_RESPONSE');
          return true;
        },
      );
    },
  );
});
