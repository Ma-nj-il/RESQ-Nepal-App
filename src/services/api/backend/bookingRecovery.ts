import { integer, object, oneOf, uuid } from './decoders';
import type { RecoverySnapshot } from './dispatch';
import { BackendError, invalidResponse } from './errors';
import type { SessionIdentity } from './session';

export interface RecoveryState {
  status: 'idle' | 'loading' | 'ready' | 'stale' | 'error' | 'blocked';
  bookingId?: string;
  snapshot?: RecoverySnapshot;
  message?: string;
}
const hintShape = object({
  sequence: integer(1),
  resource: object({ type: oneOf(['booking', 'trip']), id: uuid, version: integer(1) }),
});

/** Memory-only recovery owner. Live events invalidate reads; they never write business state. */
export class BookingRecovery {
  private state: RecoveryState = { status: 'idle' };
  private owner?: string;
  private generation = 0;
  private connection = 0;
  private revision = 0;
  private active = true;
  private pending = false;
  private flight?: { generation: number; promise: Promise<void>; abort: AbortController };
  private timer?: ReturnType<typeof setTimeout>;
  private freshSince?: number;
  private readonly sequences = new Map<string, number>();
  private readonly versions = new Map<string, number>();
  private readonly listeners = new Set<(state: RecoveryState) => void>();
  private readonly load: (bookingId: string, signal: AbortSignal) => Promise<RecoverySnapshot>;
  private readonly now: () => number;
  private readonly freshForMs: number;

  constructor(load: (bookingId: string, signal: AbortSignal) => Promise<RecoverySnapshot>,
    now = Date.now, freshForMs = 15000) {
    if (!Number.isFinite(freshForMs) || freshForMs < 1 || freshForMs > 30000) throw new Error('Invalid recovery freshness budget.');
    this.load = load; this.now = now; this.freshForMs = freshForMs;
  }

  getState(): RecoveryState {
    if (this.state.status === 'ready' && (this.freshSince === undefined || this.now() < this.freshSince || this.now() - this.freshSince >= this.freshForMs)) this.stale();
    return this.state;
  }

  /** Stable, side-effect-free snapshot for React's external-store subscription. */
  getSnapshot = (): RecoveryState => this.state;

