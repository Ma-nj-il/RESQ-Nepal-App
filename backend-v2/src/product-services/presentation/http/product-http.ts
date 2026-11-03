import type { Response } from 'express';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import type {
  IdempotentResult,
  JsonValue,
} from '../../../shared/application/idempotency/idempotency.js';
import type { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { successResponse } from '../../../shared/presentation/http/success-response.js';

export function expectedProductVersion(value: string | undefined, minimum = 1): number {
  if (value === undefined)
    throw new ApplicationError({
      code: 'REQUEST.PRECONDITION_REQUIRED',
      message: 'An If-Match version is required.',
      status: 428,
    });
  const match = /^(?:"(0|[1-9][0-9]*)"|(0|[1-9][0-9]*))$/.exec(value.trim());
  const version = Number(match?.[1] ?? match?.[2] ?? Number.NaN);
  if (!Number.isSafeInteger(version) || version < minimum || version > 2147483646) {
    throw new ApplicationError({
      code: 'REQUEST.IF_MATCH_INVALID',
      message: 'The If-Match version is invalid.',
      status: 400,
    });
  }
  return version;
}

export function productResponse(
  contexts: RequestContextStorage,
  value: JsonValue,
  response: Response,
): unknown {
  response.setHeader('Cache-Control', 'no-store');
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value['version'] === 'number'
  ) {
    response.setHeader('ETag', `"${String(value['version'])}"`);
  }
  return successResponse(contexts, value);
}

export function productCommandResponse(
  contexts: RequestContextStorage,
  result: IdempotentResult<JsonValue>,
  response: Response,
): unknown {
  response.status(result.status);
  response.setHeader('Idempotency-Replayed', String(result.replayed));
  return productResponse(contexts, result.value, response);
}
