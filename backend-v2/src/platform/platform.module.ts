import { DynamicModule, MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { UNIT_OF_WORK } from '../shared/application/persistence/unit-of-work.js';
import { CLOCK } from '../shared/domain/clock.js';
import { ID_GENERATOR } from '../shared/domain/id-generator.js';
import { ConfigurationModule } from '../shared/infrastructure/config/configuration.module.js';
import type { RuntimeRole } from '../shared/infrastructure/config/application-config.js';
import { ContextModule } from '../shared/infrastructure/context/context.module.js';
import { RequestContextMiddleware } from '../shared/infrastructure/context/request-context.middleware.js';
import { KafkaService } from '../shared/infrastructure/dependencies/kafka.service.js';
import { RedisService } from '../shared/infrastructure/dependencies/redis.service.js';
import { HealthService } from '../shared/infrastructure/health/health.service.js';
import { RuntimeProbeServer } from '../shared/infrastructure/health/runtime-probe.server.js';
import { UuidV7Generator } from '../shared/infrastructure/identifiers/uuid-v7-generator.js';
import { LoggingModule } from '../shared/infrastructure/logging/logging.module.js';
import { MetricsService } from '../shared/infrastructure/observability/metrics.service.js';
import { DatabaseService } from '../shared/infrastructure/persistence/database.service.js';
import { TypeOrmUnitOfWork } from '../shared/infrastructure/persistence/typeorm-unit-of-work.js';
import { CircuitBreakerFactory } from '../shared/infrastructure/resilience/circuit-breaker.factory.js';
import { SystemClock } from '../shared/infrastructure/time/system-clock.js';
import { ApplicationErrorFilter } from '../shared/presentation/http/application-error.filter.js';
import { HealthController } from '../shared/presentation/http/health.controller.js';
import { MetricsController } from '../shared/presentation/http/metrics.controller.js';
import { RequestTelemetryInterceptor } from '../shared/presentation/http/request-telemetry.interceptor.js';

@Module({})
export class PlatformModule implements NestModule {
  static forRole(role: RuntimeRole): DynamicModule {
    const apiProviders =
      role === 'api'
        ? [
            { provide: APP_FILTER, useClass: ApplicationErrorFilter },
            { provide: APP_INTERCEPTOR, useClass: RequestTelemetryInterceptor },
          ]
        : [];

    return {
      module: PlatformModule,
      imports: [ConfigurationModule.forRole(role), ContextModule, LoggingModule],
      controllers: role === 'api' ? [HealthController, MetricsController] : [],
      providers: [
        RequestContextMiddleware,
        SystemClock,
        UuidV7Generator,
        { provide: CLOCK, useExisting: SystemClock },
        { provide: ID_GENERATOR, useExisting: UuidV7Generator },
        DatabaseService,
        TypeOrmUnitOfWork,
        { provide: UNIT_OF_WORK, useExisting: TypeOrmUnitOfWork },
        RedisService,
        KafkaService,
        MetricsService,
        HealthService,
        RuntimeProbeServer,
        CircuitBreakerFactory,
        ...apiProviders,
      ],
      exports: [HealthService, RuntimeProbeServer],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
