import { object, timestamp, uuid, text } from './decoders';
import { BackendError, invalidResponse } from './errors';
import type { BackendSession } from './session';

export const totpEnrollment = object({ factorId: uuid, expiresAt: timestamp, sharedSecret: (value: unknown) => {
  const secret = text(value);
  if (!/^[A-Z2-7]{32,128}$/.test(secret)) invalidResponse();
  return secret;
} });
export interface EnrollmentState {
  status: 'idle' | 'starting' | 'pending' | 'verifying' | 'complete' | 'unknown' | 'error';
  factorId?: string;
  expiresAt?: string;
  sharedSecret?: string;
  message?: string;
}
type Port = Pick<BackendSession, 'identity' | 'subscribe' | 'createTotpEnrollment' | 'verifyTotpEnrollment'>;

/** Component-owned, memory-only enrollment. Secrets never enter session state or durable commands. */
export class MfaEnrollment {
  private state: EnrollmentState = { status: 'idle' };
  private readonly listeners = new Set<() => void>();
  private stopSession?: () => void;
  private generation = 0;
  private owner: string | undefined;
  private active = false;
  private disposed = true;
  private connection = 0;
  private abort?: AbortController;
  private expiry?: ReturnType<typeof setTimeout>;
  private startedAt = 0;
  private retryAt = 0;
  private readonly session: Port;
  private readonly now: () => number;

  constructor(session: Port, now = Date.now) {
    this.session = session; this.now = now;
  }

  connect(): () => void {
    this.clear();
    this.disposed = false;
    this.stopSession?.();
    const connection = ++this.connection;
    const identity = this.session.identity();
    this.owner = identity ? `${identity.userId}:${identity.sessionId}` : undefined;
    this.publish({ status: 'idle' });
    this.stopSession = this.session.subscribe(identity => {
      const owner = identity ? `${identity.userId}:${identity.sessionId}` : undefined;
      if (owner !== this.owner) { this.clear(); this.owner = owner; this.publish({ status: 'idle' }); }
    });
    return () => { if (connection === this.connection) this.dispose(); };
  }
  getSnapshot = (): EnrollmentState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  async start(label: string): Promise<void> {
    if (this.disposed || !this.active || !this.owner || ['starting', 'pending', 'verifying', 'unknown'].includes(this.state.status)) return;
    if (this.now() < this.retryAt) { this.publish({ ...this.state, message: 'Wait before starting another enrollment.' }); return; }
    if (label.trim().length < 2 || label.trim().length > 160) { this.publish({ status: 'error', message: 'Enter a label between 2 and 160 characters.' }); return; }
    this.clear(); this.startedAt = this.now();
    const generation = this.generation, abort = new AbortController(); this.abort = abort;
    this.publish({ status: 'starting' });
    try {
      if (!this.current(generation)) return;
      const { data } = await this.session.createTotpEnrollment(label.trim(), abort.signal);
      if (!this.current(generation)) return;
      const enrollment = totpEnrollment(data);
      const lifetime = Date.parse(enrollment.expiresAt) - this.now();
      if (this.now() < this.startedAt || lifetime <= 0 || lifetime > 3600000) invalidResponse();
      this.expiry = setTimeout(() => { this.clear(); this.publish({ status: 'error', message: 'Enrollment expired. Start again.' }); }, lifetime);
      this.publish({ status: 'pending', ...enrollment });
    } catch (error) {
      if (this.current(generation)) this.failed(error, false);
    }
  }

  async verify(code: string): Promise<void> {
    if (this.disposed || !this.active || this.state.status !== 'pending' || !this.state.factorId) return;
    if (this.expired()) { this.clear(); this.publish({ status: 'error', message: 'Enrollment expired. Start again.' }); return; }
    if (this.now() < this.retryAt) { this.publish({ ...this.state, message: 'Wait before trying another code.' }); return; }
    if (!/^\d{6}$/.test(code)) { this.publish({ ...this.state, message: 'Enter the six-digit authenticator code.' }); return; }
    const generation = this.generation, factorId = this.state.factorId;
    const abort = new AbortController(); this.abort = abort;
    if (this.expiry) clearTimeout(this.expiry); this.expiry = undefined;
    this.publish({ ...this.state, sharedSecret: undefined, status: 'verifying', message: undefined });
    try {
      if (!this.current(generation)) return;
      await this.session.verifyTotpEnrollment(factorId, code, abort.signal);
      if (this.current(generation)) { this.clear(); this.publish({ status: 'complete', message: 'Authenticator enrollment confirmed by the server.' }); }
    } catch (error) {
      if (this.current(generation)) this.failed(error, true);
    }
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!this.disposed && this.state.status === 'pending' && this.expired()) {
      this.clear(); this.publish({ status: 'error', message: 'Enrollment expired. Start again.' }); return;
    }
    if (active || this.disposed) return;
    if (['starting', 'verifying'].includes(this.state.status)) {
      const verifying = this.state.status === 'verifying'; this.clear();
      this.publish({ status: verifying ? 'unknown' : 'error', message: verifying
        ? 'Enrollment outcome is unconfirmed. Use authenticator verification to check access.' : 'Enrollment interrupted. Start again.' });
    } else if (this.state.sharedSecret) this.publish({ ...this.state, sharedSecret: undefined });
  }
  cancel(): void { this.clear(); this.publish({ status: 'idle' }); }
  dispose(): void { this.clear(); this.connection++; this.disposed = true; this.active = false; this.stopSession?.(); this.stopSession = undefined; this.publish({ status: 'idle' }); }

  private expired(): boolean { return this.now() < this.startedAt || !(Date.parse(this.state.expiresAt ?? '') > this.now()); }
  private current(generation: number): boolean { return !this.disposed && this.active && generation === this.generation; }
  private clear(): void {
    this.generation++; this.abort?.abort(); this.abort = undefined;
    if (this.expiry) clearTimeout(this.expiry); this.expiry = undefined;
  }
  private failed(error: unknown, verification: boolean): void {
    this.clear();
    if (error instanceof BackendError && error.retryAfterSeconds !== undefined)
      this.retryAt = this.now() + error.retryAfterSeconds * 1000;
    this.publish({ status: verification ? 'unknown' : 'error', message: verification
      ? 'Enrollment outcome is unconfirmed. Use authenticator verification to check access.'
      : 'Enrollment could not be started. Try again after checking your connection and access.' });
  }
  private publish(state: EnrollmentState): void { this.state = state; for (const listener of this.listeners) { try { listener(); } catch { /* View listeners do not own enrollment. */ } } }
}