  subscribe = (listener: (state: RecoveryState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  activate(identity: SessionIdentity | null): void {
    const owner = identity ? `${identity.userId}:${identity.sessionId}` : undefined;
    if (owner === this.owner) return;
    this.reset(); this.owner = owner;
    this.publish({ status: 'idle' });
  }

  select(bookingId: string): Promise<void> {
    uuid(bookingId);
    if (!this.owner) return Promise.resolve();
    if (this.state.bookingId !== bookingId || this.state.status === 'blocked') {
      this.reset(); this.publish({ status: 'stale', bookingId });
    }
    return this.refresh();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.generation++; this.connection++; this.flight?.abort.abort(); this.flight = undefined;
    this.sequences.clear(); this.stale();
    if (active) void this.refresh();
  }

  /** A transport must bind callbacks to this epoch; old connection callbacks are ignored. */
  reconnect(): number {
    this.connection++; this.sequences.clear(); this.invalidate();
    return this.connection;
  }

  disconnect(): void {
    this.connection++; this.sequences.clear(); this.revision++; this.stale();
  }

  receiveHint(connection: number, value: unknown): void {
    if (connection !== this.connection || !this.active || !this.owner || !this.state.bookingId) return;
    let hint: ReturnType<typeof hintShape>;
    try { hint = hintShape(value); } catch { this.invalidate(); return; }
    const resource = hint.resource;
    const id = resource.type === 'booking' ? this.state.bookingId : this.state.snapshot?.trip?.id;
    if (resource.id !== id) return;
    const key = `${resource.type}:${id}`;
    const previous = this.sequences.get(key);
    const version = this.versions.get(key) ?? 0;
    // Conflicting duplicates also force recovery; sequence gaps cannot authorize a state patch.
    if (previous !== undefined && hint.sequence <= previous && resource.version <= version) return;
    this.sequences.set(key, Math.max(previous ?? 0, hint.sequence));
    this.versions.set(key, Math.max(version, resource.version));
    this.invalidate();
  }

  invalidate(): void {
    this.revision++; this.stale(); void this.refresh();
  }

  observeBookingVersion(bookingId: string, version: number): void {
    uuid(bookingId); integer(1)(version);
    if (bookingId !== this.state.bookingId) return;
    const key = `booking:${bookingId}`;
    this.versions.set(key, Math.max(version, this.versions.get(key) ?? 0));
    this.invalidate();
  }

  /** Only GET recovery is retried/coalesced. No lifecycle command is dispatched here. */
  refresh(): Promise<void> {
    if (!this.active || !this.owner || !this.state.bookingId || this.state.status === 'blocked') return Promise.resolve();
    if (this.flight?.generation === this.generation) { this.pending = true; return this.flight.promise; }
    const generation = this.generation;
    const abort = new AbortController();
    const promise = Promise.resolve().then(() => this.drain(generation, abort.signal));
    this.flight = { generation, abort, promise };
    void promise.finally(() => { if (this.flight?.promise === promise) this.flight = undefined; }).catch(() => {});
    return promise;
  }

  dispose(): void {
    this.reset(); this.owner = undefined; this.state = { status: 'idle' }; this.listeners.clear();
  }

  private async drain(generation: number, signal: AbortSignal): Promise<void> {
    // Bound catch-up work during an invalidation storm. A later hint/manual retry can resume it.
    for (let pass = 0; pass < 2 && generation === this.generation; pass++) {
      const bookingId = this.state.bookingId;
      if (!bookingId || !this.active) return;
      this.pending = false;
      const revision = this.revision, startedAt = this.now();
      this.clearTimer(); this.publish({ ...this.state, status: 'loading', message: undefined });
      try {
        const snapshot = await this.load(bookingId, signal);
        if (generation !== this.generation || signal.aborted) return;
        if (snapshot.booking.id !== bookingId) invalidResponse();
        const resources = [ { type: 'booking', ...snapshot.booking },
          ...(snapshot.trip ? [{ type: 'trip', ...snapshot.trip }] : []),
          ...(snapshot.assignment ? [{ type: 'assignment', ...snapshot.assignment }] : []) ];
        const prior = this.state.snapshot;
        if ((prior?.trip && prior.trip.id !== snapshot.trip?.id) ||
            (prior?.assignment && prior.assignment.id !== snapshot.assignment?.id) ||
            resources.some(resource => resource.version < (this.versions.get(`${resource.type}:${resource.id}`) ?? 0))) {
          this.publish({ ...this.state, status: 'stale', message: 'Recovery is behind a known change. Refresh again.' });
          return;
        }
        for (const resource of resources) this.versions.set(`${resource.type}:${resource.id}`, resource.version);
        this.freshSince = startedAt;
        const fresh = revision === this.revision && this.now() >= startedAt && this.now() - startedAt < this.freshForMs;
        this.publish({ status: fresh ? 'ready' : 'stale', bookingId, snapshot });
        if (fresh) this.timer = setTimeout(() => this.stale(), this.freshForMs - (this.now() - startedAt));
      } catch (error) {
        if (generation !== this.generation || signal.aborted) return;
        const blocked = error instanceof BackendError && [401, 403, 404].includes(error.status ?? 0);
        this.publish({ bookingId, status: blocked ? 'blocked' : 'error',
          ...(blocked ? {} : { snapshot: this.state.snapshot }),
          message: error instanceof BackendError ? error.message : 'Unable to recover booking state.' });
        return;
      }
      if (!this.pending) return;
    }
  }

  private stale(): void {
    this.clearTimer(); this.freshSince = undefined;
    if (this.state.bookingId && this.state.status !== 'blocked') this.publish({ ...this.state, status: 'stale' });
  }

  private reset(): void {
    this.generation++; this.connection++; this.revision++; this.pending = false;
    this.flight?.abort.abort(); this.flight = undefined; this.clearTimer(); this.freshSince = undefined;
    this.sequences.clear(); this.versions.clear();
  }

  private clearTimer(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  private publish(state: RecoveryState): void {
    this.state = state;
    for (const listener of this.listeners) { try { listener(state); } catch { /* UI listeners do not own recovery. */ } }
  }
}
