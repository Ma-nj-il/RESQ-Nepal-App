import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import type { RequestContext } from '../../shared/application/context/request-context.js';
import type { RecoveryHint, RecoveryHintSource } from '../application/recovery-hint.js';

interface ClientEvents {
  subscribe: (value: unknown, ack?: (value: unknown) => void) => void;
  unsubscribe: () => void;
}
interface ServerEvents {
  'recovery.hint': (value: {
    eventId: string;
    sequence: number;
    resource: { type: 'booking'; id: string; version: number };
  }) => void;
}
interface SocketData {
  identity?: { userId: string; sessionId: string };
  token?: string;
}
type PeerSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>;
interface Peer {
  socket: PeerSocket;
  token: string;
  generation: number;
  bookingId?: string;
  busy: boolean;
  pending?: RecoveryHint | undefined;
  sequence: number;
  recent: Set<string>;
  timer?: NodeJS.Timeout;
  credits: number;
  creditAt: number;
  lease?: NodeJS.Timeout;
}
const handshake = z.object({ token: z.string().regex(/^[A-Za-z0-9._~-]{1,8192}$/) }).strict();
const subscription = z.object({ type: z.literal('booking'), id: z.uuid() }).strict();

/** Transport adapter: each delivery rechecks live HTTP-equivalent auth and requester ownership. */
export class RequesterRealtimeServer {
  private readonly io: Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>;
  private readonly peers = new Set<Peer>();
  private readonly stopHints: () => void;
  private readonly sweep: NodeJS.Timeout;
  private outstanding = 0;
  private closed = false;

