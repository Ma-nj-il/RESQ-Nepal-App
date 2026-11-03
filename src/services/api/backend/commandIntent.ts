import { BackendError } from './errors';

export interface IntentIdentity {
  readonly idempotencyKey: string;
  readonly expectedVersion?: number;
}

/** In-memory user intent. One owner, no automatic retries, no tokens or persistence. */
export class CommandIntent<T, R> {
  private readonly body: string;
  private readonly identity: IntentIdentity;
  private readonly createdAt: number;
  private inFlight?: Promise<R>;
  private completed?: { result: R };
  private retryAt = 0;
  private lastAttemptAt: number;
  private ambiguous = false;
  private rejected = false;
  private readonly send: (value: T, identity: IntentIdentity) => Promise<R>;
  private readonly now: () => number;

  get canReplace(): boolean { return this.rejected && !this.ambiguous; }

  constructor(
    value: T,
    send: (value: T, identity: IntentIdentity) => Promise<R>,
    generateId: () => string,
    expectedVersion?: number,
    now = Date.now,
  ) {
    this.send = send;
    this.now = now;
    this.body = JSON.stringify(value);
    this.identity = Object.freeze({ idempotencyKey: generateId(), expectedVersion });
    this.createdAt = this.now();
    this.lastAttemptAt = this.createdAt;
  }

  run(): Promise<R> {
    if (this.completed) return Promise.resolve(this.completed.result);
    if (this.inFlight) return this.inFlight;
    const now = this.now();
    // Server default retention is 24h. Leave an hour of margin; clock rollback also blocks replay.
    if (now < this.lastAttemptAt || now - this.createdAt >= 23 * 60 * 60 * 1000) {
      return Promise.reject(new BackendError({ code: 'CLIENT.RECONCILIATION_REQUIRED',
        message: 'Check the server outcome before creating another request. The retry window has closed.' }));
    }
    if (now < this.retryAt) return Promise.reject(new BackendError({
      code: 'CLIENT.RETRY_LATER', message: 'Wait before retrying the same request.',
      retryAfterSeconds: Math.ceil((this.retryAt - now) / 1000),
    }));
    this.lastAttemptAt = now;
    const promise = Promise.resolve().then(() => this.send(JSON.parse(this.body) as T, this.identity))
      .then((result) => { this.completed = { result }; return result; })
      .catch((error: unknown) => {
        this.rejected = error instanceof BackendError && !error.code.startsWith('CLIENT.') &&
          ([400, 403, 404, 412, 422].includes(error.status) || (error.status === 409 && error.code === 'REQUEST.STALE_VERSION'));
        if (!this.rejected) this.ambiguous = true;
        if (error instanceof BackendError && error.retryAfterSeconds !== undefined) {
          this.retryAt = this.now() + error.retryAfterSeconds * 1000;
        }
        throw error;
      });
    this.inFlight = promise;
    void promise.finally(() => { if (this.inFlight === promise) this.inFlight = undefined; }).catch(() => {});
    return promise;
  }
}
