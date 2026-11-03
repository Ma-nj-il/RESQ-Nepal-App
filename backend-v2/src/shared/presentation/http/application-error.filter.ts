import { ArgumentsHost, Catch, HttpException, Inject, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { ApplicationError } from '../../application/errors/application-error.js';
import { ID_GENERATOR, type IdGenerator } from '../../domain/id-generator.js';
import { RequestContextStorage } from '../../infrastructure/context/request-context.storage.js';
import { requestRouteTemplate } from './request-route.js';

interface PublicError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: ApplicationError['details'];
}

function errorForHttpException(exception: HttpException): PublicError {
  const status = exception.getStatus();
  if (status === 404) {
    return {
      code: 'RESOURCE.NOT_FOUND',
      message: 'The requested resource was not found.',
      retryable: false,
    };
  }
  if (status === 401) {
    return {
      code: 'AUTH.AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.',
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      code: 'ACCESS.PERMISSION_DENIED',
      message: 'This action is not permitted.',
      retryable: false,
    };
  }
  if (status === 429) {
    return { code: 'RATE_LIMIT.EXCEEDED', message: 'Too many requests.', retryable: true };
  }
  return {
    code: status >= 500 ? 'SERVICE.TEMPORARILY_UNAVAILABLE' : 'REQUEST.REJECTED',
    message:
      status >= 500
        ? 'The service is temporarily unavailable.'
        : 'The request could not be processed.',
    retryable: status >= 500,
  };
}

@Catch()
export class ApplicationErrorFilter implements ExceptionFilter {
  constructor(
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ApplicationErrorFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const context = this.contexts.get();
    const requestId = context?.requestId ?? this.ids.generate();

    let status = 500;
    let publicError: PublicError = {
      code: 'SERVICE.INTERNAL_ERROR',
      message: 'The service could not complete the request.',
      retryable: false,
    };

    if (exception instanceof ApplicationError) {
      status = exception.status;
      publicError = {
        code: exception.code,
        message: exception.message,
        retryable: exception.retryable,
        ...(exception.details === undefined ? {} : { details: exception.details }),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      publicError = errorForHttpException(exception);
    }

    const log = {
      errorCode: publicError.code,
      statusCode: status,
      method: request.method,
      route: requestRouteTemplate(request),
      exceptionType: exception instanceof Error ? exception.name : 'UnknownThrownValue',
    };
    if (status >= 500) this.logger.error(log, 'Request failed');
    else this.logger.warn(log, 'Request rejected');

    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({
      error: publicError,
      meta: { requestId },
    });
  }
}
