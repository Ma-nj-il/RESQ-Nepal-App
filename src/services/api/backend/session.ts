import {
  mobileSession, noContent, otpChallenge, mfaChallenge, refreshCredentials,
  object, oneOf, timestamp, uuid, text, type MobileSession, type RefreshCredentials,
} from './decoders';
import { BackendError, invalidResponse, sessionChanged } from './errors';
import { BackendTransport, type BackendRequest, type BackendResponse } from './transport';
import { totpEnrollment } from './mfaEnrollment';

const upgradedAccess = object({ userId: uuid, sessionId: uuid, assurance: oneOf(['AAL2']), accessToken: text, accessTokenExpiresAt: timestamp });

/** Native integration must provide exclusive, secure, atomic storage scoped to the API origin.
 * Do not implement with AsyncStorage, localStorage, logs or a persisted UI store.
 */
export interface RefreshVault {
  read(): Promise<unknown | null>;
  write(credentials: RefreshCredentials): Promise<void>;
  clear(): Promise<void>;
}

export interface SessionIdentity {
  userId: string;
  sessionId: string;
  assurance: 'AAL1' | 'AAL2';
}

function authenticationRequired(): BackendError {
  return new BackendError({
    code: 'AUTH.AUTHENTICATION_REQUIRED', message: 'Please sign in to continue.', status: 401,
  });
}

/** One instance owns one vault. Access tokens stay in memory, outside the application store. */
export class BackendSession {
  private readonly transport: BackendTransport;
  private readonly vault: RefreshVault;
  private readonly now: () => number;
  private current?: MobileSession;
  private generation = 0;
  private initialized = false;
  private restoring?: Promise<SessionIdentity | null>;
  private refreshing?: { generation: number; promise: Promise<void> };
  private storageTail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(identity: SessionIdentity | null) => void>();

  constructor(transport: BackendTransport, vault: RefreshVault, now = Date.now) {
    this.transport = transport;
    this.vault = vault;
    this.now = now;
  }

  identity(): SessionIdentity | null {
    const session = this.current;
    return session ? { userId: session.userId, sessionId: session.sessionId, assurance: session.assurance } : null;
  }

