import { ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

import { ApplicationError, type ErrorDetail } from '../../application/errors/application-error.js';

function validationDetails(errors: readonly ValidationError[], parent = ''): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  for (const error of errors) {
    const field = parent.length === 0 ? error.property : `${parent}.${error.property}`;
    for (const code of Object.keys(error.constraints ?? {})) {
      details.push({ field, code: code.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase() });
    }
    details.push(...validationDetails(error.children ?? [], field));
  }
  return details;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: false,
    stopAtFirstError: false,
    validationError: { target: false, value: false },
    exceptionFactory: (errors: ValidationError[]) =>
      new ApplicationError({
        code: 'REQUEST.VALIDATION_FAILED',
        message: 'One or more request fields are invalid.',
        status: 400,
        details: validationDetails(errors),
      }),
  });
}
