import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import { io, type Socket } from 'socket.io-client';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import {
  projectRecoveryHint,
  type RecoveryHint,
  type RecoveryHintSource,
} from '../../src/realtime/application/recovery-hint.js';
import { RequesterRealtimeServer } from '../../src/realtime/infrastructure/requester-realtime.server.js';

interface Receive {
  'recovery.hint': (value: unknown) => void;
}
interface Send {
  subscribe: (value: unknown, ack: (value: unknown) => void) => void;
  unsubscribe: () => void;
}
type Client = Socket<Receive, Send>;
class Hints implements RecoveryHintSource {
  healthy = true;
  hint: (value: RecoveryHint) => void = () => {};
  fail: () => void = () => {};
  ready(): boolean {
    return this.healthy;
  }
  subscribe(hint: (value: RecoveryHint) => void, fail: () => void): () => void {
    this.hint = hint;
    this.fail = fail;
    return () => {
      this.hint = () => {};
      this.fail = () => {};
    };
  }
}
function signal<T>(listen: (resolve: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Expected socket event timed out')), 2000);
    listen((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

describe('requester realtime with installed WebSocket server and client', () => {
  let http: Server, server: RequesterRealtimeServer, url: string, hints: Hints;
  let allowed = true;
  const clients: Client[] = [];
  const bookingId = randomUUID(),
    userId = randomUUID(),
    sessionId = randomUUID();
  const context = new RequestContext({
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source: 'HTTP',
    actor: { type: 'USER', id: userId },
    sessionId,
  });
  const authorize = jest.fn<(token: string) => Promise<RequestContext>>();
  const version = jest.fn<(context: RequestContext, id: string) => Promise<number>>();

  beforeEach(async () => {
    allowed = true;
    authorize.mockReset();
    version.mockReset();
    authorize.mockImplementation((token) => {
      if (!allowed || token !== 'synthetic.access') return Promise.reject(new Error('Revoked'));
      return Promise.resolve(context);
    });
    version.mockImplementation((_context, id) => {
      if (id !== bookingId) return Promise.reject(new Error('Not found'));
      return Promise.resolve(3);
    });
    hints = new Hints();
    http = createServer();
    server = new RequesterRealtimeServer(
      http,
      hints,
      { authorize, bookingVersion: version },
      { origins: ['https://accepted.invalid'], recheckMs: 100, deadlineMs: 300 },
    );
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    url = `http://127.0.0.1:${String(address.port)}/realtime`;
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    await server.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  function client(
    auth: unknown = { token: 'synthetic.access' },
    options: { query?: Record<string, string>; extraHeaders?: Record<string, string> } = {},
  ): Client {
    const result: Client = io(url, {
      path: '/realtime',
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
      auth: auth as Record<string, unknown>,
      ...options,
    });
    clients.push(result);
    return result;
  }
  async function connect(socket: Client): Promise<void> {
    const connected = signal<undefined>((resolve) =>
      socket.once('connect', () => resolve(undefined)),
    );
    socket.connect();
    await connected;
  }
  async function subscribe(socket: Client, id = bookingId): Promise<unknown> {
    return signal((resolve) => socket.emit('subscribe', { type: 'booking', id }, resolve));
  }

  it('authenticates via handshake and delivers only owner-bound version hints', async () => {
    const socket = client();
    await connect(socket);
    const initial = signal<unknown>((resolve) => socket.once('recovery.hint', resolve));
    expect(await subscribe(socket)).toEqual({ accepted: true, bookingId });
    expect(await initial).toMatchObject({
      sequence: 1,
      resource: { type: 'booking', id: bookingId, version: 3 },
    });
    const eventId = randomUUID();
    const next = signal<unknown>((resolve) => socket.once('recovery.hint', resolve));
    hints.hint({ eventId, bookingId });
    expect(await next).toEqual({
      eventId,
      sequence: 2,
      resource: { type: 'booking', id: bookingId, version: 3 },
    });
    expect(authorize).toHaveBeenCalledWith('synthetic.access');
  });

  it.each([
    { token: 'synthetic.access', tenantId: randomUUID() },
    { token: 'bad' },
    { room: 'arbitrary' },
  ])('rejects invalid authentication or context selectors %j', async (auth) => {
    const socket = client(auth);
    const error = signal<Error>((resolve) => socket.once('connect_error', resolve));
    socket.connect();
    expect((await error).message).toBe('REALTIME.UNAVAILABLE');
  });

  it.each([
    { query: { token: 'must-not-be-a-url-credential' } },
    { extraHeaders: { Origin: 'https://foreign.invalid' } },
  ])('rejects URL credentials or an unapproved origin', async (options) => {
    const socket = client(undefined, options);
    const error = signal<Error>((resolve) => socket.once('connect_error', resolve));
    socket.connect();
    await error;
    expect(authorize).not.toHaveBeenCalled();
  });

  it('does not disclose a foreign booking or accept a room subscription', async () => {
    for (const input of [
      { type: 'booking', id: randomUUID() },
      { type: 'room', id: bookingId },
    ]) {
      const socket = client();
      await connect(socket);
      const received = jest.fn();
      socket.on('recovery.hint', received);
      const closed = signal<undefined>((resolve) =>
        socket.once('disconnect', () => resolve(undefined)),
      );
      socket.emit('subscribe', input, () => {});
      await closed;
      expect(received).not.toHaveBeenCalled();
    }
  });

  it('rechecks idle connections and disconnects revoked sessions before another hint', async () => {
    const socket = client();
    await connect(socket);
    await subscribe(socket);
    const received = jest.fn();
    socket.on('recovery.hint', received);
    const closed = signal<undefined>((resolve) =>
      socket.once('disconnect', () => resolve(undefined)),
    );
    allowed = false;
    hints.hint({ eventId: randomUUID(), bookingId });
    await closed;
    expect(received).not.toHaveBeenCalled();
  });

  it('fences an in-flight delivery after unsubscribe and closes on authorization deadline', async () => {
    const socket = client();
    await connect(socket);
    await subscribe(socket);
    const received = jest.fn();
    socket.on('recovery.hint', received);
    let release: (value: number) => void = () => {};
    const entered = signal<undefined>((resolve) =>
      version.mockImplementationOnce(() => {
        resolve(undefined);
        return new Promise<number>((yes) => {
          release = yes;
        });
      }),
    );
    hints.hint({ eventId: randomUUID(), bookingId });
    await entered;
    socket.emit('unsubscribe');
    const closed = signal<undefined>((resolve) =>
      socket.once('disconnect', () => resolve(undefined)),
    );
    await closed;
    release(3);
    expect(received).not.toHaveBeenCalled();
  });

  it('disconnects every local socket when its hint source becomes unavailable', async () => {
    const socket = client();
    await connect(socket);
    await subscribe(socket);
    const closed = signal<undefined>((resolve) =>
      socket.once('disconnect', () => resolve(undefined)),
    );
    hints.healthy = false;
    hints.fail();
    await closed;
  });

  it('enforces the session cap when eight handshakes finish authorization together', async () => {
    const releases: ((value: RequestContext) => void)[] = [];
    authorize.mockImplementation(() =>
      releases.length >= 8
        ? Promise.resolve(context)
        : new Promise((resolve) => {
            releases.push(resolve);
            if (releases.length === 8) for (const release of releases) release(context);
          }),
    );
    const results = await Promise.all(
      Array.from({ length: 8 }, () => {
        const socket = client();
        return signal<boolean>((resolve) => {
          socket.once('connect_error', () => resolve(false));
          socket.once('disconnect', () => resolve(false));
          socket.once('connect', () =>
            socket.emit('subscribe', { type: 'booking', id: bookingId }, () => resolve(true)),
          );
          socket.connect();
        });
      }),
    );
    expect(results.filter(Boolean)).toHaveLength(4);
  });
});

describe('broker projection boundary', () => {
  it('projects actual lifecycle examples without copying payload, actor, tenant or patient fields', () => {
    let projected = 0;
    for (const domain of ['booking', 'dispatch', 'trip']) {
      for (const name of readdirSync(join('contracts/events', domain))) {
        const value = JSON.parse(
          readFileSync(join('contracts/events', domain, name, 'v1/example.json'), 'utf8'),
        ) as { stream: { id: string }; eventId: string };
        const hint = projectRecoveryHint(`resq.${domain}.events.v1`, value.stream.id, value);
        if (hint) {
          projected++;
          expect(Object.keys(hint).sort()).toEqual(['bookingId', 'eventId']);
        }
        expect(
          projectRecoveryHint(`resq.${domain}.events.v1`, randomUUID(), value),
        ).toBeUndefined();
      }
    }
    expect(projected).toBe(15);
  });
});
