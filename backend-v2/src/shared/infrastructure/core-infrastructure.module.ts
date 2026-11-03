import { Global, Module } from '@nestjs/common';

import { AUDIT_WRITER } from '../application/audit/audit-writer.js';
import { DELIVERY_WRITER } from '../application/messaging/delivery-writer.js';
import { UNIT_OF_WORK } from '../application/persistence/unit-of-work.js';
import {
  IDEMPOTENCY_EXECUTOR,
  IDEMPOTENCY_REPOSITORY,
  IdempotencyExecutor,
  type IdempotencyRepository,
} from '../application/idempotency/idempotency.js';
import { CLOCK } from '../domain/clock.js';
import { ID_GENERATOR } from '../domain/id-generator.js';
import { PostgresAuditWriter } from './audit/postgres-audit-writer.js';
import { PostgresDeliveryWriter } from './messaging/postgres-delivery-writer.js';
import { KafkaService } from './dependencies/kafka.service.js';
import { RedisService } from './dependencies/redis.service.js';
import { UuidV7Generator } from './identifiers/uuid-v7-generator.js';
import { LoggingModule } from './logging/logging.module.js';
import { MetricsService } from './observability/metrics.service.js';
import { DatabaseService } from './persistence/database.service.js';
import { PostgresIdempotencyRepository } from './persistence/postgres-idempotency.repository.js';
import { TypeOrmUnitOfWork } from './persistence/typeorm-unit-of-work.js';
import { CircuitBreakerFactory } from './resilience/circuit-breaker.factory.js';
import { SystemClock } from './time/system-clock.js';

@Global()
@Module({
  imports: [LoggingModule],
  providers: [
    SystemClock,
    UuidV7Generator,
    { provide: CLOCK, useExisting: SystemClock },
    { provide: ID_GENERATOR, useExisting: UuidV7Generator },
    DatabaseService,
    TypeOrmUnitOfWork,
    { provide: UNIT_OF_WORK, useExisting: TypeOrmUnitOfWork },
    PostgresIdempotencyRepository,
    { provide: IDEMPOTENCY_REPOSITORY, useExisting: PostgresIdempotencyRepository },
    {
      provide: IDEMPOTENCY_EXECUTOR,
      inject: [IDEMPOTENCY_REPOSITORY, UNIT_OF_WORK, CLOCK, ID_GENERATOR],
      useFactory: (
        repository: IdempotencyRepository,
        unitOfWork: TypeOrmUnitOfWork,
        clock: SystemClock,
        ids: UuidV7Generator,
      ): IdempotencyExecutor => new IdempotencyExecutor(repository, unitOfWork, clock, ids),
    },
    PostgresAuditWriter,
    { provide: AUDIT_WRITER, useExisting: PostgresAuditWriter },
    PostgresDeliveryWriter,
    { provide: DELIVERY_WRITER, useExisting: PostgresDeliveryWriter },
    RedisService,
    KafkaService,
    MetricsService,
    CircuitBreakerFactory,
  ],
  exports: [
    LoggingModule,
    CLOCK,
    ID_GENERATOR,
    DatabaseService,
    UNIT_OF_WORK,
    IDEMPOTENCY_EXECUTOR,
    AUDIT_WRITER,
    DELIVERY_WRITER,
    RedisService,
    KafkaService,
    MetricsService,
    CircuitBreakerFactory,
  ],
})
export class CoreInfrastructureModule {}
