import { jest } from '@jest/globals';

import { DocumentService } from '../../src/provider-operations/application/document.service.js';
import type { DocumentRepository } from '../../src/provider-operations/application/ports/document.repository.js';
import type { MalwareScanner } from '../../src/provider-operations/application/ports/malware-scanner.js';
import type { ObjectStorage } from '../../src/provider-operations/application/ports/object-storage.js';
import type {
  AmbulanceRecord,
  DriverRecord,
  ProviderApplicationRecord,
  ProviderOperationsRepository,
} from '../../src/provider-operations/application/ports/provider-operations.repository.js';
import { ProviderRegistryService } from '../../src/provider-operations/application/provider-registry.service.js';
import { WorkforceFleetService } from '../../src/provider-operations/application/workforce-fleet.service.js';
import {
  UnavailableMalwareScanner,
  UnavailableObjectStorage,
} from '../../src/provider-operations/infrastructure/providers/unavailable-document-providers.js';
import type { AuditWriter } from '../../src/shared/application/audit/audit-writer.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import {
  IdempotencyExecutor,
  type IdempotencyRepository,
} from '../../src/shared/application/idempotency/idempotency.js';
import type { DeliveryWriter } from '../../src/shared/application/messaging/delivery-writer.js';
import type {
  TransactionContext,
  UnitOfWork,
} from '../../src/shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../src/shared/domain/clock.js';
import type { IdGenerator } from '../../src/shared/domain/id-generator.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const ACTOR_ID = '018f0000-0000-7000-8000-000000000001';
const OTHER_USER_ID = '018f0000-0000-7000-8000-000000000002';
const TENANT_ID = '018f0000-0000-7000-8000-000000000003';
const FACILITY_ID = '018f0000-0000-7000-8000-000000000004';
const GRANT_ID = '018f0000-0000-7000-8000-000000000005';
const RESOURCE_ID = '018f0000-0000-7000-8000-000000000006';
const TRANSACTION: TransactionContext = { transactionId: 'test-transaction' };

function context(kind: 'TENANT' | 'PROVINCE' | 'PLATFORM'): RequestContext {
  return new RequestContext({
    requestId: 'request-id',
    correlationId: 'correlation-id',
    source: 'HTTP',
    actor: { type: 'USER', id: ACTOR_ID },
    sessionId: '018f0000-0000-7000-8000-000000000007',
    authentication: {
      assurance: 'AAL2',
      assuranceExpiresAt: new Date(NOW.getTime() + 300_000),
      tokenVersion: 1,
      permissionCodes: ['provider.review', 'document.review', 'driver.manage'],
    },
    scope:
      kind === 'TENANT'
        ? {
            tenantId: TENANT_ID,
            facilityIds: [FACILITY_ID],
            accessScopeType: 'FACILITY_SET',
          }
        : {
            authorityGrantId: GRANT_ID,
            authority: {
              level: kind,
              resourceClasses: ['provider', 'ambulance', 'document'],
              geographicUnitIds: ['province-1'],
              allowsPii: false,
              allowsDocumentContent: true,
              allowsExport: false,
              allowsIntervention: false,
              expiresAt: new Date(NOW.getTime() + 3_600_000),
            },
          },
  });
}

function dependencies(): {
  unitOfWork: UnitOfWork;
  idempotency: IdempotencyExecutor;
  audit: jest.Mocked<AuditWriter>;
  delivery: jest.Mocked<DeliveryWriter>;
  clock: Clock;
  ids: IdGenerator;
} {
  const unitOfWork: UnitOfWork = { execute: (_requestContext, work) => work(TRANSACTION) };
  const idempotencyRepository: IdempotencyRepository = {
    begin: () => Promise.resolve({ kind: 'STARTED' }),
    complete: () => Promise.resolve(),
  };
  const clock: Clock = { now: () => new Date(NOW) };
  let sequence = 20;
  const ids: IdGenerator = {
    generate: () => `018f0000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`,
  };
  return {
    unitOfWork,
    idempotency: new IdempotencyExecutor(idempotencyRepository, unitOfWork, clock, ids),
    audit: { append: jest.fn<AuditWriter['append']>() },
    delivery: {
      appendEvent: jest.fn<DeliveryWriter['appendEvent']>(() => Promise.resolve(1)),
      scheduleJob: jest.fn<DeliveryWriter['scheduleJob']>(),
    },
    clock,
    ids,
  };
}

