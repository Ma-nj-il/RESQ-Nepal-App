export interface BackendErrorOptions {
  code: string;
  message: string;
  status?: number;
  retryable?: boolean;
  requestId?: string;
  retryAfterSeconds?: number;
  details?: readonly { field?: string; code: string }[];
}

/** Contains public protocol fields only; never attach a request, token or raw response. */
export class BackendError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly details?: BackendErrorOptions['details'];

  constructor(options: BackendErrorOptions) {
    super(options.message);
    this.name = 'BackendError';
    this.code = options.code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}

export function invalidResponse(): never {
  throw new BackendError({
    code: 'CLIENT.INVALID_RESPONSE',
    message: 'The service returned an unsupported response.',
  });
}

export function sessionChanged(): BackendError {
  return new BackendError({
    code: 'CLIENT.SESSION_CHANGED',
    message: 'The session changed. Please try again.',
  });
}
