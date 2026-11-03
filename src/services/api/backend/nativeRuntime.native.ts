import * as SecureStore from 'expo-secure-store';
import { randomUUID, digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { createDispatchApi } from './dispatch';
import { createBackendAuthController } from './authController';
import { createRequesterApi } from './requester';
import { BackendSession } from './session';
import { BackendTransport } from './transport';
import { createSecureRefreshVault, refreshVaultKey, type VaultScope } from './secureRefreshVault';
import { BackendError } from './errors';
import type { NativeBackendRuntime } from './nativeRuntime';
import { DurableCommands } from './durableCommands';
import { createCommandHandlers } from './commandRegistry';
import { createSecureCommandVault } from './secureCommandVault';
import { createRequesterRealtime } from './realtime';
import { MfaEnrollment } from './mfaEnrollment';
import { MfaStepUp } from './mfaStepUp';

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
    const auth = createBackendAuthController(session);
    const api = createRequesterApi(session);
    const dispatch = createDispatchApi(session);
    const handlers = createCommandHandlers(api, dispatch);
    const owner = () => auth.store.getState().status === 'authenticated' ? auth.store.getState().identity : null;
    const lane = (name: 'account' | 'product' | 'dispatch') => new DurableCommands(name, handlers,
      (userId) => createSecureCommandVault(SecureStore, scope, userId, name,
        (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value)), owner, randomUUID);
    const commands = { account: lane('account'), product: lane('product'), dispatch: lane('dispatch') };
    auth.store.subscribe(() => { for (const command of Object.values(commands)) command.activate(owner()); });
    return { auth, api, dispatch, commands, realtime: createRequesterRealtime(session, scope.origin), generateId: randomUUID,
      security: { beginStepUp: (signal?: AbortSignal) => session.beginStepUp(signal),
        verifyStepUp: (id: string, code: string, signal?: AbortSignal) => session.verifyStepUp(id, code, signal),
        createEnrollment: () => new MfaEnrollment(session), createStepUp: () => new MfaStepUp(session) } };
  })();
  instance = { key, promise };
  void promise.catch(() => { if (instance?.promise === promise) instance = undefined; });
  return promise;
}