  /** Token-free lifecycle events, including revocation triggered by any API request. */
  subscribe(listener: (identity: SessionIdentity | null) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  requestOtp(phoneNumber: string) {
    return this.transport.request({
      path: '/api/v1/auth/otp-challenges', method: 'POST', decode: otpChallenge,
      body: { phoneNumber, purpose: 'REGISTRATION_OR_LOGIN' },
    });
  }

  async verifyOtp(challengeId: string, otp: string, deviceLabel?: string): Promise<SessionIdentity> {
    return this.establishSession({
      path: '/api/v1/auth/otp-verifications', method: 'POST', decode: mobileSession,
      body: { challengeId, otp, clientType: 'MOBILE', ...(deviceLabel === undefined ? {} : { deviceLabel }) },
    });
  }

  requestPasswordChallenge(identifier: string, password: string, signal?: AbortSignal) {
    if (identifier.trim().length < 3 || identifier.trim().length > 320 || password.length < 12 || password.length > 1024)
      throw new BackendError({ code: 'CLIENT.CREDENTIALS_INVALID', message: 'Enter your account identifier and password.' });
    return this.transport.request({ path: '/api/v1/auth/password-sessions', method: 'POST', decode: mfaChallenge,
      body: { identifier: identifier.trim(), password, clientType: 'MOBILE' }, signal });
  }

  async verifyPasswordMfa(challengeId: string, code: string, signal?: AbortSignal): Promise<SessionIdentity> {
    if (!/^\d{6}$/.test(code)) throw new BackendError({ code: 'CLIENT.MFA_CODE_INVALID', message: 'Enter the six-digit authenticator code.' });
    return this.establishSession({ path: `/api/v1/auth/mfa-challenges/${uuid(challengeId)}/verifications`, method: 'POST', body: { code }, signal,
      decode: value => {
        const session = mobileSession(value);
        if (session.assurance !== 'AAL2') invalidResponse();
        return session;
      } });
  }

  private async establishSession(input: BackendRequest<MobileSession>): Promise<SessionIdentity> {
    this.checkCancellation(input.signal);
    // Capture ownership before clearLocal notifies synchronous lifecycle listeners.
    const generation = this.generation + 1;
    const clearing = this.clearLocal();
    await clearing;
    this.assertCurrent(generation);
    try {
      this.checkCancellation(input.signal);
      const result = await this.transport.request(input);
      this.checkCancellation(input.signal);
      await this.persist(result.data, generation, input.signal);
      this.assertCurrent(generation);
      return this.identity()!;
    } catch (error) {
      if (generation === this.generation) await this.clearLocal();
      throw error;
    }
  }

  beginStepUp(signal?: AbortSignal) {
    return this.request({ path: '/api/v1/auth/mfa-challenges', method: 'POST',
      decode: mfaChallenge, signal });
  }

  /** Step-up returns access credentials only; rotating refresh credentials remain owned here. */
  async verifyStepUp(challengeId: string, code: string, signal?: AbortSignal): Promise<SessionIdentity> {
    if (!/^\d{6}$/.test(code)) throw new BackendError({ code: 'CLIENT.MFA_CODE_INVALID', message: 'Enter the six-digit authenticator code.' });
    const generation = this.generation;
    const { data } = await this.requestWithAccess({
      path: `/api/v1/auth/mfa-challenges/${uuid(challengeId)}/verifications`, method: 'POST', body: { code },
      decode: upgradedAccess, signal,
    }, true);
    return this.applyUpgradedAccess(data, generation, signal);
  }

  createTotpEnrollment(label: string, signal?: AbortSignal) {
    if (label.length < 2 || label.length > 160) throw new BackendError({ code: 'CLIENT.MFA_LABEL_INVALID', message: 'Enter an authenticator label.' });
    return this.request({ path: '/api/v1/me/mfa/totp-enrollments', method: 'POST', body: { label }, decode: totpEnrollment, signal });
  }

  async verifyTotpEnrollment(factorId: string, code: string, signal?: AbortSignal): Promise<SessionIdentity> {
    if (!/^\d{6}$/.test(code)) throw new BackendError({ code: 'CLIENT.MFA_CODE_INVALID', message: 'Enter the six-digit authenticator code.' });
    const generation = this.generation;
    const { data } = await this.requestWithAccess({ path: `/api/v1/me/mfa/totp-enrollments/${uuid(factorId)}/verification`,
      method: 'POST', body: { code }, decode: upgradedAccess, signal }, true);
    this.checkCancellation(signal);
    return this.applyUpgradedAccess(data, generation, signal);
  }

  private async applyUpgradedAccess(data: ReturnType<typeof upgradedAccess>, generation: number, signal?: AbortSignal): Promise<SessionIdentity> {
    // Wait for any older rotation so it cannot overwrite the new assurance/access token.
    if (this.refreshing) await this.refreshing.promise;
    this.assertCurrent(generation);
    this.checkCancellation(signal);
    if (!this.current || data.userId !== this.current.userId || data.sessionId !== this.current.sessionId ||
        !/^[A-Za-z0-9._~-]+$/.test(data.accessToken) || Date.parse(data.accessTokenExpiresAt) <= this.now()) invalidResponse();
    this.current = { ...this.current, ...data };
    this.emitIdentity();
    this.assertCurrent(generation);
    return this.identity()!;
  }

  restore(): Promise<SessionIdentity | null> {
    if (this.restoring) return this.restoring;
    if (this.initialized) return Promise.resolve(this.identity());
    this.initialized = true;
    const generation = this.generation;
    const restore = async () => {
      try {
        const stored = await this.storage(() => this.vault.read());
        this.assertCurrent(generation);
        if (stored === null) return null;
        await this.refresh(refreshCredentials(stored), generation);
        this.assertCurrent(generation);
        return this.identity();
      } catch (error) {
        if (generation === this.generation) await this.clearLocal();
        throw error;
      }
    };
    const promise = restore();
    this.restoring = promise;
    void promise.finally(() => {
      if (this.restoring === promise) this.restoring = undefined;
    }).catch(() => {});
    return promise;
  }

  request<T>(input: BackendRequest<T>): Promise<BackendResponse<T>> {
    return this.requestWithAccess(input);
  }

  private async requestWithAccess<T>(input: BackendRequest<T>, mfaVerification = false): Promise<BackendResponse<T>> {
    this.checkCancellation(input.signal);
    // Snapshot command identity before asynchronous refresh; never regenerate a key or version.
    const request = {
      ...input, query: { ...input.query },
      body: input.body === undefined ? undefined : JSON.parse(JSON.stringify(input.body)),
    };
    const generation = this.generation;
    await this.restore();
    this.assertCurrent(generation);
    this.checkCancellation(input.signal);
    if (!this.current) throw authenticationRequired();
    if (Date.parse(this.current.accessTokenExpiresAt) <= this.now() + 30000) {
      await this.refresh(this.current, generation);
    }
    this.assertCurrent(generation);
    this.checkCancellation(input.signal);
    const accessToken = this.current!.accessToken;
    try {
      const result = await this.transport.request(request, accessToken);
      this.assertCurrent(generation);
      return result;
    } catch (error) {
      this.assertCurrent(generation);
      if (!(error instanceof BackendError) || error.status !== 401) throw error;
      if (mfaVerification && error.code === 'AUTH.MFA_INVALID' && !error.retryable) throw error;
      if (!['AUTH.ACCESS_TOKEN_EXPIRED', 'AUTH.ACCESS_TOKEN_STALE'].includes(error.code)) {
        await this.clearLocal();
        throw error;
      }
      this.checkCancellation(input.signal);
      // A late rejection for the preceding token must use the already-rotated token.
      if (this.current?.accessToken === accessToken) await this.refresh(this.current, generation);
      this.assertCurrent(generation);
      this.checkCancellation(input.signal);
      try {
        const result = await this.transport.request(request, this.current!.accessToken);
        this.assertCurrent(generation);
        return result;
      } catch (retryError) {
        this.assertCurrent(generation);
        if (retryError instanceof BackendError && retryError.status === 401 &&
            !(mfaVerification && retryError.code === 'AUTH.MFA_INVALID' && !retryError.retryable)) await this.clearLocal();
        throw retryError;
      }
    }
  }

  /** Supply handshake auth only after any rotating credentials have been safely persisted. */
  async authenticateRealtime(send: (authentication: { token: string }) => void, signal: AbortSignal): Promise<void> {
    this.checkCancellation(signal);
    const generation = this.generation;
    await this.restore();
    this.assertCurrent(generation); this.checkCancellation(signal);
    if (this.refreshing?.generation === generation) await this.refreshing.promise;
    this.assertCurrent(generation); this.checkCancellation(signal);
    if (!this.current) throw authenticationRequired();
    if (Date.parse(this.current.accessTokenExpiresAt) <= this.now() + 30000) await this.refresh(this.current, generation);
    this.assertCurrent(generation); this.checkCancellation(signal);
    // Only the transport callback receives an in-memory access token; refresh credentials never leave this owner.
    send({ token: this.current!.accessToken });
  }

  /** Clears local state immediately. A rejected promise means remote revocation is unconfirmed. */
  async logout(): Promise<{ remoteRevocation: 'CONFIRMED' | 'NOT_ATTEMPTED' }> {
    const previous = this.current;
    await this.clearLocal();
    if (!previous) return { remoteRevocation: 'NOT_ATTEMPTED' };
    await this.transport.request({
      path: '/api/v1/auth/sessions/current', method: 'DELETE', decode: noContent,
    }, previous.accessToken);
    return { remoteRevocation: 'CONFIRMED' };
  }

  private refresh(credentials: RefreshCredentials, generation: number): Promise<void> {
    if (this.refreshing?.generation === generation) return this.refreshing.promise;
    const promise = this.rotate(credentials, generation);
    this.refreshing = { generation, promise };
    void promise.finally(() => {
      if (this.refreshing?.promise === promise) this.refreshing = undefined;
    }).catch(() => {});
    return promise;
  }

  private async rotate(credentials: RefreshCredentials, generation: number): Promise<void> {
    try {
      this.assertCurrent(generation);
      if (Date.parse(credentials.refreshTokenExpiresAt) <= this.now()) throw authenticationRequired();
      // A crash/lost response after dispatch cannot leave a consumed token on disk.
      await this.storage(async () => {
        this.assertCurrent(generation);
        await this.vault.clear();
      });
      this.assertCurrent(generation);
      const result = await this.transport.request({
        path: '/api/v1/auth/tokens/refresh', method: 'POST', decode: mobileSession,
        body: { refreshToken: credentials.refreshToken },
      });
      this.assertCurrent(generation);
      if (result.data.userId !== credentials.userId || result.data.sessionId !== credentials.sessionId ||
          result.data.refreshToken === credentials.refreshToken) invalidResponse();
      await this.persist(result.data, generation);
    } catch (error) {
      if (generation === this.generation) await this.clearLocal();
      throw error;
    }
  }

  private persist(session: MobileSession, generation: number, signal?: AbortSignal): Promise<void> {
    if (Date.parse(session.accessTokenExpiresAt) <= this.now() ||
        Date.parse(session.refreshTokenExpiresAt) <= this.now()) invalidResponse();
    return this.storage(async () => {
      this.assertCurrent(generation);
      this.checkCancellation(signal);
      await this.vault.write(refreshCredentials(session));
      this.assertCurrent(generation);
      this.checkCancellation(signal);
      this.current = session;
      this.emitIdentity();
    });
  }

  private clearLocal(): Promise<void> {
    this.generation++;
    this.initialized = true;
    this.current = undefined;
    this.restoring = undefined;
    // Queue the clear before listeners can enqueue a newer sign-in's storage work.
    const clearing = this.storage(() => this.vault.clear());
    this.emitIdentity();
    return clearing;
  }

  private emitIdentity(): void {
    for (const listener of this.listeners) {
      // A consumer exception must not turn a successfully persisted rotation into token reuse.
      try { listener(this.identity()); } catch { /* Listener failures cannot change session ownership. */ }
    }
  }

  private storage<T>(work: () => Promise<T>): Promise<T> {
    const next = this.storageTail.then(work).catch((error: unknown) => {
      if (error instanceof BackendError) throw error;
      throw new BackendError({
        code: 'CLIENT.SECURE_STORAGE_UNAVAILABLE', message: 'Secure session storage is unavailable.',
      });
    });
    this.storageTail = next.catch(() => {});
    return next;
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw sessionChanged();
  }

  private checkCancellation(signal?: AbortSignal): void {
    if (signal?.aborted) throw new BackendError({ code: 'CLIENT.CANCELLED', message: 'The request was cancelled.' });
  }
}
