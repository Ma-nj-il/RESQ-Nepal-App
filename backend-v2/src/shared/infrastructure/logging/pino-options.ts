import { context as otelContext, trace } from '@opentelemetry/api';
import type { Options as PinoHttpOptions } from 'pino-http';

import type { ApplicationConfig } from '../config/application-config.js';
import type { RequestContextStorage } from '../context/request-context.storage.js';

export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.x-api-key',
  'req.headers.x-signature',
  'request.headers.authorization',
  'request.headers.cookie',
  'authorization',
  'cookie',
  'password',
  '*.password',
  '**.password',
  'accessToken',
  'refreshToken',
  'otp',
  'mfaCode',
  'recoveryCode',
  'databaseUrl',
  'redisUrl',
  'presignedUrl',
  'phone',
  'email',
  'citizenshipNumber',
  'licenceNumber',
  'latitude',
  'longitude',
  'objectKey',
  'paymentToken',
] as const;

export function createPinoHttpOptions(
  config: ApplicationConfig,
  requestContexts: RequestContextStorage,
): PinoHttpOptions {
  return {
    level: config.logging.level,
    base: {
      service: 'resq-platform',
      runtimeRole: config.role,
      release: config.release,
      environment: config.environment,
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    messageKey: 'message',
    redact: {
      paths: [...REDACTED_LOG_PATHS],
      censor: '[REDACTED]',
    },
    autoLogging: false,
    serializers: {
      req: (request: { id?: unknown; method?: unknown }) => ({
        id: request.id,
        method: request.method,
      }),
      res: (response: { statusCode?: unknown }) => ({ statusCode: response.statusCode }),
      err: (error: Error) => ({ type: error.name, message: error.message }),
    },
    mixin: () => {
      const requestContext = requestContexts.get();
      const activeSpan = trace.getSpan(otelContext.active())?.spanContext();
      return {
        ...(requestContext === undefined
          ? {}
          : {
              requestId: requestContext.requestId,
              correlationId: requestContext.correlationId,
            }),
        ...(activeSpan === undefined
          ? {}
          : { traceId: activeSpan.traceId, spanId: activeSpan.spanId }),
      };
    },
    ...(config.logging.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, singleLine: true, translateTime: false },
          },
        }
      : {}),
  };
}
