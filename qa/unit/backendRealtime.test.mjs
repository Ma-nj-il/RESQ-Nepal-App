import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequesterRealtime } from '../../src/services/api/backend/realtime.ts';
import { BackendSession } from '../../src/services/api/backend/session.ts';
import { BackendTransport } from '../../src/services/api/backend/transport.ts';
import { text } from '../../src/services/api/backend/decoders.ts';

const id = '00000000-0000-4000-8000-000000000001';
const now = Date.parse('2026-11-04T10:00:00Z');
const turn = () => new Promise(resolve => setImmediate(resolve));
function socketFactory() {
  const sockets = [];
  const connect = (url, options) => {
    const handlers = new Map();
    const socket = { url, options, auth: options.auth, handlers, closed: false, sent: [],
      on: (event, callback) => { handlers.set(event, callback); return socket; },
      removeAllListeners: () => handlers.clear(), disconnect: () => { socket.closed = true; },
      connect: () => handlers.get('connect')?.(),
      emit: (event, payload, ack) => { socket.sent.push({ event, payload }); ack?.({ accepted: true, bookingId: payload.id }); },
    };
    sockets.push(socket); return socket;
  };
  return { sockets, connect };
}
const callbacks = () => { const events = []; return { events, connected: () => events.push('connected'), hint: value => events.push(value), disconnected: () => events.push('disconnected') }; };

test('realtime uses protected handshake auth and booking subscriptions with no command payloads', async () => {
  const factory = socketFactory(), receiver = callbacks();
  const realtime = createRequesterRealtime({ authenticateRealtime: async send => send({ token: 'synthetic.access' }) }, 'https://api.example.test', factory.connect);
  const stop = realtime.subscribe(id, receiver); await turn();
  try {
    const socket = factory.sockets[0];
    assert.equal(socket.url, 'https://api.example.test/realtime'); assert.equal(socket.options.path, '/realtime');
    assert.equal(socket.options.auth.token, 'synthetic.access'); assert.deepEqual(socket.options.transports, ['websocket']);
    assert.equal(socket.options.reconnection, false); assert.deepEqual(socket.auth, {});
    assert.deepEqual(socket.sent, [{ event: 'subscribe', payload: { type: 'booking', id } }]);
    const lateHint = socket.handlers.get('recovery.hint');
    lateHint({ sequence: 1 }); stop(); lateHint({ sequence: 2 });
    assert.deepEqual(receiver.events, ['connected', { sequence: 1 }]);
    assert.equal(socket.closed, true);
  } finally { stop(); }
});

test('selection cleanup cancels a delayed authentication before any socket is opened', async () => {
  let send, signal;
  const factory = socketFactory();
  const realtime = createRequesterRealtime({ authenticateRealtime: async (callback, abort) => { send = callback; signal = abort; } }, 'https://api.example.test', factory.connect);
  const stop = realtime.subscribe(id, callbacks()); stop(); send({ token: 'late.access' }); await turn();
  assert.equal(signal.aborted, true); assert.equal(factory.sockets.length, 0);
});

test('stopping after connection loss cancels scheduled retries and rejects retained callbacks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const factory = socketFactory(), receiver = callbacks();
  const realtime = createRequesterRealtime({ authenticateRealtime: async send => send({ token: 'synthetic.access' }) }, 'https://api.example.test', factory.connect);
  const stop = realtime.subscribe(id, receiver); await turn();
  const socket = factory.sockets[0], late = socket.handlers.get('recovery.hint');
  socket.handlers.get('disconnect')(); stop(); late({ sequence: 5 });
  t.mock.timers.tick(60000); await turn();
  assert.equal(factory.sockets.length, 1); assert.deepEqual(receiver.events, ['connected', 'disconnected']);
});

