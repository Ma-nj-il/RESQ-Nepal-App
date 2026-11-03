import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackendTransport } from '../../src/services/api/backend/transport.ts';
import { BackendError } from '../../src/services/api/backend/errors.ts';
import {
  amountMinor, bookingStatus, formatNprMinor, mobileSession, noContent, page, text, tripStatus,
} from '../../src/services/api/backend/decoders.ts';
import { receipt, ticket } from '../../src/services/api/backend/requester.ts';

const id = '00000000-0000-4000-8000-000000000001';
const success = (data, init) => Response.json({ data, meta: { requestId: id } }, init);
const transport = (fetch, options = {}) => new BackendTransport({ origin: 'https://api.example.test', fetch, ...options });

test('wire money retains bigint precision and rejects floating-point/legacy values', () => {
  assert.equal(amountMinor('9223372036854775807'), '9223372036854775807');
  assert.equal(formatNprMinor('9223372036854775807'), 'NPR 92233720368547758.07');
  assert.equal(formatNprMinor('1'), 'NPR 0.01');
  assert.equal(formatNprMinor('0'), 'NPR 0.00');
  for (const value of [45000, 1.5, '01', '-1', '1.00', '9223372036854775808']) {
    assert.throws(() => amountMinor(value), { code: 'CLIENT.INVALID_RESPONSE' });
  }
});

test('canonical booking/trip states never silently map unknown or legacy states', () => {
  assert.equal(bookingStatus('UNFULFILLED'), 'UNFULFILLED');
  assert.equal(bookingStatus('PROVIDER_ACCEPTED'), 'PROVIDER_ACCEPTED');
  assert.equal(tripStatus('PATIENT_ON_BOARD'), 'PATIENT_ON_BOARD');
  for (const value of ['accepted', 'pending', 'FUTURE_STATE', null]) {
    assert.throws(() => bookingStatus(value), { code: 'CLIENT.INVALID_RESPONSE' });
    assert.throws(() => tripStatus(value), { code: 'CLIENT.INVALID_RESPONSE' });
  }
});

test('receipt and bounded product pagination match PostgreSQL JSON projections', () => {
  const result = receipt({
    tripId: id, bookingId: id, fare: { amountMinor: '9007199254740993', currency: 'NPR' },
    fareProvenance: 'POLICY_QUOTE', paymentMethod: 'CASH', collectionStatus: 'UNRECORDED',
    collectionId: null, completedAt: '2026-11-03T10:00:00+00:00', version: 9,
  });
  assert.equal(result.fare.amountMinor, '9007199254740993');
  const item = {
    id, tripId: null, category: 'ACCOUNT', status: 'OPEN', version: 1, resolutionCode: null,
    createdAt: '2026-11-03T10:00:00.123456+00:00', updatedAt: '2026-11-03T10:00:00Z',
  };
  assert.deepEqual(page(ticket)({ items: [item], nextAfterId: id }), { items: [item], nextAfterId: id });
  assert.throws(() => page(ticket)({ items: Array(51).fill(item), nextAfterId: id }), { code: 'CLIENT.INVALID_RESPONSE' });
  assert.throws(() => page(ticket)({ items: [], nextCursor: null }), { code: 'CLIENT.INVALID_RESPONSE' });
});

test('envelope, ETag, status and replay identity are preserved', async () => {
  let call;
  const client = transport(async (url, init) => {
    call = { url, ...init };
    return success('ok', { status: 201, headers: { etag: '"1"', 'idempotency-replayed': 'true' } });
  });
  const result = await client.request({
    path: '/api/v1/me/notification-preferences', method: 'PUT', decode: text,
    body: { marketing: false }, expectedVersion: 0, idempotencyKey: 'same-intent-key-123',
  }, 'synthetic.access');
  assert.deepEqual(result, { data: 'ok', status: 201, requestId: id, etag: '"1"', replayed: true });
  assert.equal(call.headers['If-Match'], '"0"');
  assert.equal(call.headers['Idempotency-Key'], 'same-intent-key-123');
  assert.equal(call.credentials, 'omit');
  assert.equal(call.redirect, 'error');
  assert.equal(call.cache, 'no-store');
});

