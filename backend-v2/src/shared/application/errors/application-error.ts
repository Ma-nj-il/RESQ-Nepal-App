export interface ErrorDetail {
  readonly field?: string;
  readonly code: string;
}

export interface ApplicationErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly retryable?: boolean;
  readonly details?: readonly ErrorDetail[];
  readonly cause?: unknown;
}

/** A transport-independent error whose public fields are explicitly allowlisted. */
export class ApplicationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: readonly ErrorDetail[] | undefined;
  override readonly cause: unknown;

  constructor(options: ApplicationErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'ApplicationError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.details =
      options.details === undefined
        ? undefined
        : Object.freeze(options.details.map((detail) => Object.freeze({ ...detail })));
    this.cause = options.cause;
  }
}
