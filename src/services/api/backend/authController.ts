import { createStore } from 'zustand/vanilla';
import type { otpChallenge } from './decoders';
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
  challenge: ReturnType<typeof otpChallenge> | null;
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

/** Canonical auth state is deliberately separate from the legacy/demo user store. No tokens or OTPs. */
export function createBackendAuthController(session: BackendSession, now = Date.now) {
  const api = createRequesterApi(session);
  const store = createStore<BackendAuthState>(() => ({
    status: 'idle', identity: null, profile: null, challenge: null,
    retryAt: 0, issue: null, notice: null,
  }));
  let generation = 0;
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

  const fail = (error: unknown, status: BackendAuthState['status']) => {
    const retryAt = error instanceof BackendError && error.retryAfterSeconds !== undefined
      ? now() + error.retryAfterSeconds * 1000 : store.getState().retryAt;
    store.setState({ status, issue: issueFor(error), retryAt });
  };

  const loadProfile = async (operation: number) => {
    const identity = session.identity();
    if (!identity) {
      if (generation === operation) store.setState({ status: 'signedOut', identity: null, profile: null });
      return;
    }
    store.setState({ status: 'loadingProfile', identity, profile: null, challenge: null, issue: null, notice: null });
    try {
      const { data } = await api.profile();
      if (operation !== generation) return;
      if (session.identity()?.sessionId !== identity.sessionId || data.id !== identity.userId || data.status !== 'ACTIVE') {
        throw new BackendError({ code: 'CLIENT.PROFILE_INVALID', message: 'The account profile could not be verified.' });
      }
      store.setState({ status: 'authenticated', profile: data, identity: session.identity() });
    } catch (error) {
      if (operation === generation) fail(error, session.identity() ? 'profileError' : 'signedOut');
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
      if (!['signedOut', 'codeSent'].includes(state.status)) return;
      if (now() < state.retryAt) return;
      if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
        fail(new BackendError({ code: 'AUTH.PHONE_INVALID', message: 'Enter a phone number with its country code, such as +977.' }), state.status);
        return;
      }
      const operation = ++generation;
      store.setState({ status: 'requestingCode', challenge: null, issue: null, notice: null });
      try {
        const { data } = await session.requestOtp(phoneNumber);
        if (operation !== generation) return;
        store.setState({ status: 'codeSent', challenge: data, retryAt: now() + 60000,
          notice: 'Code request accepted. Enter the six-digit code if it arrives by SMS.' });
      } catch (error) {
        if (operation === generation) fail(error, 'signedOut');
      }
    },
    async verifyCode(otp: string): Promise<void> {
      const state = store.getState();
      if (state.status !== 'codeSent' || state.challenge === null) return;
      if (now() < state.retryAt && state.issue?.code === 'RATE_LIMIT.EXCEEDED') return;
      if (!/^\d{6}$/.test(otp)) {
        fail(new BackendError({ code: 'AUTH.OTP_INVALID', message: 'Enter all six digits of the verification code.' }), 'codeSent');
        return;
      }
      if (Date.parse(state.challenge.expiresAt) <= now()) {
        store.setState({ challenge: null });
        fail(new BackendError({ code: 'AUTH.OTP_INVALID', message: 'The code has expired. Request a new code.' }), 'signedOut');
        return;
      }
      const operation = ++generation;
      store.setState({ status: 'verifying', issue: null, notice: null });
      try {
        await session.verifyOtp(state.challenge.challengeId, otp);
        if (operation === generation) await loadProfile(operation);
      } catch (error) {
        if (operation !== generation) return;
        const consumedOrUnknown = !(error instanceof BackendError) ||
          !['AUTH.OTP_INVALID', 'RATE_LIMIT.EXCEEDED'].includes(error.code);
        if (consumedOrUnknown) store.setState({ challenge: null });
        fail(error, consumedOrUnknown ? 'signedOut' : 'codeSent');
      }
    },
    changePhone(): void {
      if (!['signedOut', 'codeSent'].includes(store.getState().status)) return;
      generation++;
      store.setState({ status: 'signedOut', challenge: null, issue: null, notice: null });
    },
    async retryProfile(): Promise<void> {
      if (store.getState().status !== 'profileError') return;
      await loadProfile(++generation);
    },
    async logout(): Promise<void> {
      if (store.getState().status === 'signingOut') return;
      const operation = ++generation;
      store.setState({ status: 'signingOut', identity: null, profile: null, challenge: null, issue: null, notice: null });
      try {
        const result = await session.logout();
        if (operation === generation) store.setState({ status: 'signedOut', notice: result.remoteRevocation === 'CONFIRMED'
          ? 'Signed out. The server session was revoked.' : 'Signed out locally. Server revocation was not attempted.' });
      } catch (error) {
        if (operation !== generation) return;
        fail(error, 'signedOut');
        store.setState({ notice: 'Signed out locally. Server revocation or saved-session cleanup could not be confirmed.' });
      }
    },
    dispose(): void {
      generation++;
      unsubscribe();
    },
  };
}

export type BackendAuthController = ReturnType<typeof createBackendAuthController>;
