import { createStore } from 'zustand/vanilla';
import type { otpChallenge, mfaChallenge } from './decoders';
import { BackendError } from './errors';
import { createRequesterApi, type profile } from './requester';
import type { BackendSession, SessionIdentity } from './session';

export interface AuthIssue {
  code: string;
  message: string;
  requestId?: string;
}

export interface BackendAuthState {
  status: 'idle' | 'restoring' | 'signedOut' | 'requestingCode' | 'codeSent' |
    'verifying' | 'loadingProfile' | 'profileError' | 'authenticated' | 'signingOut';
  identity: SessionIdentity | null;
  profile: ReturnType<typeof profile> | null;
  method: 'OTP' | 'PASSWORD';
  challenge: ReturnType<typeof otpChallenge> | ReturnType<typeof mfaChallenge> | null;
  retryAt: number;
  issue: AuthIssue | null;
  notice: string | null;
}

function issueFor(error: unknown): AuthIssue {
  if (error instanceof BackendError) {
    return { code: error.code, message: error.message, requestId: error.requestId };
  }
  return { code: 'CLIENT.AUTH_UNAVAILABLE', message: 'Unable to complete sign-in. Please try again.' };
}

/** Canonical auth state is separate from the legacy/demo store. No tokens, passwords or codes. */
export function createBackendAuthController(session: BackendSession, now = Date.now) {
  const api = createRequesterApi(session);
  const store = createStore<BackendAuthState>(() => ({
    status: 'idle', identity: null, profile: null, challenge: null, method: 'OTP',
    retryAt: 0, issue: null, notice: null,
  }));
  let generation = 0;
  let passwordAbort: AbortController | undefined;
  let challengeStartedAt = 0;
  let startPromise: Promise<void> | undefined;
  const unsubscribe = session.subscribe((identity) => {
    const state = store.getState();
    if (identity === null) {
      const ended = ['authenticated', 'profileError'].includes(state.status);
      store.setState({
        identity: null, profile: null,
        ...(ended ? { status: 'signedOut', challenge: null, notice: 'Your session ended. Please sign in again.' } as const : {}),
      });
    } else {
      store.setState({ identity });
    }
  });

  const fail = (error: unknown, status: BackendAuthState['status'], patch: Partial<BackendAuthState> = {}) => {
    const retryAt = error instanceof BackendError && error.retryAfterSeconds !== undefined
      ? now() + error.retryAfterSeconds * 1000 : store.getState().retryAt;
    store.setState({ ...patch, status, issue: issueFor(error), retryAt });
  };

  const loadProfile = async (operation: number) => {
    if (generation !== operation) return;
    const identity = session.identity();
    if (!identity) {
      if (generation === operation) store.setState({ status: 'signedOut', identity: null, profile: null });
      return;
    }
    store.setState({ status: 'loadingProfile', identity, profile: null, challenge: null, issue: null, notice: null });
    try {
      if (generation !== operation) return;
      const { data } = await api.profile(passwordAbort?.signal);
      if (operation !== generation) return;
      if (session.identity()?.sessionId !== identity.sessionId || session.identity()?.userId !== identity.userId ||
          data.id !== identity.userId || data.status !== 'ACTIVE') {
        throw new BackendError({ code: 'CLIENT.PROFILE_INVALID', message: 'The account profile could not be verified.' });
      }
      store.setState({ status: 'authenticated', profile: data, identity: session.identity() });
    } catch (error) {
      if (operation === generation) fail(error, session.identity() ? 'profileError' : 'signedOut');
    }
  };

  const logout = async (): Promise<void> => {
    if (store.getState().status === 'signingOut') return;
    const operation = ++generation;
    passwordAbort?.abort(); passwordAbort = undefined;
    store.setState({ status: 'signingOut', identity: null, profile: null, challenge: null, issue: null, notice: null });
    try {
      const result = await session.logout();
      if (operation === generation) store.setState({ status: 'signedOut', notice: result.remoteRevocation === 'CONFIRMED'
        ? 'Signed out. The server session was revoked.' : 'Signed out locally. Server revocation was not attempted.' });
    } catch (error) {
      if (operation !== generation) return;
      fail(error, 'signedOut', { notice: 'Signed out locally. Server revocation or saved-session cleanup could not be confirmed.' });
    }
  };

  return {
    store,
    start(): Promise<void> {
      if (startPromise) return startPromise;
      const operation = ++generation;
      store.setState({ status: 'restoring', issue: null });
      startPromise = (async () => {
        try {
          if (operation !== generation) return;
          const identity = await session.restore();
          if (operation !== generation) return;
          if (identity) await loadProfile(operation);
          else store.setState({ status: 'signedOut' });
        } catch (error) {
          if (operation === generation) fail(error, 'signedOut');
        }
      })();
      return startPromise;
    },
    async requestCode(phoneNumber: string): Promise<void> {
      const state = store.getState();
      if (state.method !== 'OTP' || !['signedOut', 'codeSent'].includes(state.status)) return;
      if (now() < state.retryAt) return;
      if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
        fail(new BackendError({ code: 'AUTH.PHONE_INVALID', message: 'Enter a phone number with its country code, such as +977.' }), state.status);
        return;
      }
      const operation = ++generation;
      store.setState({ status: 'requestingCode', challenge: null, issue: null, notice: null });
      try {
        if (operation !== generation) return;
        const { data } = await session.requestOtp(phoneNumber);
        if (operation !== generation) return;
        store.setState({ status: 'codeSent', challenge: data, retryAt: now() + 60000,
          notice: 'Code request accepted. Enter the six-digit code if it arrives by SMS.' });
      } catch (error) {
        if (operation === generation) fail(error, 'signedOut');
      }
    },
    async requestPassword(identifier: string, password: string): Promise<void> {
      const state = store.getState();
      if (state.method !== 'PASSWORD' || state.status !== 'signedOut' || now() < state.retryAt) return;
      const operation = ++generation;
      const abort = new AbortController(); passwordAbort = abort;
      challengeStartedAt = now();
      store.setState({ status: 'requestingCode', challenge: null, issue: null, notice: null });
      try {
        if (operation !== generation) return;
        const { data } = await session.requestPasswordChallenge(identifier, password, abort.signal);
        if (operation !== generation) return;
        if (now() < challengeStartedAt || Date.parse(data.expiresAt) <= now()) throw new BackendError({ code: 'CLIENT.CHALLENGE_EXPIRED', message: 'Start sign-in again.' });
        store.setState({ status: 'codeSent', challenge: data,
          notice: 'Password accepted. Enter the six-digit code from your enrolled authenticator.' });
      } catch (error) {
        if (operation === generation) fail(error, 'signedOut');
      }
    },
    async verifyCode(otp: string): Promise<void> {
      const state = store.getState();
      if (state.status !== 'codeSent' || state.challenge === null) return;
      if (now() < state.retryAt && state.issue?.code === 'RATE_LIMIT.EXCEEDED') return;
      if (!/^\d{6}$/.test(otp)) {
        fail(new BackendError({ code: state.method === 'PASSWORD' ? 'CLIENT.MFA_CODE_INVALID' : 'AUTH.OTP_INVALID', message: 'Enter all six digits of the verification code.' }), 'codeSent');
        return;
      }
      if (Date.parse(state.challenge.expiresAt) <= now() || (state.method === 'PASSWORD' && now() < challengeStartedAt)) {
        fail(new BackendError({ code: state.method === 'OTP' ? 'AUTH.OTP_INVALID' : 'CLIENT.CHALLENGE_EXPIRED', message: 'The code has expired. Start sign-in again.' }), 'signedOut', { challenge: null });
        return;
      }
      const operation = ++generation;
      store.setState({ status: 'verifying', issue: null, notice: null });
      try {
        if (operation !== generation) return;
        if (state.method === 'PASSWORD') await session.verifyPasswordMfa(state.challenge.challengeId, otp, passwordAbort?.signal);
        else await session.verifyOtp(state.challenge.challengeId, otp);
        if (operation === generation) await loadProfile(operation);
      } catch (error) {
        if (operation !== generation) return;
        const definitiveRejection = error instanceof BackendError && !error.retryable &&
          ((error.status === 401 && error.code === (state.method === 'PASSWORD' ? 'AUTH.MFA_INVALID' : 'AUTH.OTP_INVALID')) ||
           (error.status === 429 && error.code === 'RATE_LIMIT.EXCEEDED'));
        const retain = definitiveRejection && Date.parse(state.challenge.expiresAt) > now() &&
          (state.method !== 'PASSWORD' || now() >= challengeStartedAt);
        fail(error, retain ? 'codeSent' : 'signedOut', { challenge: retain ? state.challenge : null });
      }
    },
    changePhone(): void {
      if (!['signedOut', 'codeSent'].includes(store.getState().status)) return;
      generation++;
      passwordAbort?.abort(); passwordAbort = undefined;
      store.setState({ status: 'signedOut', challenge: null, issue: null, notice: null });
    },
    changeMethod(method: BackendAuthState['method']): void {
      if (!['signedOut', 'codeSent'].includes(store.getState().status)) return;
      generation++;
      passwordAbort?.abort(); passwordAbort = undefined;
      store.setState({ method, status: 'signedOut', challenge: null, issue: null, notice: null });
    },
    async retryProfile(): Promise<void> {
      if (store.getState().status !== 'profileError') return;
      await loadProfile(++generation);
    },
    logout,
    async suspendPasswordSignIn(): Promise<void> {
      const state = store.getState();
      if (state.method === 'PASSWORD' && ['requestingCode', 'verifying', 'loadingProfile'].includes(state.status)) await logout();
    },
    dispose(): void {
      generation++;
      passwordAbort?.abort(); passwordAbort = undefined;
      unsubscribe();
    },
  };
}

export type BackendAuthController = ReturnType<typeof createBackendAuthController>;