test('realtime and concurrent HTTP expiry share one persisted refresh successor', async () => {
  let saved, rotations = 0, handshakes = [];
  const current = { userId: id, sessionId: id, assurance: 'AAL1', accessToken: 'old.access', accessTokenExpiresAt: new Date(now + 10000).toISOString(),
    refreshToken: 'synthetic-refresh-credential-original-00001', refreshTokenExpiresAt: new Date(now + 86400000).toISOString() };
  const next = { ...current, accessToken: 'next.access', accessTokenExpiresAt: new Date(now + 600000).toISOString(), refreshToken: 'synthetic-refresh-credential-successor-0002' };
  const session = new BackendSession(new BackendTransport({ origin: 'https://api.example.test', fetch: async (url) => {
    if (url.endsWith('/otp-verifications')) return Response.json({ data: current, meta: { requestId: id } });
    if (url.endsWith('/tokens/refresh')) { rotations++; await turn(); return Response.json({ data: next, meta: { requestId: id } }); }
    return Response.json({ data: 'ok', meta: { requestId: id } });
  } }), { read: async () => null, write: async value => { saved = value; }, clear: async () => { saved = null; } }, () => now);
  await session.verifyOtp(id, '123456');
  await Promise.all([session.authenticateRealtime(auth => {
    assert.equal(saved.refreshToken, next.refreshToken); handshakes.push(auth);
  }, new AbortController().signal), session.request({ path: '/api/v1/test', decode: text })]);
  assert.equal(rotations, 1); assert.deepEqual(handshakes, [{ token: 'next.access' }]);
});

test('realtime rejects credential-bearing URLs and insecure origins', () => {
  for (const origin of ['http://api.example.test', 'https://token@api.example.test', 'https://api.example.test/?token=secret'])
    assert.throws(() => createRequesterRealtime({}, origin));
});

test('handshake waits for an HTTP-triggered stale-token rotation even before local expiry', async () => {
  let saved, release, rotationStarted;
  const entered = new Promise(resolve => { rotationStarted = resolve; });
  const current = { userId: id, sessionId: id, assurance: 'AAL1', accessToken: 'old.access', accessTokenExpiresAt: new Date(now + 600000).toISOString(),
    refreshToken: 'synthetic-refresh-credential-original-00001', refreshTokenExpiresAt: new Date(now + 86400000).toISOString() };
  const next = { ...current, accessToken: 'next.access', refreshToken: 'synthetic-refresh-credential-successor-0002' };
  const session = new BackendSession(new BackendTransport({ origin: 'https://api.example.test', fetch: async (url, options) => {
    if (url.endsWith('/otp-verifications')) return Response.json({ data: current, meta: { requestId: id } });
    if (url.endsWith('/tokens/refresh')) {
      rotationStarted(); await new Promise(resolve => { release = resolve; });
      return Response.json({ data: next, meta: { requestId: id } });
    }
    if (new Headers(options.headers).get('authorization') === 'Bearer old.access') return Response.json({
      error: { code: 'AUTH.ACCESS_TOKEN_STALE', message: 'Refresh required.', retryable: false }, meta: { requestId: id },
    }, { status: 401 });
    return Response.json({ data: 'ok', meta: { requestId: id } });
  } }), { read: async () => null, write: async value => { saved = value; }, clear: async () => { saved = null; } }, () => now);
  await session.verifyOtp(id, '123456');
  const request = session.request({ path: '/api/v1/test', decode: text });
  await entered;
  const handshakes = [];
  const handshake = session.authenticateRealtime(auth => {
    assert.equal(saved.refreshToken, next.refreshToken); handshakes.push(auth);
  }, new AbortController().signal);
  await turn(); assert.deepEqual(handshakes, []);
  release(); await Promise.all([request, handshake]);
  assert.deepEqual(handshakes, [{ token: 'next.access' }]);
});

test('connected callback cleanup fences the subscription itself', async () => {
  const factory = socketFactory();
  let send, stop;
  const realtime = createRequesterRealtime({ authenticateRealtime: async callback => { send = callback; } }, 'https://api.example.test', factory.connect);
  stop = realtime.subscribe(id, { ...callbacks(), connected: () => stop() });
  send({ token: 'synthetic.access' }); await turn();
  assert.equal(factory.sockets[0].closed, true);
  assert.deepEqual(factory.sockets[0].sent, []);
});
