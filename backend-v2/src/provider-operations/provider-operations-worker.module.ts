import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AUDIT_WRITER, type AuditWriter } from '../shared/application/audit/audit-writer.js';
import {
  DELIVERY_WRITER,
  type DeliveryWriter,
} from '../shared/application/messaging/delivery-writer.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../shared/application/persistence/unit-of-work.js';
import { CLOCK, type Clock } from '../shared/domain/clock.js';
import { ID_GENERATOR, type IdGenerator } from '../shared/domain/id-generator.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../shared/infrastructure/config/application-config.js';
import { DurableJobWorkerRuntime } from '../shared/infrastructure/messaging/durable-job-worker.runtime.js';
import { DatabaseService } from '../shared/infrastructure/persistence/database.service.js';
import { DocumentJobProcessor } from './application/document-job.processor.js';
import type { DocumentService } from './application/document.service.js';
import { PostgresReadinessRepository } from './infrastructure/persistence/postgres-readiness.repository.js';
import { ProviderOperationsServicesModule } from './provider-operations.module.js';
import { DOCUMENT_SERVICE } from './provider-operations.tokens.js';

@Module({
  imports: [ProviderOperationsServicesModule],
  providers: [
    PostgresReadinessRepository,
    {
      provide: DocumentJobProcessor,
      inject: [
        DOCUMENT_SERVICE,
        PostgresReadinessRepository,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        DELIVERY_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        documents: DocumentService,
        readiness: PostgresReadinessRepository,
        unit: UnitOfWork,
        audit: AuditWriter,
        delivery: DeliveryWriter,
        clock: Clock,
        ids: IdGenerator,
      ): DocumentJobProcessor =>
        new DocumentJobProcessor(documents, readiness, unit, audit, delivery, clock, ids),
    },
    {
      provide: DurableJobWorkerRuntime,
      inject: [APP_CONFIG, DatabaseService, DocumentJobProcessor, PinoLogger],
      useFactory: (
        config: ApplicationConfig,
        database: DatabaseService,
        processor: DocumentJobProcessor,
        logger: PinoLogger,
      ): DurableJobWorkerRuntime =>
        new DurableJobWorkerRuntime(config, database, processor, logger, [
          {
            name: 'documents',
            concurrency: 4,
            jobTypes: ['document.scan-object.v1', 'document.expire.v1'],
          },
          { name: 'compliance', concurrency: 8, jobTypes: ['compliance.recalculate-readiness.v1'] },
        ]),
    },
  ],
})
export class ProviderOperationsWorkerModule {}
