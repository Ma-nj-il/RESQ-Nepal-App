import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { Observable, catchError, tap, throwError } from 'rxjs';

import { ApplicationError } from '../../application/errors/application-error.js';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
import { requestRouteTemplate } from './request-route.js';

@Injectable()
export class RequestTelemetryInterceptor implements NestInterceptor {
  constructor(
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RequestTelemetryInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const started = process.hrtime.bigint();
    const route = requestRouteTemplate(request);
    const method = request.method;

    const record = (statusCode: number, errorCode?: string): void => {
      const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      const labels = { method, route, status_code: String(statusCode) };
      this.metrics.httpRequests.inc(labels);
      this.metrics.httpDuration.observe(labels, elapsedSeconds);
      this.logger.info(
        {
          method,
          route,
          statusCode,
          durationMs: Math.round(elapsedSeconds * 1_000),
          ...(errorCode === undefined ? {} : { errorCode }),
        },
        'Request completed',
      );
    };

    return next.handle().pipe(
      tap(() => record(response.statusCode)),
      catchError((error: unknown) => {
        const statusCode =
          error instanceof ApplicationError
            ? error.status
            : error instanceof HttpException
              ? error.getStatus()
              : 500;
        record(statusCode, error instanceof ApplicationError ? error.code : undefined);
        return throwError(() => error);
      }),
    );
  }
}
