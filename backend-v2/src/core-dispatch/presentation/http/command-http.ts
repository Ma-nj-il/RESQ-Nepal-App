import type { Response } from 'express';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import type {
  IdempotentResult,
  JsonValue,
} from '../../../shared/application/idempotency/idempotency.js';
import type { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { successResponse } from '../../../shared/presentation/http/success-response.js';

export function expectedVersion(ifMatch: string | undefined): number {
  if (ifMatch === undefined) {
    throw new ApplicationError({
      code: 'REQUEST.PRECONDITION_REQUIRED',
      message: 'An If-Match version is required.',
      status: 428,
    });
  }
  const match = /^(?:W\/)??"?(\d+)"?$/.exec(ifMatch.trim());
  const version = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ApplicationError({
      code: 'REQUEST.IF_MATCH_INVALID',
      message: 'The If-Match version is invalid.',
      status: 400,
      details: [{ field: 'If-Match', code: 'INVALID' }],
    });
  }
  return version;
}

export function idempotencyKey(value: string | undefined): string {
  return value ?? '';
}

export function idempotentResponse(
  contexts: RequestContextStorage,
  result: IdempotentResult<JsonValue>,
  response: Response,
): unknown {
  response.status(result.status);
  response.setHeader('Idempotency-Replayed', String(result.replayed));
  return successResponse(contexts, result.value);
}
