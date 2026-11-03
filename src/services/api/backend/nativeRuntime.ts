import type { BackendAuthController } from './authController';
import type { createRequesterApi } from './requester';
import type { createDispatchApi } from './dispatch';
import type { VaultScope } from './secureRefreshVault';
import { BackendError } from './errors';
import type { BackendSession } from './session';
import type { DurableCommands } from './durableCommands';
import type { CommandLane } from './commandRegistry';

export interface NativeBackendRuntime {
  auth: BackendAuthController;
  api: ReturnType<typeof createRequesterApi>;
  dispatch: ReturnType<typeof createDispatchApi>;
  generateId: () => string;
  security: Pick<BackendSession, 'beginStepUp' | 'verifyStepUp'>;
  commands: Record<CommandLane, DurableCommands>;
}

/** Web has no native refresh vault. A future browser client must use the cookie contract. */
export async function getNativeBackendRuntime(_scope: VaultScope): Promise<NativeBackendRuntime> {
  throw new BackendError({ code: 'CLIENT.NATIVE_REQUIRED', message: 'Use an Android or iOS development build for the API preview.' });
}
