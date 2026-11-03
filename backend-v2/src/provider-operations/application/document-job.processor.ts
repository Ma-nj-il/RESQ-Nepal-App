import type { AuditWriter } from '../../shared/application/audit/audit-writer.js';
import { RequestContext } from '../../shared/application/context/request-context.js';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type { JobIntentEnvelope } from '../../shared/application/messaging/job-intent.js';
import type { DeliveryWriter } from '../../shared/application/messaging/delivery-writer.js';
import type { UnitOfWork } from '../../shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { DocumentService } from './document.service.js';
import type { ReadinessRepository } from './ports/readiness.repository.js';

export class DocumentJobProcessor {
  constructor(
    private readonly documents: DocumentService,
    private readonly readiness: ReadinessRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly delivery: DeliveryWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async process(job: JobIntentEnvelope): Promise<{ readonly code: string }> {
    if (
      job.executionId === undefined ||
      !Number.isSafeInteger(job.resourceVersion) ||
      (job.resourceVersion ?? 0) < 1 ||
      (job.resourceType !== 'documentObject' &&
        !(
          job.jobType === 'compliance.recalculate-readiness.v1' && job.resourceType === 'ambulance'
        ))
    ) {
      return { code: 'INVALID_JOB_ENVELOPE' };
    }
    const context = new RequestContext({
      requestId: this.ids.generate(),
      correlationId: job.correlationId,
      causationId: job.jobIntentId,
      jobExecutionId: job.executionId,
      source: 'JOB',
    });
    const version = job.resourceVersion as number;
    try {
      switch (job.jobType) {
        case 'document.scan-object.v1': {
          const record = await this.documents.scan(context, job.resourceId, version);
          return {
            code:
              record.version === version + 1
                ? `DOCUMENT_${record.uploadStatus}`
                : 'NO_OP_CURRENT_STATE',
          };
        }
        case 'document.expire.v1': {
          const record = await this.documents.expire(context, job.resourceId, version);
          return {
            code: record.reviewStatus === 'EXPIRED' ? 'DOCUMENT_EXPIRED' : 'NO_OP_CURRENT_STATE',
          };
        }
        case 'compliance.recalculate-readiness.v1':
          return await this.recalculate(context, job.resourceId, version);
        default:
          return { code: 'UNSUPPORTED_JOB_TYPE' };
      }
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        ['RESOURCE.NOT_FOUND', 'REQUEST.STALE_VERSION'].includes(error.code)
      ) {
        return { code: 'NO_OP_CURRENT_STATE' };
      }
      throw error;
    }
  }

  private recalculate(
    context: RequestContext,
    resourceId: string,
    version: number,
  ): Promise<{ readonly code: string }> {
    return this.unitOfWork.execute(context, async (transaction) => {
      const changes = await this.readiness.recalculate(transaction, resourceId, version);
      const now = this.clock.now();
      for (const change of changes) {
        await this.delivery.appendEvent(transaction, context, {
          eventId: this.ids.generate(),
          eventType: 'fleet.ambulance-readiness.changed.v1',
          producer: 'provider-operations-worker',
          aggregateType: 'ambulanceReadiness',
          aggregateId: change.ambulanceId,
          aggregateVersion: change.version,
          streamType: 'ambulance',
          streamId: change.ambulanceId,
          tenantId: change.tenantId,
          facilityId: change.facilityId,
          occurredAt: now,
          data: { status: change.status, reasons: [...change.reasons] },
        });
        await this.audit.append(transaction, {
          id: this.ids.generate(),
          occurredAt: now,
          tenantId: change.tenantId,
          actorType: 'SYSTEM_POLICY',
          action: 'fleet.readiness.recalculate',
          resourceType: 'ambulance',
          resourceId: change.ambulanceId,
          outcome: 'ALLOWED',
          reasonCode: 'FLEET.READINESS_CHANGED',
          correlationId: context.correlationId,
          ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
          source: 'JOB',
          safeContext: { status: change.status },
          retentionClass: 'OPERATIONAL',
        });
      }
      return { code: changes.length > 0 ? 'READINESS_CHANGED' : 'NO_OP_CURRENT_STATE' };
    });
  }
}
