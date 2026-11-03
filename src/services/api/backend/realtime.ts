import { io, type Socket } from 'socket.io-client';
import type { BackendSession } from './session';
import { boolean, object, uuid } from './decoders';

interface Received { 'recovery.hint': (value: unknown) => void }
interface Sent { subscribe: (value: { type: 'booking'; id: string }, ack: (value: unknown) => void) => void }
type Connection = Socket<Received, Sent>;
const acknowledgement = object({ accepted: boolean, bookingId: uuid });
export interface RealtimeCallbacks {
  connected(): void;
  hint(value: unknown): void;
  disconnected(): void;
}

/** Each subscription owns its socket, abort signal and bounded reconnect budget. No stored credentials. */
export function createRequesterRealtime(session: Pick<BackendSession, 'authenticateRealtime'>, origin: string,
  connect: typeof io = io) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Realtime requires the configured HTTPS API origin.');
  return {
    subscribe(bookingId: string, callbacks: RealtimeCallbacks): () => void {
      uuid(bookingId);
      const abort = new AbortController();
      let socket: Connection | undefined, retry: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined, attempts = 0, generation = 0;
      const detach = () => {
        generation++;
        if (deadline) clearTimeout(deadline); deadline = undefined;
        if (socket) { socket.auth = {}; socket.removeAllListeners(); socket.disconnect(); socket = undefined; }
      };
      const failed = () => {
        if (abort.signal.aborted) return;
        detach(); callbacks.disconnected();
        if (abort.signal.aborted || retry || attempts >= 5) return;
        retry = setTimeout(() => { retry = undefined; start(); }, Math.min(30000, 1000 * 2 ** attempts) + Math.random() * 500);
      };
      const start = () => {
        if (abort.signal.aborted) return;
        const attempt = ++generation; attempts++;
        void session.authenticateRealtime(auth => {
          if (abort.signal.aborted || generation !== attempt) return;
          const current: Connection = connect(`${url.origin}/realtime`, { path: '/realtime', transports: ['websocket'],
            forceNew: true, reconnection: false, autoConnect: false, timeout: 5000, auth });
          socket = current;
          const valid = () => !abort.signal.aborted && socket === current && generation === attempt;
          current.on('connect', () => {
            if (!valid()) return;
            current.auth = {}; callbacks.connected();
            if (!valid()) return;
            current.emit('subscribe', { type: 'booking', id: bookingId }, value => {
              if (!valid()) return;
              try {
                const ack = acknowledgement(value);
                if (!ack.accepted || ack.bookingId !== bookingId) { failed(); return; }
                attempts = 0; if (deadline) clearTimeout(deadline); deadline = undefined;
              } catch { failed(); }
            });
          });
          current.on('recovery.hint', value => { if (valid()) callbacks.hint(value); });
          current.on('disconnect', () => { if (valid()) failed(); });
          current.on('connect_error', () => { if (valid()) failed(); });
          deadline = setTimeout(() => { if (valid()) failed(); }, 10000);
          current.connect();
        }, abort.signal).catch(() => { if (!abort.signal.aborted && generation === attempt) failed(); });
      };
      start();
      return () => { abort.abort(); if (retry) clearTimeout(retry); retry = undefined; detach(); };
    },
  };
}