  constructor(
    http: HttpServer,
    private readonly source: RecoveryHintSource,
    private readonly access: {
      authorize(token: string): Promise<RequestContext>;
      bookingVersion(context: RequestContext, id: string): Promise<number>;
    },
    options: {
      origins: readonly string[];
      maxConnections?: number;
      recheckMs?: number;
      deadlineMs?: number;
    },
  ) {
    const maximum = options.maxConnections ?? 256;
    this.deadlineMs = options.deadlineMs ?? 4000;
    this.io = new Server(http, {
      path: '/realtime',
      serveClient: false,
      transports: ['websocket'],
      maxHttpBufferSize: 16384,
      connectTimeout: 5000,
      pingInterval: 15000,
      pingTimeout: 10000,
      perMessageDeflate: false,
      allowRequest: (request, done) => {
        const url = new URL(request.url ?? '/', 'http://realtime.invalid');
        const allowedQuery = [...url.searchParams.keys()].every((key) =>
          ['EIO', 'transport', 'sid', 't', 'b64'].includes(key),
        );
        done(
          null,
          !this.closed &&
            this.source.ready() &&
            this.io.engine.clientsCount < maximum &&
            allowedQuery &&
            (request.headers.origin === undefined ||
              options.origins.includes(request.headers.origin)),
        );
      },
    });
    // Upgrade callbacks can pass admission before another connection is registered.
    this.io.engine.on('connection', (connection: { close(discard: boolean): void }) => {
      if (this.io.engine.clientsCount > maximum) connection.close(true);
    });
    const namespace = this.io.of('/realtime');
    this.io.of('/').use((_socket, next) => {
      next(new Error('REALTIME.UNAVAILABLE'));
    });
    namespace.use((socket, next) => {
      const parsed = handshake.safeParse(socket.handshake.auth);
      socket.handshake.auth = {};
      if (!parsed.success) {
        next(new Error('REALTIME.UNAVAILABLE'));
        return;
      }
      void this.bounded(() => this.access.authorize(parsed.data.token)).then(
        (context) => {
          if (
            this.closed ||
            !this.source.ready() ||
            context.actor?.type !== 'USER' ||
            !context.sessionId ||
            [...this.peers].filter(
              (peer) => peer.socket.data.identity?.sessionId === context.sessionId,
            ).length >= 4
          ) {
            next(new Error('REALTIME.UNAVAILABLE'));
            return;
          }
          socket.data.identity = { userId: context.actor.id, sessionId: context.sessionId };
          socket.data.token = parsed.data.token;
          next();
        },
        () => {
          next(new Error('REALTIME.UNAVAILABLE'));
        },
      );
    });
    namespace.on('connection', (socket) => this.connected(socket));
    this.stopHints = source.subscribe(
      (hint) => {
        for (const peer of this.peers) {
          if (peer.bookingId !== hint.bookingId || peer.recent.has(hint.eventId)) continue;
          peer.pending = hint;
          this.schedule(peer);
        }
      },
      () => {
        for (const peer of this.peers) peer.socket.disconnect(true);
      },
    );
    this.sweep = setInterval(() => {
      for (const peer of this.peers) {
        if (!this.source.ready()) peer.socket.disconnect(true);
        else if (!peer.busy) this.schedule(peer, true);
      }
    }, options.recheckMs ?? 5000);
    this.sweep.unref();
  }
  private readonly deadlineMs: number;

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.sweep);
    this.stopHints();
    for (const peer of this.peers) peer.socket.disconnect(true);
    // Closing the engine leaves ownership of the shared HTTP server with Nest.
    this.io.engine.close();
    await this.io.of('/realtime').adapter.close();
    await this.io.of('/').adapter.close();
  }

  private connected(socket: PeerSocket): void {
    const token = socket.data.token;
    delete socket.data.token;
    if (
      !token ||
      !this.source.ready() ||
      this.closed ||
      [...this.peers].filter(
        (peer) => peer.socket.data.identity?.sessionId === socket.data.identity?.sessionId,
      ).length >= 4
    ) {
      delete socket.data.identity;
      socket.disconnect(true);
      return;
    }
    const peer: Peer = {
      socket,
      token,
      generation: 0,
      busy: false,
      sequence: 0,
      recent: new Set(),
      credits: 12,
      creditAt: Date.now(),
    };
    this.peers.add(peer);
    this.renewLease(peer);
    socket.on('disconnect', () => {
      peer.generation++;
      peer.token = '';
      peer.pending = undefined;
      if (peer.timer) clearTimeout(peer.timer);
      if (peer.lease) clearTimeout(peer.lease);
      peer.recent.clear();
      this.peers.delete(peer);
      delete socket.data.identity;
    });
    socket.on('unsubscribe', () => {
      peer.generation++;
      delete peer.bookingId;
      peer.pending = undefined;
      peer.recent.clear();
    });
    socket.on('subscribe', (value, ack) => {
      const parsed = subscription.safeParse(value);
      if (!parsed.success || !this.credit(peer) || peer.busy) {
        socket.disconnect(true);
        return;
      }
      peer.generation++;
      const generation = peer.generation;
      peer.bookingId = parsed.data.id;
      peer.recent.clear();
      // A hint is issued after authorization even if no broker event occurred during subscription.
      peer.pending = { bookingId: parsed.data.id, eventId: randomUUID() };
      void this.check(peer, true).then(() => {
        if (
          this.current(peer, generation) &&
          peer.bookingId === parsed.data.id &&
          typeof ack === 'function'
        )
          ack({ accepted: true, bookingId: parsed.data.id });
      });
    });
  }

  private credit(peer: Peer): boolean {
    const now = Date.now();
    peer.credits = Math.min(12, peer.credits + Math.max(0, now - peer.creditAt) / 5000);
    peer.creditAt = now;
    if (peer.credits < 1) return false;
    peer.credits--;
    return true;
  }

  private schedule(peer: Peer, force = false): void {
    if (peer.timer || peer.busy || !peer.socket.connected || (!peer.pending && !force)) return;
    peer.timer = setTimeout(() => {
      delete peer.timer;
      void this.check(peer);
    }, 250);
    peer.timer.unref();
  }

  private async check(peer: Peer, admission = false): Promise<void> {
    if (peer.busy || !peer.socket.connected) return;
    if (this.outstanding >= 16) {
      if (admission) peer.socket.disconnect(true);
      else this.schedule(peer, true);
      return;
    }
    peer.busy = true;
    const generation = peer.generation,
      bookingId = peer.bookingId,
      hint = peer.pending;
    peer.pending = undefined;
    try {
      const version = await this.bounded(async () => {
        const context = await this.access.authorize(peer.token);
        if (
          context.actor?.id !== peer.socket.data.identity?.userId ||
          context.sessionId !== peer.socket.data.identity?.sessionId
        )
          throw new Error('Realtime identity changed');
        return bookingId === undefined ? undefined : this.access.bookingVersion(context, bookingId);
      });
      if (!this.current(peer, generation)) return;
      this.renewLease(peer);
      if (hint && version !== undefined && bookingId) {
        if (
          !Number.isSafeInteger(version) ||
          version < 1 ||
          peer.sequence >= Number.MAX_SAFE_INTEGER
        )
          throw new Error('Invalid realtime version');
        peer.recent.add(hint.eventId);
        const oldest = peer.recent.values().next().value;
        if (peer.recent.size > 128 && oldest !== undefined) peer.recent.delete(oldest);
        // Volatile delivery cannot accumulate a hidden replay queue during network backpressure.
        peer.socket.volatile.emit('recovery.hint', {
          eventId: hint.eventId,
          sequence: ++peer.sequence,
          resource: { type: 'booking', id: bookingId, version },
        });
      }
    } catch {
      peer.socket.disconnect(true);
    } finally {
      peer.busy = false;
      this.schedule(peer);
    }
  }

  private current(peer: Peer, generation: number): boolean {
    return peer.socket.connected && generation === peer.generation && this.source.ready();
  }

  private renewLease(peer: Peer): void {
    if (peer.lease) clearTimeout(peer.lease);
    peer.lease = setTimeout(() => peer.socket.disconnect(true), 10000);
    peer.lease.unref();
  }

  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed || !this.source.ready() || this.outstanding >= 16)
      throw new Error('Realtime unavailable');
    this.outstanding++;
    const task = Promise.resolve()
      .then(work)
      .finally(() => {
        this.outstanding--;
      });
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        task,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Realtime authorization deadline')),
            this.deadlineMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
