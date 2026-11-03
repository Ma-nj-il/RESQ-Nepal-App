import { normalizeVaultScope, type VaultScope } from './secureRefreshVault';

export type BackendPreviewConfig =
  | { kind: 'disabled' }
  | { kind: 'invalid'; message: string }
  | { kind: 'enabled'; scope: VaultScope };

/** Explicit development entry, not a production cutover switch. */
export function resolveBackendPreview(input: {
  development: boolean; enabled?: string; origin?: string; environment?: string;
}): BackendPreviewConfig {
  if (!input.development || input.enabled !== '1') return { kind: 'disabled' };
  try {
    const scope = normalizeVaultScope({ origin: input.origin ?? '', environment: input.environment ?? '' });
    if (!scope.origin.startsWith('https://') || !['local', 'test', 'staging'].includes(scope.environment)) throw new Error('Invalid preview');
    return { kind: 'enabled', scope };
  } catch {
    return { kind: 'invalid', message: 'Configure an HTTPS backend origin and a local, test, or staging environment for the API preview.' };
  }
}
