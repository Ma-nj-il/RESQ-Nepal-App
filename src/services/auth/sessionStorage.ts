import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const USER_SERVICE_SESSION_KEY = 'resq.user-service.session';
const LEGACY_TOKEN_KEY = 'resq.user-service.token';
const USER_SERVICE_LOGGED_OUT_KEY = 'resq.user-service.logged-out';

export interface StoredUserSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  persist: boolean;
}

const getSecureValue = async (): Promise<string | null> => {
  if (Platform.OS === 'web') return AsyncStorage.getItem(USER_SERVICE_SESSION_KEY);
  return SecureStore.getItemAsync(USER_SERVICE_SESSION_KEY);
};

const setSecureValue = async (value: string): Promise<void> => {
  if (Platform.OS === 'web') return AsyncStorage.setItem(USER_SERVICE_SESSION_KEY, value);
  return SecureStore.setItemAsync(USER_SERVICE_SESSION_KEY, value);
};

const removeSecureValue = async (): Promise<void> => {
  if (Platform.OS === 'web') await AsyncStorage.removeItem(USER_SERVICE_SESSION_KEY);
  else await SecureStore.deleteItemAsync(USER_SERVICE_SESSION_KEY);
  await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
};

export const sessionStorage = {
  async getSession(): Promise<StoredUserSession | null> {
    const raw = await getSecureValue();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredUserSession>;
      if (
        typeof parsed.accessToken !== 'string' ||
        typeof parsed.refreshToken !== 'string' ||
        typeof parsed.sessionId !== 'string'
      ) {
        return null;
      }
      return { ...parsed, persist: parsed.persist !== false } as StoredUserSession;
    } catch {
      return null;
    }
  },

  setSession(session: StoredUserSession): Promise<void> {
    return setSecureValue(JSON.stringify(session));
  },

  removeSession(): Promise<void> {
    return removeSecureValue();
  },

  async isLoggedOut(): Promise<boolean> {
    return (await AsyncStorage.getItem(USER_SERVICE_LOGGED_OUT_KEY)) === 'true';
  },

  markLoggedOut(): Promise<void> {
    return AsyncStorage.setItem(USER_SERVICE_LOGGED_OUT_KEY, 'true');
  },

  clearLoggedOut(): Promise<void> {
    return AsyncStorage.removeItem(USER_SERVICE_LOGGED_OUT_KEY);
  },
};
