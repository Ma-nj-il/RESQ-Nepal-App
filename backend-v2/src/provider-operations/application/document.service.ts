import type { AuditWriter } from '../../shared/application/audit/audit-writer.js';
import type { RequestContext } from '../../shared/application/context/request-context.js';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type {
  IdempotencyExecutor,
  IdempotentResult,
  JsonValue,
} from '../../shared/application/idempotency/idempotency.js';
import type { DeliveryWriter } from '../../shared/application/messaging/delivery-writer.js';
import type {
  TransactionContext,
  UnitOfWork,
} from '../../shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type {
  DocumentRecord,
  DocumentRepository,
  DocumentReviewRecord,
  DocumentSubject,
} from './ports/document.repository.js';
import type { MalwareScanner } from './ports/malware-scanner.js';
import type { ObjectStorage } from './ports/object-storage.js';

const MAXIMUM_DOCUMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function notFound(): ApplicationError {
  return new ApplicationError({
    code: 'RESOURCE.NOT_FOUND',
    message: 'The requested resource was not found.',
    status: 404,
  });
}

function stale(): ApplicationError {
  return new ApplicationError({
    code: 'REQUEST.STALE_VERSION',
    message: 'The resource changed before this request was applied.',
    status: 409,
  });
}

function documentJson(document: DocumentRecord): JsonValue {
  return {
    id: document.id,
    linkId: document.linkId,
    subject: { ...document.subject },
    documentType: document.documentType,
    sizeBytes: document.sizeBytes,
    declaredMimeType: document.declaredMimeType,
    ...(document.detectedMimeType === undefined
      ? {}
      : { detectedMimeType: document.detectedMimeType }),
    uploadStatus: document.uploadStatus,
    reviewStatus: document.reviewStatus,
    ...(document.expiresOn === undefined ? {} : { expiresOn: document.expiresOn }),
    version: document.version,
  };
}

export class DocumentService {
  constructor(
    private readonly repository: DocumentRepository,
    private readonly storage: ObjectStorage,
    private readonly scanner: MalwareScanner,
    private readonly idempotency: IdempotencyExecutor,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly delivery: DeliveryWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  createUpload(
    context: RequestContext,
    key: string,
    input: {
      readonly subject: DocumentSubject;
      readonly documentType: string;
      readonly sha256: string;
      readonly sizeBytes: number;
      readonly mimeType: string;
      readonly expiresOn?: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const actorId = this.requireUser(context);
    this.validateUpload(input.sha256, input.sizeBytes, input.mimeType);
    this.assertSubjectScope(context, actorId, input.subject);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: 'document.upload.create',
        request: {
          subject: { ...input.subject },
          documentType: input.documentType,
          sha256: input.sha256,
          sizeBytes: input.sizeBytes,
          mimeType: input.mimeType,
          expiresOn: input.expiresOn ?? null,
        },
        successStatus: 201,
      },
      async (transaction) => {
        const now = this.clock.now();
        const grantExpiresAt = new Date(now.getTime() + 10 * 60 * 1_000);
        const documentId = this.ids.generate();
        const objectKey = `restricted/documents/${documentId}`;
        // Grant creation is required to be a local signing operation in storage adapters; it must not
        // upload bytes or perform an unbounded provider request while this transaction is open.
        const grant = await this.storage.createUploadGrant({
          objectKey,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          mimeType: input.mimeType,
          expiresAt: grantExpiresAt,
        });
        const document = await this.repository.createPendingDocument(transaction, {
          id: documentId,
          linkId: this.ids.generate(),
          uploadedByUserId: actorId,
          ...(context.scope.tenantId === undefined
            ? { ownerUserId: actorId }
            : { tenantId: context.scope.tenantId }),
          ...(input.subject.type === 'AMBULANCE' || input.subject.type === 'FACILITY'
            ? { facilityId: this.facilityFromContext(context, input.subject) }
            : {}),
          subject: input.subject,
          documentType: input.documentType,
          objectKey,
          expectedSha256: input.sha256,
          sizeBytes: input.sizeBytes,
          declaredMimeType: input.mimeType,
          uploadStatus: 'PENDING_UPLOAD',
          reviewStatus: 'NOT_SUBMITTED',
          ...(input.expiresOn === undefined ? {} : { expiresOn: input.expiresOn }),
          version: 1,
          now,
        });
        await this.auditChange(transaction, context, document, now, {
          action: 'document.upload.create',
          reasonCode: 'DOCUMENT.UPLOAD_GRANT_CREATED',
        });
        return {
          document: documentJson(document),
          upload: {
            url: grant.url,
            expiresAt: grant.expiresAt.toISOString(),
            requiredHeaders: { ...grant.requiredHeaders },
          },
        };
      },
    );
  }

