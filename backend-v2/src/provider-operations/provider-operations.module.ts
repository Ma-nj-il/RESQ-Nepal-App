import { Module } from '@nestjs/common';

import { AUDIT_WRITER, type AuditWriter } from '../shared/application/audit/audit-writer.js';
import {
  IDEMPOTENCY_EXECUTOR,
  type IdempotencyExecutor,
} from '../shared/application/idempotency/idempotency.js';
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
import { DocumentService } from './application/document.service.js';
import { ProviderRegistryService } from './application/provider-registry.service.js';
import { WorkforceFleetService } from './application/workforce-fleet.service.js';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from './application/ports/document.repository.js';
import { MALWARE_SCANNER, type MalwareScanner } from './application/ports/malware-scanner.js';
import { OBJECT_STORAGE, type ObjectStorage } from './application/ports/object-storage.js';
import {
  PROVIDER_OPERATIONS_REPOSITORY,
  type ProviderOperationsRepository,
} from './application/ports/provider-operations.repository.js';
import { PostgresDocumentRepository } from './infrastructure/persistence/postgres-document.repository.js';
import { PostgresProviderOperationsRepository } from './infrastructure/persistence/postgres-provider-operations.repository.js';
import {
  UnavailableMalwareScanner,
  UnavailableObjectStorage,
} from './infrastructure/providers/unavailable-document-providers.js';
import { S3DocumentStorage } from './infrastructure/providers/s3-document-storage.js';
import { ClamAvMalwareScanner } from './infrastructure/providers/clamav-malware-scanner.js';
import {
  DOCUMENT_SERVICE,
  PROVIDER_REGISTRY_SERVICE,
  WORKFORCE_FLEET_SERVICE,
} from './provider-operations.tokens.js';
import {
  AuthorityDocumentsController,
  TenantDocumentsController,
  UploadsController,
} from './presentation/http/document.controller.js';
import {
  AuthorityProviderDirectoryController,
  AuthorityProviderApplicationsController,
  ProviderApplicationsController,
  TenantProviderDirectoryController,
} from './presentation/http/provider-registry.controller.js';
import {
  AuthorityWorkforceFleetController,
  DriverApplicationsController,
  TenantWorkforceFleetController,
} from './presentation/http/workforce-fleet.controller.js';

@Module({
  providers: [
    PostgresProviderOperationsRepository,
    {
      provide: PROVIDER_OPERATIONS_REPOSITORY,
      useExisting: PostgresProviderOperationsRepository,
    },
    PostgresDocumentRepository,
    { provide: DOCUMENT_REPOSITORY, useExisting: PostgresDocumentRepository },
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: ApplicationConfig): ObjectStorage =>
        config.documents.storage === undefined
          ? new UnavailableObjectStorage()
          : new S3DocumentStorage(config),
    },
    {
      provide: MALWARE_SCANNER,
      inject: [APP_CONFIG, OBJECT_STORAGE],
      useFactory: (config: ApplicationConfig, storage: ObjectStorage): MalwareScanner =>
        config.documents.clamdSocket !== undefined && storage instanceof S3DocumentStorage
          ? new ClamAvMalwareScanner(
              storage,
              config.documents.clamdSocket,
              config.documents.timeoutMs,
            )
          : new UnavailableMalwareScanner(),
    },
    {
      provide: PROVIDER_REGISTRY_SERVICE,
      inject: [
        PROVIDER_OPERATIONS_REPOSITORY,
        IDEMPOTENCY_EXECUTOR,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        DELIVERY_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: ProviderOperationsRepository,
        idempotency: IdempotencyExecutor,
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        delivery: DeliveryWriter,
        clock: Clock,
        ids: IdGenerator,
      ): ProviderRegistryService =>
        new ProviderRegistryService(
          repository,
          idempotency,
          unitOfWork,
          audit,
          delivery,
          clock,
          ids,
        ),
    },
    {
      provide: WORKFORCE_FLEET_SERVICE,
      inject: [
        PROVIDER_OPERATIONS_REPOSITORY,
        IDEMPOTENCY_EXECUTOR,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        DELIVERY_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: ProviderOperationsRepository,
        idempotency: IdempotencyExecutor,
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        delivery: DeliveryWriter,
        clock: Clock,
        ids: IdGenerator,
      ): WorkforceFleetService =>
        new WorkforceFleetService(repository, idempotency, unitOfWork, audit, delivery, clock, ids),
    },
    {
      provide: DOCUMENT_SERVICE,
      inject: [
        DOCUMENT_REPOSITORY,
        OBJECT_STORAGE,
        MALWARE_SCANNER,
        IDEMPOTENCY_EXECUTOR,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        DELIVERY_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: DocumentRepository,
        storage: ObjectStorage,
        scanner: MalwareScanner,
        idempotency: IdempotencyExecutor,
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        delivery: DeliveryWriter,
        clock: Clock,
        ids: IdGenerator,
      ): DocumentService =>
        new DocumentService(
          repository,
          storage,
          scanner,
          idempotency,
          unitOfWork,
          audit,
          delivery,
          clock,
          ids,
        ),
    },
  ],
  exports: [PROVIDER_REGISTRY_SERVICE, WORKFORCE_FLEET_SERVICE, DOCUMENT_SERVICE],
})
export class ProviderOperationsServicesModule {}

@Module({
  imports: [ProviderOperationsServicesModule],
  controllers: [
    ProviderApplicationsController,
    AuthorityProviderApplicationsController,
    TenantProviderDirectoryController,
    AuthorityProviderDirectoryController,
    DriverApplicationsController,
    TenantWorkforceFleetController,
    AuthorityWorkforceFleetController,
    UploadsController,
    TenantDocumentsController,
    AuthorityDocumentsController,
  ],
  exports: [ProviderOperationsServicesModule],
})
export class ProviderOperationsModule {}