function providerApplication(): ProviderApplicationRecord {
  return {
    id: RESOURCE_ID,
    applicantUserId: ACTOR_ID,
    legalName: 'Applicant Legal Name',
    displayName: 'Applicant',
    registrationNumber: 'REG-001',
    geographicUnitId: '018f0000-0000-7000-8000-000000000008',
    facilityName: 'Applicant Base',
    facilityType: 'AMBULANCE_BASE',
    status: 'SUBMITTED',
    version: 2,
    submittedAt: NOW,
  };
}

function driver(): DriverRecord {
  return {
    id: RESOURCE_ID,
    tenantId: TENANT_ID,
    userId: OTHER_USER_ID,
    licenceNumber: 'LIC-001',
    licenceExpiresOn: '2027-11-03',
    verificationStatus: 'VERIFIED',
    accountStatus: 'ACTIVE',
    dutyStatus: 'OFF_DUTY',
    facilityIds: [FACILITY_ID],
    eligibilityReasons: ['NOT_AVAILABLE_FOR_DUTY', 'DOCUMENTS_NOT_CURRENT'],
    version: 3,
  };
}

function ambulance(): AmbulanceRecord {
  return {
    id: RESOURCE_ID,
    tenantId: TENANT_ID,
    facilityId: FACILITY_ID,
    plateNumber: 'BA1CHA1000',
    category: 'BASIC',
    complianceStatus: 'APPROVED',
    operationalStatus: 'OFFLINE',
    gpsQuality: 'UNAVAILABLE',
    readinessStatus: 'BLOCKED',
    readinessReasons: ['NOT_OPERATIONALLY_AVAILABLE'],
    readinessVersion: 2,
    version: 4,
  };
}

