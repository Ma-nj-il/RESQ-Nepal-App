import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { createDispatchApi } from './dispatch';
import { createBackendAuthController } from './authController';
import { createRequesterApi } from './requester';
import { BackendSession } from './session';
import { BackendTransport } from './transport';
import { createSecureRefreshVault, refreshVaultKey, type VaultScope } from './secureRefreshVault';
import { BackendError } from './errors';
import type { NativeBackendRuntime } from './nativeRuntime';

// Module lifetime ownership survives component remounts without starting a second refresh owner.
let instance: { key: string; promise: Promise<NativeBackendRuntime> } | undefined;

export function getNativeBackendRuntime(scope: VaultScope): Promise<NativeBackendRuntime> {
  const key = refreshVaultKey(scope);
  if (instance) {
    if (instance.key !== key) return Promise.reject(new BackendError({
      code: 'CLIENT.RELOAD_REQUIRED', message: 'Reload the app before changing the API environment.',
    }));
    return instance.promise;
  }
  const promise = (async () => {
    if (!await SecureStore.isAvailableAsync().catch(() => false)) throw new BackendError({
      code: 'CLIENT.SECURE_STORAGE_UNAVAILABLE', message: 'Secure session storage is unavailable on this device.',
    });
    const transport = new BackendTransport({ origin: scope.origin });
    const session = new BackendSession(transport, createSecureRefreshVault(SecureStore, scope));
    return { auth: createBackendAuthController(session), api: createRequesterApi(session),
      dispatch: createDispatchApi(session), generateId: randomUUID,
      security: { beginStepUp: () => session.beginStepUp(), verifyStepUp: (id: string, code: string) => session.verifyStepUp(id, code) } };
  })();
  instance = { key, promise };
  void promise.catch(() => { if (instance?.promise === promise) instance = undefined; });
  return promise;
}
