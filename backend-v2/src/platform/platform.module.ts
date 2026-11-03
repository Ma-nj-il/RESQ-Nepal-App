import { DynamicModule, MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { IdentityAccessModule } from '../identity-access/identity-access.module.js';
import { ProviderOperationsModule } from '../provider-operations/provider-operations.module.js';
import { ConfigurationModule } from '../shared/infrastructure/config/configuration.module.js';
import type { RuntimeRole } from '../shared/infrastructure/config/application-config.js';
import { ContextModule } from '../shared/infrastructure/context/context.module.js';
import { RequestContextMiddleware } from '../shared/infrastructure/context/request-context.middleware.js';
import { CoreInfrastructureModule } from '../shared/infrastructure/core-infrastructure.module.js';
import { HealthService } from '../shared/infrastructure/health/health.service.js';
import { RuntimeProbeServer } from '../shared/infrastructure/health/runtime-probe.server.js';
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
      imports: [
        ConfigurationModule.forRole(role),
        ContextModule,
        CoreInfrastructureModule,
        ...(role === 'api' ? [IdentityAccessModule, ProviderOperationsModule] : []),
      ],
      controllers: role === 'api' ? [HealthController, MetricsController] : [],
      providers: [RequestContextMiddleware, HealthService, RuntimeProbeServer, ...apiProviders],
      exports: [HealthService, RuntimeProbeServer],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
