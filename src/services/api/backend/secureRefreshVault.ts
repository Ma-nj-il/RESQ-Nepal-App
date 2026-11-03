import type * as SecureStore from 'expo-secure-store';
import { refreshCredentials } from './decoders';
import { BackendError } from './errors';
import type { RefreshVault } from './session';

type SecureStorePort = Pick<typeof SecureStore,
  'isAvailableAsync' | 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync' | 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'>;

export interface VaultScope {
  origin: string;
  environment: string;
}

export function normalizeVaultScope(scope: VaultScope): VaultScope {
  let url: URL;
  try { url = new URL(scope.origin); } catch { throw new Error('Invalid API storage scope.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || url.origin.length > 512 ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(scope.environment)) throw new Error('Invalid API storage scope.');
  return { origin: url.origin, environment: scope.environment };
}

/** Injective encoding: replacing URL punctuation with underscores would collide across origins. */
export function refreshVaultKey(input: VaultScope): string {
  const scope = normalizeVaultScope(input);
  const hex = (value: string) => Array.from(value, (character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `resq.backend.v1.${hex(scope.environment)}.${hex(scope.origin)}`;
}

/** A single small Keychain/Keystore value; no access token, profile or plaintext fallback. */
export function createSecureRefreshVault(store: SecureStorePort, input: VaultScope): RefreshVault {
  const scope = normalizeVaultScope(input);
  const key = refreshVaultKey(scope);
  const options: SecureStore.SecureStoreOptions = {
    keychainService: key,
    keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  };
  const available = async () => {
    if (!await store.isAvailableAsync()) throw new Error('Unavailable');
  };
  const native = async <T>(work: () => Promise<T>): Promise<T> => {
    try { await available(); return await work(); } catch {
      throw new BackendError({
        code: 'CLIENT.SECURE_STORAGE_UNAVAILABLE', message: 'Secure session storage is unavailable on this device.',
      });
    }
  };
  return {
    async read() {
      const raw = await native(() => store.getItemAsync(key, options));
      if (raw === null) return null;
      try {
        if (raw.length > 2048) throw new Error('Invalid record');
        const value = JSON.parse(raw);
        if (value?.formatVersion !== 1 || value.origin !== scope.origin || value.environment !== scope.environment) {
          throw new Error('Invalid scope');
        }
        return refreshCredentials(value.credentials);
      } catch {
        throw new BackendError({ code: 'CLIENT.SESSION_STORAGE_INVALID', message: 'The saved session is invalid. Please sign in again.' });
      }
    },
    async write(credentials) {
      const raw = JSON.stringify({ formatVersion: 1, ...scope, credentials: refreshCredentials(credentials) });
      // All accepted fields are ASCII; keep below the historical iOS 2 KiB limit.
      if (raw.length > 2048) throw new BackendError({
        code: 'CLIENT.SESSION_STORAGE_INVALID', message: 'The session cannot be saved on this device.',
      });
      await native(() => store.setItemAsync(key, raw, options));
    },
    clear: () => native(() => store.deleteItemAsync(key, options)),
  };
}