test('public errors retain code, details, request ID and Retry-After without retrying', async () => {
  let calls = 0;
  const client = transport(async () => {
    calls++;
    return Response.json({
      error: { code: 'RATE_LIMIT.EXCEEDED', message: 'Too many requests.', retryable: true,
        details: [{ field: 'otp', code: 'LIMIT', ignored: 'not retained' }] },
      meta: { requestId: id },
    }, { status: 429, headers: { 'Retry-After': '17' } });
  });
  await assert.rejects(client.request({ path: '/api/v1/me', decode: text }), (error) => {
    assert.ok(error instanceof BackendError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, 17);
    assert.equal(error.requestId, id);
    assert.deepEqual(error.details, [{ field: 'otp', code: 'LIMIT' }]);
    return true;
  });
  assert.equal(calls, 1);
});

test('204 revocation does not require an envelope', async () => {
  const client = transport(async () => new Response(null, { status: 204 }));
  assert.equal((await client.request({ path: '/api/v1/auth/sessions/current', decode: noContent })).data, undefined);
});

test('malformed success/error and browser session shapes fail closed', async () => {
  for (const response of [
    new Response('<html>upstream error</html>', { status: 502 }),
    Response.json({ ok: true, data: 'legacy' }),
    Response.json({ error: 'not-public', meta: { requestId: id } }, { status: 500 }),
    success({ accessToken: 'browser.only', userId: id, sessionId: id }),
  ]) {
    await assert.rejects(transport(async () => response).request({ path: '/api/v1/me', decode: mobileSession }),
      { code: 'CLIENT.INVALID_RESPONSE' });
  }
});

test('untrusted paths and invalid origins are rejected before fetch', async () => {
  let calls = 0;
  const client = transport(async () => { calls++; return success('bad'); });
  for (const path of ['https://other.test/api/v1/me', '//other.test/api/v1/me', '/api/v1/../me', '/api/v1/%2e%2e/me', '/api/v1/me?token=x']) {
    await assert.rejects(client.request({ path, decode: text }, 'synthetic.access'));
  }
  assert.equal(calls, 0);
  for (const origin of ['http://api.example.test', 'https://user:pass@api.example.test', 'https://api.example.test/path']) {
    assert.throws(() => transport(async () => success('bad'), { origin }));
  }
});

test('timeout includes a stalled response body and never exposes native error contents', async () => {
  const client = transport(async () => ({
    status: 200, ok: true, headers: new Headers(), json: () => new Promise(() => {}),
  }), { timeoutMs: 10 });
  await assert.rejects(client.request({ path: '/api/v1/me', decode: text }), { code: 'CLIENT.TIMEOUT' });
  const failed = transport(async () => { throw new Error('sensitive native request dump'); });
  await assert.rejects(failed.request({ path: '/api/v1/me', decode: text }), (error) => {
    assert.equal(error.code, 'CLIENT.NETWORK_ERROR');
    assert.equal(error.cause, undefined);
    assert.ok(!error.message.includes('sensitive'));
    return true;
  });
});

test('already-aborted requests never reach fetch', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const client = transport(async () => { calls++; return success('bad'); });
  await assert.rejects(client.request({ path: '/api/v1/me', decode: text, signal: controller.signal }), { code: 'CLIENT.CANCELLED' });
  assert.equal(calls, 0);
});

test('schema failures preserve HTTP status and diagnostic request ID', async () => {
  const client = transport(async () => success(123, { headers: { 'x-request-id': id } }));
  await assert.rejects(client.request({ path: '/api/v1/me', decode: text }), {
    code: 'CLIENT.INVALID_RESPONSE', status: 200, requestId: id,
  });
});