  async document(context: RequestContext, documentId: string): Promise<DocumentRecord> {
    const record = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findDocument(transaction, documentId),
    );
    if (record === undefined) throw notFound();
    return record;
  }

  list(context: RequestContext): Promise<readonly DocumentRecord[]> {
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listDocuments(transaction),
    );
  }

  async finalizeUpload(
    context: RequestContext,
    key: string,
    documentId: string,
    expectedVersion: number,
  ): Promise<IdempotentResult<JsonValue>> {
    const existing = await this.document(context, documentId);
    const metadata = await this.storage.readMetadata(existing.objectKey);
    if (metadata === undefined) {
      throw new ApplicationError({
        code: 'UPLOAD.OBJECT_NOT_FOUND',
        message: 'The uploaded object could not be verified.',
        status: 422,
      });
    }
    if (
      metadata.objectKey !== existing.objectKey ||
      metadata.sizeBytes !== existing.sizeBytes ||
      metadata.sha256.toLowerCase() !== existing.expectedSha256.toLowerCase() ||
      !ALLOWED_MIME_TYPES.has(metadata.mimeType) ||
      metadata.mimeType !== existing.declaredMimeType
    ) {
      throw new ApplicationError({
        code: 'UPLOAD.METADATA_MISMATCH',
        message: 'The uploaded object does not match the declared document.',
        status: 422,
      });
    }
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `document.upload.finalize:${documentId}`,
        request: { documentId, expectedVersion },
        successStatus: 202,
      },
      async (transaction) => {
        const now = this.clock.now();
        const changed = await this.repository.markUploadedForScan(transaction, {
          documentObjectId: documentId,
          expectedVersion,
          detectedMimeType: metadata.mimeType,
          now,
        });
        if (changed === undefined) throw stale();
        await this.delivery.scheduleJob(transaction, context, {
          id: this.ids.generate(),
          deterministicJobId: `document-${documentId}-scan-v${String(changed.version)}`,
          jobType: 'document.scan-object.v1',
          queueName: 'documents',
          ...(changed.tenantId === undefined ? {} : { tenantId: changed.tenantId }),
          resourceType: 'documentObject',
          resourceId: documentId,
          resourceVersion: changed.version,
          requestedAt: now,
          runAt: now,
          data: {},
        });
        await this.event(transaction, context, changed, now, 'document.object-uploaded.v1');
        return documentJson(changed);
      },
    );
  }

  async scan(
    context: RequestContext,
    documentId: string,
    expectedVersion: number,
  ): Promise<DocumentRecord> {
    const existing = await this.document(context, documentId);
    if (existing.uploadStatus !== 'SCANNING' || existing.version !== expectedVersion)
      return existing;
    const result = await this.scanner.scanImmutableObject({
      objectKey: existing.objectKey,
      expectedSha256: existing.expectedSha256,
      maximumBytes: existing.sizeBytes,
    });
    if (result.outcome === 'FAILED' && result.retryable) {
      throw new ApplicationError({
        code: 'DOCUMENT.SCANNER_UNAVAILABLE',
        message: 'Document scanning is temporarily unavailable.',
        status: 503,
        retryable: true,
      });
    }
    const mimeAllowed =
      result.outcome === 'CLEAN' &&
      ALLOWED_MIME_TYPES.has(result.detectedMimeType) &&
      result.detectedMimeType === existing.declaredMimeType;
    const target =
      result.outcome === 'CLEAN' && mimeAllowed
        ? 'READY'
        : result.outcome === 'INFECTED' || result.outcome === 'CLEAN'
          ? 'QUARANTINED'
          : 'FAILED';
    return this.unitOfWork.execute(context, async (transaction) => {
      const now = this.clock.now();
      const changed = await this.repository.recordScanOutcome(transaction, {
        documentObjectId: documentId,
        expectedVersion,
        outcome: target,
        ...(result.outcome === 'CLEAN' ? { detectedMimeType: result.detectedMimeType } : {}),
        safeScannerCode:
          result.outcome === 'CLEAN' && !mimeAllowed
            ? 'SCANNER.MIME_MISMATCH'
            : /^[A-Za-z0-9._-]{1,128}$/.test(result.scannerCode)
              ? result.scannerCode
              : 'SCANNER.INVALID_CODE',
        now,
      });
      if (changed === undefined) throw stale();
      await this.event(
        transaction,
        context,
        changed,
        now,
        target === 'READY' ? 'document.object-ready.v1' : 'document.object-quarantined.v1',
      );
      await this.auditChange(transaction, context, changed, now, {
        action: 'document.scan',
        reasonCode: `DOCUMENT.${target}`,
      });
      return changed;
    });
  }

  review(
    context: RequestContext,
    key: string,
    documentId: string,
    expectedVersion: number,
    decision: DocumentReviewRecord['decision'],
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    const reviewerUserId = this.requireUser(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `document.review:${documentId}`,
        request: { documentId, expectedVersion, decision, reason },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findDocument(transaction, documentId);
        if (current === undefined) throw notFound();
        if (current.uploadStatus !== 'READY') {
          throw new ApplicationError({
            code: 'DOCUMENT.NOT_READY_FOR_REVIEW',
            message: 'The document has not passed upload and malware checks.',
            status: 422,
          });
        }
        if (current.uploadedByUserId === reviewerUserId) {
          throw new ApplicationError({
            code: 'DOCUMENT.SEGREGATION_OF_DUTIES_REQUIRED',
            message: 'A document owner cannot review their own evidence.',
            status: 403,
          });
        }
        const now = this.clock.now();
        const changed = await this.repository.recordReview(transaction, {
          id: this.ids.generate(),
          documentObjectId: current.id,
          documentLinkId: current.linkId,
          expectedVersion,
          reviewerUserId,
          ...(context.scope.authorityGrantId === undefined
            ? {}
            : { authorityGrantId: context.scope.authorityGrantId }),
          decision,
          reason,
          createdAt: now,
        });
        if (changed === undefined) throw stale();
        await this.event(transaction, context, changed, now, 'document.review-recorded.v1');
        if (changed.tenantId !== undefined) {
          await this.delivery.scheduleJob(transaction, context, {
            id: this.ids.generate(),
            deterministicJobId: `document-${changed.linkId}-readiness-v${String(changed.version)}`,
            jobType: 'compliance.recalculate-readiness.v1',
            queueName: 'compliance',
            tenantId: changed.tenantId,
            resourceType: 'documentObject',
            resourceId: changed.id,
            resourceVersion: changed.version,
            requestedAt: now,
            runAt: now,
            data: { cause: 'DOCUMENT_REVIEW_CHANGED' },
          });
        }
        if (decision === 'APPROVED' && changed.expiresOn !== undefined) {
          const runAt = new Date(`${changed.expiresOn}T00:00:00.000Z`);
          runAt.setUTCDate(runAt.getUTCDate() + 1);
          await this.delivery.scheduleJob(transaction, context, {
            id: this.ids.generate(),
            deterministicJobId: `document-${changed.linkId}-expire-v${String(changed.version)}`,
            jobType: 'document.expire.v1',
            queueName: 'documents',
            ...(changed.tenantId === undefined ? {} : { tenantId: changed.tenantId }),
            resourceType: 'documentObject',
            resourceId: changed.id,
            resourceVersion: changed.version,
            requestedAt: now,
            runAt,
            data: { expiresOn: changed.expiresOn },
          });
        }
        await this.auditChange(transaction, context, changed, now, {
          action: 'document.review',
          reasonCode: `DOCUMENT.${decision}`,
          reason,
        });
        return documentJson(changed);
      },
    );
  }

  async expire(
    context: RequestContext,
    documentId: string,
    expectedVersion: number,
  ): Promise<DocumentRecord> {
    return this.unitOfWork.execute(context, async (transaction) => {
      const now = this.clock.now();
      const current = await this.repository.findDocument(transaction, documentId);
      if (current === undefined) throw notFound();
      if (
        current.version !== expectedVersion ||
        current.reviewStatus !== 'APPROVED' ||
        current.expiresOn === undefined ||
        current.expiresOn >= now.toISOString().slice(0, 10)
      )
        return current;
      const changed = await this.repository.expireIfDue(transaction, {
        documentObjectId: documentId,
        expectedVersion,
        evaluatedOn: now.toISOString().slice(0, 10),
        now,
      });
      if (changed === undefined) throw stale();
      if (changed.reviewStatus !== 'EXPIRED') return changed;
      await this.event(transaction, context, changed, now, 'document.expired.v1');
      if (changed.tenantId !== undefined) {
        await this.delivery.scheduleJob(transaction, context, {
          id: this.ids.generate(),
          deterministicJobId: `document-${changed.linkId}-expiry-readiness-v${String(changed.version)}`,
          jobType: 'compliance.recalculate-readiness.v1',
          queueName: 'compliance',
          tenantId: changed.tenantId,
          resourceType: 'documentObject',
          resourceId: changed.id,
          resourceVersion: changed.version,
          requestedAt: now,
          runAt: now,
          data: { cause: 'DOCUMENT_EXPIRED' },
        });
      }
      await this.auditChange(transaction, context, changed, now, {
        action: 'document.expire',
        reasonCode: 'DOCUMENT.EXPIRED',
      });
      return changed;
    });
  }

  async createDownloadGrant(
    context: RequestContext,
    documentId: string,
  ): Promise<{ readonly url: string; readonly expiresAt: Date }> {
    const document = await this.document(context, documentId);
    if (document.uploadStatus !== 'READY' || document.reviewStatus === 'REVOKED') {
      throw notFound();
    }
    const now = this.clock.now();
    const grant = await this.storage.createDownloadGrant({
      objectKey: document.objectKey,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
    });
    await this.unitOfWork.execute(context, (transaction) =>
      this.auditChange(transaction, context, document, now, {
        action: 'document.content.download-grant',
        reasonCode: 'DOCUMENT.DOWNLOAD_GRANT_CREATED',
      }),
    );
    return grant;
  }

  private validateUpload(sha256: string, sizeBytes: number, mimeType: string): void {
    if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
      throw new ApplicationError({
        code: 'REQUEST.VALIDATION_FAILED',
        message: 'One or more request fields are invalid.',
        status: 400,
        details: [{ field: 'sha256', code: 'INVALID' }],
      });
    }
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAXIMUM_DOCUMENT_BYTES) {
      throw new ApplicationError({
        code: 'UPLOAD.SIZE_EXCEEDED',
        message: 'The document size is not allowed.',
        status: 413,
      });
    }
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new ApplicationError({
        code: 'UPLOAD.TYPE_NOT_ALLOWED',
        message: 'The document type is not allowed.',
        status: 415,
      });
    }
  }

  private assertSubjectScope(
    context: RequestContext,
    actorId: string,
    subject: DocumentSubject,
  ): void {
    if (subject.type === 'USER_IDENTITY' && subject.userId !== actorId) throw notFound();
    if (
      ['DRIVER', 'AMBULANCE', 'FACILITY'].includes(subject.type) &&
      context.scope.tenantId === undefined
    ) {
      throw new ApplicationError({
        code: 'ACCESS.PERMISSION_DENIED',
        message: 'This action is not permitted.',
        status: 403,
      });
    }
  }

  private facilityFromContext(
    context: RequestContext,
    subject: Extract<DocumentSubject, { type: 'AMBULANCE' | 'FACILITY' }>,
  ): string {
    if (subject.type === 'FACILITY') return subject.facilityId;
    const [facilityId] = context.scope.facilityIds;
    if (facilityId === undefined) {
      throw new ApplicationError({
        code: 'REQUEST.FACILITY_CONTEXT_REQUIRED',
        message: 'A facility context is required for this document.',
        status: 400,
      });
    }
    return facilityId;
  }

  private async event(
    transaction: TransactionContext,
    context: RequestContext,
    document: DocumentRecord,
    now: Date,
    eventType: string,
  ): Promise<void> {
    await this.delivery.appendEvent(transaction, context, {
      eventId: this.ids.generate(),
      eventType,
      producer: 'documents',
      aggregateType: 'documentObject',
      aggregateId: document.id,
      aggregateVersion: document.version,
      streamType: 'document',
      streamId: document.linkId,
      ...(document.tenantId === undefined ? {} : { tenantId: document.tenantId }),
      ...(document.facilityId === undefined ? {} : { facilityId: document.facilityId }),
      occurredAt: now,
      data: {
        linkId: document.linkId,
        uploadStatus: document.uploadStatus,
        reviewStatus: document.reviewStatus,
      },
    });
  }

  private async auditChange(
    transaction: TransactionContext,
    context: RequestContext,
    document: DocumentRecord,
    now: Date,
    evidence: { readonly action: string; readonly reasonCode: string; readonly reason?: string },
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: this.ids.generate(),
      occurredAt: now,
      ...(document.tenantId === undefined ? {} : { tenantId: document.tenantId }),
      actorType: context.actor?.type ?? 'SYSTEM_POLICY',
      ...(context.actor === undefined ? {} : { actorId: context.actor.id }),
      ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      ...(context.scope.authorityGrantId === undefined
        ? {}
        : { authorityGrantId: context.scope.authorityGrantId }),
      ...(context.authentication === undefined
        ? {}
        : { authenticationAssurance: context.authentication.assurance }),
      action: evidence.action,
      resourceType: 'document',
      resourceId: document.linkId,
      outcome: 'ALLOWED',
      reasonCode: evidence.reasonCode,
      correlationId: context.correlationId,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      source: context.source,
      safeContext: {
        documentType: document.documentType,
        ...(evidence.reason === undefined ? {} : { reason: evidence.reason }),
      },
      retentionClass: 'RESTRICTED_DOCUMENT_ACCESS',
    });
  }

  private requireUser(context: RequestContext): string {
    if (context.actor?.type !== 'USER') {
      throw new ApplicationError({
        code: 'AUTH.AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        status: 401,
      });
    }
    return context.actor.id;
  }
}
