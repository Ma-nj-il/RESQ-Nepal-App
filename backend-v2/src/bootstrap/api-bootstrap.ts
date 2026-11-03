import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { PlatformModule } from '../platform/platform.module.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../shared/infrastructure/config/application-config.js';
import { createValidationPipe } from '../shared/presentation/http/validation.js';

export async function bootstrapApi(): Promise<void> {
  const app = await NestFactory.create(PlatformModule.forRole('api'), {
    bufferLogs: true,
    abortOnError: true,
  });
  const config = app.get<ApplicationConfig>(APP_CONFIG);
  app.useLogger(app.get(Logger));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({
    origin: [...config.http.corsOrigins],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'If-Match',
      'X-Authority-Grant-Id',
      'X-Facility-Id',
      'X-Request-Id',
      'X-Tenant-Id',
    ],
    exposedHeaders: ['ETag', 'Retry-After', 'X-Request-Id'],
    maxAge: 600,
  });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  await app.listen(config.http.port, config.http.host);
}
