import type { RequestContextStorage } from '../../infrastructure/context/request-context.storage.js';

export function successResponse<T>(
  contexts: RequestContextStorage,
  data: T,
): {
  readonly data: T;
  readonly meta: { readonly requestId: string };
} {
  return { data, meta: { requestId: contexts.require().requestId } };
}
