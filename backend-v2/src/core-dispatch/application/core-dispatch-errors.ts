import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type { DispatchCommandResult } from './ports/core-dispatch.repository.js';

export function resourceNotFound(): ApplicationError {
  return new ApplicationError({
    code: 'RESOURCE.NOT_FOUND',
    message: 'The requested resource was not found.',
    status: 404,
  });
}

export function authenticationRequired(): ApplicationError {
  return new ApplicationError({
    code: 'AUTH.AUTHENTICATION_REQUIRED',
    message: 'Authentication is required.',
    status: 401,
  });
}

export function permissionDenied(): ApplicationError {
  return new ApplicationError({
    code: 'ACCESS.PERMISSION_DENIED',
    message: 'This action is not permitted.',
    status: 403,
  });
}

export function dispatchResultError(result: DispatchCommandResult): ApplicationError {
  switch (result) {
    case 'NOT_FOUND':
    case 'NOT_AUTHORIZED':
      return resourceNotFound();
    case 'STALE_VERSION':
      return new ApplicationError({
        code: 'REQUEST.STALE_VERSION',
        message: 'The resource changed before this request was applied.',
        status: 409,
      });
    case 'CONFLICT':
    case 'RESOURCE_CONFLICT':
      return new ApplicationError({
        code: 'DISPATCH.RESOURCE_CONFLICT',
        message: 'The selected dispatch resources are no longer available.',
        status: 409,
      });
    case 'OFFER_RESOLVED':
      return new ApplicationError({
        code: 'DISPATCH.OFFER_ALREADY_RESOLVED',
        message: 'The dispatch offer has already been resolved.',
        status: 409,
      });
    case 'OFFER_EXPIRED':
      return new ApplicationError({
        code: 'DISPATCH.OFFER_EXPIRED',
        message: 'The dispatch offer has expired.',
        status: 409,
      });
    case 'INVALID_COVERAGE':
      return new ApplicationError({
        code: 'DISPATCH.COVERAGE_CHANGED',
        message: 'Service coverage changed before the booking could be dispatched.',
        status: 409,
        retryable: true,
      });
    case 'PROVIDER_NOT_ELIGIBLE':
      return eligibilityError('PROVIDER.NOT_ELIGIBLE', 'The provider is not dispatch eligible.');
    case 'DRIVER_NOT_ELIGIBLE':
      return eligibilityError('DRIVER.NOT_ELIGIBLE', 'The driver is not dispatch eligible.');
    case 'AMBULANCE_NOT_ELIGIBLE':
      return eligibilityError('AMBULANCE.NOT_ELIGIBLE', 'The ambulance is not dispatch eligible.');
    case 'OVERRIDE_REQUIRED':
      return new ApplicationError({
        code: 'TRIP.AUTHORITY_OVERRIDE_REQUIRED',
        message: 'This lifecycle point requires an authorized intervention.',
        status: 403,
      });
    case 'COMPLETION_EVIDENCE_REQUIRED':
      return new ApplicationError({
        code: 'TRIP.COMPLETION_EVIDENCE_REQUIRED',
        message: 'Trip completion requires final distance and fare evidence.',
        status: 422,
      });
    case 'INVALID_TRANSITION':
      return new ApplicationError({
        code: 'TRIP.INVALID_TRANSITION',
        message: 'The resource cannot perform this action in its current state.',
        status: 422,
      });
    case 'ACCEPTED':
    case 'SEARCHING':
    case 'CANCELLED':
    case 'DECLINED':
    case 'WITHDRAWN':
      return new ApplicationError({
        code: 'INTERNAL.UNEXPECTED_COMMAND_RESULT',
        message: 'The command returned an unexpected result.',
        status: 500,
      });
  }
}

function eligibilityError(code: string, message: string): ApplicationError {
  return new ApplicationError({ code, message, status: 422 });
}