describe('provider operations security invariants', () => {
  it('rejects provider self-review before a state change is attempted', async () => {
    const repository = {
      findProviderApplication: jest.fn(() => Promise.resolve(providerApplication())),
      transitionProviderApplication: jest.fn(),
    } as unknown as jest.Mocked<ProviderOperationsRepository>;
    const support = dependencies();
    const service = new ProviderRegistryService(
      repository,
      support.idempotency,
      support.unitOfWork,
      support.audit,
      support.delivery,
      support.clock,
      support.ids,
    );

    await expect(
      service.requestInformation(
        context('PROVINCE'),
        'provider-review-key',
        RESOURCE_ID,
        2,
        'Additional evidence is required',
      ),
    ).rejects.toMatchObject({
      code: 'PROVIDER_APPLICATION.SEGREGATION_OF_DUTIES_REQUIRED',
      status: 403,
    });
    expect(repository.transitionProviderApplication.mock.calls).toHaveLength(0);
  });

  it('reserves final provider approval for platform authority', async () => {
    const repository = {} as ProviderOperationsRepository;
    const support = dependencies();
    const service = new ProviderRegistryService(
      repository,
      support.idempotency,
      support.unitOfWork,
      support.audit,
      support.delivery,
      support.clock,
      support.ids,
    );

    await expect(
      Promise.resolve().then(() =>
        service.approve(
          context('PROVINCE'),
          'provider-approval-key',
          RESOURCE_ID,
          2,
          'Province cannot provide final approval',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ACCESS.PERMISSION_DENIED', status: 403 });
  });

  it('does not make a driver available while required evidence is stale', async () => {
    const repository = {
      findDriver: jest.fn(() => Promise.resolve(driver())),
      changeDriverDutyStatus: jest.fn(),
    } as unknown as jest.Mocked<ProviderOperationsRepository>;
    const support = dependencies();
    const service = new WorkforceFleetService(
      repository,
      support.idempotency,
      support.unitOfWork,
      support.audit,
      support.delivery,
      support.clock,
      support.ids,
    );

    await expect(
      service.changeDriverDutyStatus(
        context('TENANT'),
        'driver-duty-key-01',
        RESOURCE_ID,
        3,
        'AVAILABLE',
        'Starting shift',
      ),
    ).rejects.toMatchObject({ code: 'DRIVER.NOT_ELIGIBLE', status: 422 });
    expect(repository.changeDriverDutyStatus.mock.calls).toHaveLength(0);
  });

  it('binds authority compliance audit evidence to the active grant', async () => {
    const repository = {
      reviewAmbulanceCompliance: jest.fn(() => Promise.resolve(ambulance())),
    } as unknown as jest.Mocked<ProviderOperationsRepository>;
    const support = dependencies();
    const service = new WorkforceFleetService(
      repository,
      support.idempotency,
      support.unitOfWork,
      support.audit,
      support.delivery,
      support.clock,
      support.ids,
    );

    await service.reviewAmbulanceCompliance(
      context('PROVINCE'),
      'ambulance-review-key',
      RESOURCE_ID,
      3,
      'APPROVED',
      'Evidence independently reviewed',
    );

    expect(support.audit.append.mock.calls[0]).toEqual([
      TRANSACTION,
      expect.objectContaining({
        tenantId: TENANT_ID,
        authorityGrantId: GRANT_ID,
        action: 'fleet.ambulance-compliance.review',
      }),
    ]);
  });
});

describe('private document security invariants', () => {
  it('keeps storage and malware scanning fail-closed when providers are unconfigured', async () => {
    await expect(new UnavailableObjectStorage().createUploadGrant()).rejects.toMatchObject({
      code: 'DOCUMENT.STORAGE_UNAVAILABLE',
      status: 503,
      retryable: true,
    });
    await expect(new UnavailableMalwareScanner().scanImmutableObject()).rejects.toMatchObject({
      code: 'DOCUMENT.SCANNER_UNAVAILABLE',
      status: 503,
      retryable: true,
    });
  });

  it('rejects object metadata that differs from the immutable upload declaration', async () => {
    const documentRepository = {
      findDocument: jest.fn(() =>
        Promise.resolve({
          id: RESOURCE_ID,
          linkId: '018f0000-0000-7000-8000-000000000010',
          uploadedByUserId: ACTOR_ID,
          ownerUserId: ACTOR_ID,
          subject: { type: 'USER_IDENTITY' as const, userId: ACTOR_ID },
          documentType: 'CITIZENSHIP',
          objectKey: `restricted/documents/${RESOURCE_ID}`,
          expectedSha256: 'a'.repeat(64),
          sizeBytes: 100,
          declaredMimeType: 'application/pdf',
          uploadStatus: 'PENDING_UPLOAD' as const,
          reviewStatus: 'NOT_SUBMITTED' as const,
          version: 1,
        }),
      ),
      markUploadedForScan: jest.fn(),
    } as unknown as jest.Mocked<DocumentRepository>;
    const storage = {
      readMetadata: jest.fn(() =>
        Promise.resolve({
          objectKey: `restricted/documents/${RESOURCE_ID}`,
          sha256: 'b'.repeat(64),
          sizeBytes: 100,
          mimeType: 'application/pdf',
        }),
      ),
    } as unknown as ObjectStorage;
    const support = dependencies();
    const service = new DocumentService(
      documentRepository,
      storage,
      {} as MalwareScanner,
      support.idempotency,
      support.unitOfWork,
      support.audit,
      support.delivery,
      support.clock,
      support.ids,
    );

    await expect(
      service.finalizeUpload(context('TENANT'), 'document-finalize-key', RESOURCE_ID, 1),
    ).rejects.toMatchObject({ code: 'UPLOAD.METADATA_MISMATCH', status: 422 });
    expect(documentRepository.markUploadedForScan.mock.calls).toHaveLength(0);
  });

  it('prevents the uploader from reviewing their own clean document', async () => {
    const documentRepository = {
      findDocument: jest.fn(() =>
        Promise.resolve({
          id: RESOURCE_ID,
          linkId: '018f0000-0000-7000-8000-000000000010',
          uploadedByUserId: ACTOR_ID,
          tenantId: TENANT_ID,
          subject: { type: 'DRIVER' as const, driverId: OTHER_USER_ID },
          documentType: 'DRIVER_LICENCE',
          objectKey: `restricted/documents/${RESOURCE_ID}`,
          expectedSha256: 'a'.repeat(64),
          sizeBytes: 100,
          declaredMimeType: 'application/pdf',
          detectedMimeType: 'application/pdf',
          uploadStatus: 'READY' as const,
          reviewStatus: 'PENDING' as const,
          version: 3,
        }),
      ),
      recordReview: jest.fn(),
    } as unknown as jest.Mocked<DocumentRepository>;
    const support = dependencies();
    const service = new DocumentService(
      documentRepository,
      {} as ObjectStorage,
      {} as MalwareScanner,
      support.idempotency,
      support.unitOfWork,
      support.audit,
      support.delivery,
      support.clock,
      support.ids,
    );

    await expect(
      service.review(
        context('TENANT'),
        'document-review-key',
        RESOURCE_ID,
        3,
        'APPROVED',
        'Self approval attempt',
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT.SEGREGATION_OF_DUTIES_REQUIRED', status: 403 });
    expect(documentRepository.recordReview.mock.calls).toHaveLength(0);
  });
});
