import { mfaChallenge } from './decoders';
import { BackendError, invalidResponse } from './errors';
import type { BackendSession } from './session';

export interface StepUpState {
  status: 'idle' | 'starting' | 'pending' | 'verifying' | 'complete' | 'unknown' | 'error';
  challenge?: ReturnType<typeof mfaChallenge>;
  message?: string;
}
type Port = Pick<BackendSession, 'identity' | 'subscribe' | 'beginStepUp' | 'verifyStepUp'>;

/** Component-owned challenge only. Codes and credentials never enter snapshots or durable commands. */
export class MfaStepUp {
  private state: StepUpState = { status: 'idle' };
  private readonly listeners = new Set<() => void>();
  private stopSession?: () => void;
  private owner?: string;
  private generation = 0;
  private connection = 0;
  private disposed = true;
  private active = false;
  private abort?: AbortController;
  private expiry?: ReturnType<typeof setTimeout>;
  private startedAt = 0;
  private retryAt = 0;
  private readonly session: Port;
  private readonly now: () => number;

  constructor(session: Port, now = Date.now) { this.session = session; this.now = now; }

  connect(): () => void {
    this.clear(); this.stopSession?.(); this.disposed = false; this.active = false;
    const connection = ++this.connection;
    this.owner = this.sessionOwner();
    this.stopSession = this.session.subscribe(() => {
      const owner = this.sessionOwner();
      if (owner !== this.owner) { this.clear(); this.owner = owner; this.publish({ status: 'idle' }); }
    });
    this.publish({ status: 'idle' });
    return () => { if (connection === this.connection) this.dispose(); };
  }

  getSnapshot = (): StepUpState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  async start(): Promise<void> {
    if (this.disposed || !this.active || !this.owner || this.owner !== this.sessionOwner() ||
        ['starting', 'pending', 'verifying', 'unknown'].includes(this.state.status)) return;
    if (this.now() < this.retryAt) { this.publish({ ...this.state, message: 'Wait before starting another verification.' }); return; }
    this.clear(); this.startedAt = this.now();
    const generation = this.generation, abort = new AbortController(); this.abort = abort;
    this.publish({ status: 'starting' });
    try {
      if (!this.current(generation)) return;
      const { data } = await this.session.beginStepUp(abort.signal);
      if (!this.current(generation)) return;
      const challenge = mfaChallenge(data), lifetime = Date.parse(challenge.expiresAt) - this.now();
      if (this.now() < this.startedAt || lifetime <= 0 || lifetime > 3600000) invalidResponse();
      this.armExpiry(challenge, generation);
      this.publish({ status: 'pending', challenge });
    } catch (error) {
      if (!this.current(generation)) return;
      this.rememberRetry(error); this.clear();
      this.publish({ status: 'error', message: 'Verification could not be started. Check your connection and access.' });
    }
  }

  async verify(code: string): Promise<void> {
    const challenge = this.state.challenge;
    if (this.disposed || !this.active || this.state.status !== 'pending' || !challenge) return;
    if (this.expired(challenge)) { this.expire(); return; }
    if (this.now() < this.retryAt) { this.publish({ ...this.state, message: 'Wait before trying another code.' }); return; }
    if (!/^\d{6}$/.test(code)) { this.publish({ ...this.state, message: 'Enter the six-digit authenticator code.' }); return; }
    this.clear();
    const generation = this.generation, abort = new AbortController(); this.abort = abort;
    this.publish({ status: 'verifying' });
    try {
      if (!this.current(generation)) return;
      await this.session.verifyStepUp(challenge.challengeId, code, abort.signal);
      if (this.current(generation)) {
        this.clear(); this.publish({ status: 'complete', message: 'Authenticator verification confirmed by the server.' });
      }
    } catch (error) {
      if (!this.current(generation)) return;
      this.rememberRetry(error);
      const definitive = error instanceof BackendError && !error.retryable &&
        ((error.status === 401 && error.code === 'AUTH.MFA_INVALID') ||
         (error.status === 429 && error.code === 'RATE_LIMIT.EXCEEDED'));
      this.clear();
      if (definitive && !this.expired(challenge)) {
        this.armExpiry(challenge, this.generation);
        this.publish({ status: 'pending', challenge, message: error.code === 'AUTH.MFA_INVALID'
          ? 'The code was rejected. Check your authenticator and try again.' : 'Wait before trying another code.' });
      } else {
        const exhausted = error instanceof BackendError && error.status === 429 && error.code === 'AUTH.MFA_ATTEMPTS_EXCEEDED';
        this.publish({ status: definitive || exhausted ? 'error' : 'unknown', message: definitive || exhausted
          ? 'The challenge is no longer usable. Start a new verification.'
          : 'Verification outcome is unconfirmed. Close this attempt before starting a new challenge.' });
      }
    }
  }

  setActive(active: boolean): void {
    this.active = active;
    if (this.disposed) return;
    if (this.state.challenge && this.expired(this.state.challenge)) { this.expire(); return; }
    if (!active && ['starting', 'verifying'].includes(this.state.status)) {
      const verifying = this.state.status === 'verifying'; this.clear();
      this.publish({ status: verifying ? 'unknown' : 'error', message: verifying
        ? 'Verification outcome is unconfirmed. Close this attempt before starting a new challenge.'
        : 'Verification interrupted. Start again.' });
    }
  }

  cancel(): void { this.clear(); this.publish({ status: 'idle' }); }
  dispose(): void {
    this.clear(); this.connection++; this.disposed = true; this.active = false;
    this.stopSession?.(); this.stopSession = undefined; this.publish({ status: 'idle' });
  }

  private sessionOwner(): string | undefined {
    const identity = this.session.identity();
    return identity ? `${identity.userId}:${identity.sessionId}` : undefined;
  }
  private current(generation: number): boolean {
    return !this.disposed && this.active && generation === this.generation && this.owner !== undefined && this.owner === this.sessionOwner();
  }
  private expired(challenge: ReturnType<typeof mfaChallenge>): boolean {
    return this.now() < this.startedAt || Date.parse(challenge.expiresAt) <= this.now();
  }
  private armExpiry(challenge: ReturnType<typeof mfaChallenge>, generation: number): void {
    this.expiry = setTimeout(() => { if (!this.disposed && generation === this.generation) this.expire(); }, Date.parse(challenge.expiresAt) - this.now());
  }
  private expire(): void { this.clear(); this.publish({ status: 'error', message: 'Verification expired. Start again.' }); }
  private rememberRetry(error: unknown): void {
    if (error instanceof BackendError && error.retryAfterSeconds !== undefined)
      this.retryAt = Math.max(this.retryAt, this.now() + error.retryAfterSeconds * 1000);
  }
  private clear(): void {
    this.generation++; this.abort?.abort(); this.abort = undefined;
    if (this.expiry) clearTimeout(this.expiry); this.expiry = undefined;
  }
  private publish(state: StepUpState): void {
    this.state = state;
    for (const listener of this.listeners) { try { listener(); } catch { /* View listeners do not own verification. */ } }
  }
}
