import { randomUUID } from 'node:crypto';

import { jest } from '@jest/globals';

import { DocumentJobProcessor } from '../../src/provider-operations/application/document-job.processor.js';
import { DocumentService } from '../../src/provider-operations/application/document.service.js';
import type {
  DocumentRecord,
  DocumentRepository,
} from '../../src/provider-operations/application/ports/document.repository.js';
import type {
  MalwareScanner,
  MalwareScanResult,
} from '../../src/provider-operations/application/ports/malware-scanner.js';
import type { ObjectStorage } from '../../src/provider-operations/application/ports/object-storage.js';
import type { ReadinessRepository } from '../../src/provider-operations/application/ports/readiness.repository.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import type { IdempotencyExecutor } from '../../src/shared/application/idempotency/idempotency.js';
import type { JobIntentEnvelope } from '../../src/shared/application/messaging/job-intent.js';
import type {
  TransactionContext,
  UnitOfWork,
} from '../../src/shared/application/persistence/unit-of-work.js';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Preserve inferred Jest mock types.
function fixture() {
  let record: DocumentRecord = {
    id: randomUUID(),
    linkId: randomUUID(),
    uploadedByUserId: randomUUID(),
    subject: { type: 'USER_IDENTITY', userId: randomUUID() },
    documentType: 'IDENTITY',
    objectKey: 'restricted/documents/test',
    expectedSha256: 'a'.repeat(64),
    sizeBytes: 100,
    declaredMimeType: 'application/pdf',
    uploadStatus: 'SCANNING',
    reviewStatus: 'NOT_SUBMITTED',
    version: 2,
  };
  const context = new RequestContext({
    requestId: randomUUID(),
    correlationId: 'document-jobs',
    source: 'JOB',
  });
  const job: JobIntentEnvelope = {
    jobIntentId: randomUUID(),
    executionId: randomUUID(),
    jobType: 'document.scan-object.v1',
    resourceType: 'documentObject',
    resourceId: record.id,
    resourceVersion: 2,
    runAt: '2026-11-03T00:00:00.000Z',
    correlationId: 'document-jobs',
    causationId: randomUUID(),
    data: {},
  };
  const unit: UnitOfWork = {
    execute: async <T>(_context: RequestContext, work: (tx: TransactionContext) => Promise<T>) =>
      work({ transactionId: 'transaction' }),
  };
  const repository = {
    findDocument: jest.fn(() => Promise.resolve(record)),
    recordScanOutcome: jest.fn<DocumentRepository['recordScanOutcome']>((_tx, input) => {
      record = { ...record, uploadStatus: input.outcome, version: record.version + 1 };
      return Promise.resolve(record);
    }),
    expireIfDue: jest.fn<DocumentRepository['expireIfDue']>(() => {
      record = { ...record, reviewStatus: 'EXPIRED', version: record.version + 1 };
      return Promise.resolve(record);
    }),
  };
  const scanner = {
    scanImmutableObject: jest.fn<MalwareScanner['scanImmutableObject']>(() =>
      Promise.resolve({
        outcome: 'CLEAN',
        detectedMimeType: 'application/pdf',
        scannerCode: 'CLEAN',
      }),
    ),
  };
  const audit = { append: jest.fn(() => Promise.resolve()) };
  const delivery = {
    appendEvent: jest.fn(() => Promise.resolve(1)),
    scheduleJob: jest.fn(() => Promise.resolve()),
  };
  const clock = { now: () => new Date('2026-11-03T12:00:00.000Z') },
    ids = { generate: randomUUID };
  const service = new DocumentService(
    repository as unknown as DocumentRepository,
    {} as ObjectStorage,
    scanner,
    {} as IdempotencyExecutor,
    unit,
    audit,
    delivery,
    clock,
    ids,
  );
  const processor = new DocumentJobProcessor(
    service,
    {} as ReadinessRepository,
    unit,
    audit,
    delivery,
    clock,
    ids,
  );
  return {
    service,
    processor,
    job,
    context,
    repository,
    scanner,
    audit,
    delivery,
    setRecord: (input: Partial<DocumentRecord>) => {
      record = { ...record, ...input };
    },
  };
}

describe('document job race and scan boundaries', () => {
  it('skips stale scans before making a provider request', async () => {
    const f = fixture();
    f.setRecord({ version: 3 });
    await f.processor.process(f.job);
    expect(f.scanner.scanImmutableObject).not.toHaveBeenCalled();
    expect(f.delivery.appendEvent).not.toHaveBeenCalled();
  });

  it.each([
    { outcome: 'CLEAN', detectedMimeType: 'text/html', scannerCode: 'CLEAN' },
    { outcome: 'CLEAN', detectedMimeType: 'image/png', scannerCode: 'CLEAN' },
    { outcome: 'INFECTED', scannerCode: 'provider-secret\nnot-a-safe-code' },
  ] satisfies MalwareScanResult[])(
    'quarantines mismatched MIME or infected results (%j)',
    async (result) => {
      const f = fixture();
      f.scanner.scanImmutableObject.mockResolvedValue(result);
      await expect(f.processor.process(f.job)).resolves.toEqual({ code: 'DOCUMENT_QUARANTINED' });
      expect(f.repository.recordScanOutcome.mock.calls[0]?.[1]).toMatchObject({
        outcome: 'QUARANTINED',
      });
      expect(JSON.stringify(f.audit.append.mock.calls)).not.toContain('provider-secret');
      expect(JSON.stringify(f.delivery.appendEvent.mock.calls)).not.toContain('provider-secret');
      expect(JSON.stringify(f.repository.recordScanOutcome.mock.calls)).not.toContain(
        'provider-secret',
      );
    },
  );

  it('retries provider outages without recording a failed document', async () => {
    const f = fixture();
    f.scanner.scanImmutableObject.mockResolvedValue({
      outcome: 'FAILED',
      retryable: true,
      scannerCode: 'TIMEOUT',
    });
    await expect(f.processor.process(f.job)).rejects.toMatchObject({
      code: 'DOCUMENT.SCANNER_UNAVAILABLE',
      retryable: true,
    });
    expect(f.repository.recordScanOutcome).not.toHaveBeenCalled();
  });

  it('treats a scan lost to a concurrent version change as a no-op with no event', async () => {
    const f = fixture();
    f.repository.recordScanOutcome.mockResolvedValue(undefined);
    await expect(f.processor.process(f.job)).resolves.toEqual({ code: 'NO_OP_CURRENT_STATE' });
    expect(f.delivery.appendEvent).not.toHaveBeenCalled();
  });

  it('emits expiry and audit evidence once across repeat execution', async () => {
    const f = fixture();
    f.setRecord({ uploadStatus: 'READY', reviewStatus: 'APPROVED', expiresOn: '2026-11-02' });
    const job = { ...f.job, jobType: 'document.expire.v1' };
    await f.processor.process(job);
    await f.processor.process(job);
    expect(f.repository.expireIfDue).toHaveBeenCalledTimes(1);
    expect(f.delivery.appendEvent).toHaveBeenCalledTimes(1);
    expect(f.audit.append).toHaveBeenCalledTimes(1);
  });

  it('rejects a job without a database execution claim', async () => {
    const f = fixture();
    const job = { ...f.job };
    delete job.executionId;
    await expect(f.processor.process(job)).resolves.toEqual({ code: 'INVALID_JOB_ENVELOPE' });
    expect(f.repository.findDocument).not.toHaveBeenCalled();
  });
});
