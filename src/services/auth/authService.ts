import { Platform } from 'react-native';
import type { User, UserMode } from '../../types';
import {
  mapUserServiceUser,
  type RecoveryCodeResetRequest,
  type RegisterUserRequest,
  type UpdateUserProfileRequest,
  type UserServiceSession,
  userService,
  UserServiceError,
} from '../api/userService';
import { isSupabaseConfigured, supabase } from '../database/client';
import { sessionStorage, type StoredUserSession } from './sessionStorage';

export interface AuthResult {
  success: boolean;
  message?: string;
  userId?: string;
}

export interface AuthSession {
  user: User;
  mode: UserMode;
}

let activeSession: StoredUserSession | null = null;

const deviceName = (): string => {
  if (Platform.OS === 'ios') return 'RESQ Nepal on iPhone/iPad';
  if (Platform.OS === 'android') return 'RESQ Nepal on Android';
  return 'RESQ Nepal Web';
};

const clearLegacySupabaseSession = async (): Promise<void> => {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
};

const clearLocalSession = async (): Promise<void> => {
  activeSession = null;
  const [markerResult, sessionResult] = await Promise.allSettled([
    sessionStorage.markLoggedOut(),
    sessionStorage.removeSession(),
  ]);
  if (markerResult.status === 'rejected' && sessionResult.status === 'rejected') {
    throw new UserServiceError('The saved session could not be removed from this device.', 0, 'STORAGE_ERROR');
  }
};

const persistLogin = async (
  response: Awaited<ReturnType<typeof userService.login>>,
  persist: boolean,
): Promise<AuthSession> => {
  const mapped = mapUserServiceUser(response.user);
  await clearLegacySupabaseSession();

  const session: StoredUserSession = {
    accessToken: response.access_token || response.token,
    refreshToken: response.refresh_token,
    sessionId: response.session.id,
    persist,
  };
  activeSession = session;

  try {
    if (persist) await sessionStorage.setSession(session);
    else await sessionStorage.removeSession();
    await sessionStorage.clearLoggedOut();
  } catch {
    activeSession = null;
    throw new UserServiceError('The secure session could not be saved on this device.', 0, 'STORAGE_ERROR');
  }
  return mapped;
};

const loadSession = async (): Promise<StoredUserSession | null> => {
  if (activeSession) return activeSession;
  if (await sessionStorage.isLoggedOut()) return null;
  activeSession = await sessionStorage.getSession();
  return activeSession;
};

const refreshSession = async (): Promise<StoredUserSession> => {
  const current = await loadSession();
  if (!current?.refreshToken) {
    throw new UserServiceError('Your session has expired. Please sign in again.', 401, 'AUTH_SESSION_INVALID');
  }
  const response = await userService.refresh(current.refreshToken);
  const next: StoredUserSession = {
    accessToken: response.access_token || response.token,
    refreshToken: response.refresh_token,
    sessionId: response.session.id,
    persist: current.persist,
  };
  activeSession = next;
  if (next.persist) await sessionStorage.setSession(next);
  return next;
};

const withAccessToken = async <T>(operation: (token: string) => Promise<T>): Promise<T> => {
  const session = await loadSession();
  if (!session?.accessToken) {
    throw new UserServiceError('Your session has expired. Please sign in again.', 401, 'AUTH_SESSION_INVALID');
  }
  try {
    return await operation(session.accessToken);
  } catch (error) {
    if (!(error instanceof UserServiceError) || error.status !== 401) throw error;
    try {
      const refreshed = await refreshSession();
      return await operation(refreshed.accessToken);
    } catch (refreshError) {
      if (refreshError instanceof UserServiceError && refreshError.status === 401) {
        await clearLocalSession().catch(() => undefined);
      }
      throw refreshError;
    }
  }
};

export const authService = {
  isConfigured: () => true,

  async register(input: RegisterUserRequest): Promise<AuthSession> {
    return mapUserServiceUser(await userService.register(input));
  },

  async login(email: string, password: string, remember = true): Promise<AuthSession> {
    const persist = remember && Platform.OS !== 'web';
    const response = await userService.login({
      email,
      password,
      remember_me: persist,
      device_name: deviceName(),
    });
    return persistLogin(response, persist);
  },

  async reactivate(email: string, password: string, remember = true): Promise<AuthSession> {
    const persist = remember && Platform.OS !== 'web';
    const response = await userService.reactivate({
      email,
      password,
      remember_me: persist,
      device_name: deviceName(),
    });
    return persistLogin(response, persist);
  },

  async getProfile(): Promise<AuthSession> {
    return mapUserServiceUser(await withAccessToken((token) => userService.getProfile(token)));
  },

  async updateProfile(input: UpdateUserProfileRequest): Promise<AuthSession> {
    return mapUserServiceUser(
      await withAccessToken((token) => userService.updateProfile(token, input)),
    );
  },

  async listSessions(): Promise<UserServiceSession[]> {
    return withAccessToken((token) => userService.listSessions(token));
  },

  async revokeSession(sessionId: string): Promise<void> {
    await withAccessToken((token) => userService.revokeSession(token, sessionId));
    if (activeSession?.sessionId === sessionId) await clearLocalSession();
  },

  async revokeAllSessions(currentPassword: string): Promise<void> {
    await withAccessToken((token) => userService.revokeAllSessions(token, currentPassword));
    await clearLocalSession();
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await withAccessToken((token) =>
      userService.changePassword(token, {
        current_password: currentPassword,
        new_password: newPassword,
      }),
    );
  },

  async regenerateRecoveryCodes(currentPassword: string): Promise<string[]> {
    return withAccessToken((token) => userService.regenerateRecoveryCodes(token, currentPassword));
  },

  resetPasswordWithRecoveryCode(input: RecoveryCodeResetRequest): Promise<void> {
    return userService.resetPasswordWithRecoveryCode(input).then(() => undefined);
  },

  async deactivateAccount(currentPassword: string): Promise<void> {
    await withAccessToken((token) => userService.deactivateAccount(token, currentPassword));
    await clearLocalSession();
  },

  async deleteAccount(currentPassword: string): Promise<void> {
    await withAccessToken((token) => userService.deleteAccount(token, currentPassword));
    await clearLocalSession();
  },

  async signOut(): Promise<void> {
    try {
      if (await loadSession()) {
        await withAccessToken((token) => userService.logout(token));
      }
    } catch {
      // Local logout still completes when the session is already invalid or the service is offline.
    } finally {
      await clearLocalSession();
      await clearLegacySupabaseSession().catch(() => undefined);
    }
  },

  async getSession(): Promise<string | null> {
    return (await loadSession())?.accessToken || null;
  },

  async restoreSession(): Promise<AuthSession | null> {
    const session = await loadSession();
    if (!session) return null;
    try {
      return await this.getProfile();
    } catch (error) {
      if (error instanceof UserServiceError && error.status === 401) return null;
      throw error;
    }
  },

  async signInWithOtp(_phone: string): Promise<AuthResult> {
    return {
      success: false,
      message: 'Phone OTP requires an SMS provider and is not enabled. Sign in with email and password.',
    };
  },

  async verifyOtp(_phone: string, _token: string): Promise<AuthResult> {
    return {
      success: false,
      message: 'Phone OTP requires an SMS provider and is not enabled. Sign in with email and password.',
    };
  },
};
