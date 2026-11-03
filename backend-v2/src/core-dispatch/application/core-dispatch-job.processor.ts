import type { AuditWriter } from '../../shared/application/audit/audit-writer.js';
import { RequestContext } from '../../shared/application/context/request-context.js';
import type { JobIntentEnvelope } from '../../shared/application/messaging/job-intent.js';
import type { DeliveryWriter } from '../../shared/application/messaging/delivery-writer.js';
import type { UnitOfWork } from '../../shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import { auditEvidence } from './core-dispatch-evidence.js';
import type { CoreDispatchPolicy } from './core-dispatch.policy.js';
import type { CoreDispatchRepository } from './ports/core-dispatch.repository.js';
import type { SafetyAlertDelivery } from './ports/safety-alert-delivery.js';

export type CoreDispatchJob = JobIntentEnvelope;

export interface CoreDispatchJobResult {
  readonly code: string;
}

export const CORE_DISPATCH_JOB_TYPES = Object.freeze([
  'dispatch.expire-offer.v1',
  'dispatch.finish-search.v1',
  'safety.deliver-alert.v1',
  'safety.escalate-unacknowledged.v1',
] as const);

export class CoreDispatchJobProcessor {
  constructor(
    private readonly repository: CoreDispatchRepository,
    private readonly alertDelivery: SafetyAlertDelivery,
    private readonly policy: CoreDispatchPolicy,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly delivery: DeliveryWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  process(job: CoreDispatchJob): Promise<CoreDispatchJobResult> {
    const context = this.context(job);
    switch (job.jobType) {
      case 'dispatch.expire-offer.v1':
        return this.expireOffer(context, job);
      case 'dispatch.finish-search.v1':
        return this.finishSearch(context, job);
      case 'safety.escalate-unacknowledged.v1':
        return this.escalateIncident(context, job);
      case 'safety.deliver-alert.v1':
        return this.deliverAlert(context, job);
      default:
        return Promise.resolve({ code: 'UNSUPPORTED_JOB_TYPE' });
    }
  }

  private expireOffer(
    context: RequestContext,
    job: CoreDispatchJob,
  ): Promise<CoreDispatchJobResult> {
    return this.unitOfWork.execute(context, async (transaction) => {
      const current = await this.repository.findOffer(transaction, job.resourceId);
      if (current === undefined) return { code: 'NO_OP_CURRENT_STATE' };
      const changed = await this.repository.expireOffer(transaction, job.resourceId);
      if (!changed) return { code: 'NO_OP_CURRENT_STATE' };
      const expired = await this.repository.findOffer(transaction, job.resourceId);
      if (expired === undefined) throw new Error('Expired dispatch offer disappeared');
      const occurredAt = expired.respondedAt ?? expired.updatedAt;
      await this.delivery.appendEvent(transaction, context, {
        eventId: this.ids.generate(),
        eventType: 'dispatch.offer.expired.v1',
        producer: 'core-dispatch-worker',
        aggregateType: 'dispatchOffer',
        aggregateId: current.id,
        aggregateVersion: expired.version,
        streamType: 'bookingDispatch',
        streamId: current.bookingId,
        tenantId: current.tenantId,
        facilityId: current.facilityId,
        occurredAt,
        data: { status: 'EXPIRED' },
      });
      await this.audit.append(
        transaction,
        auditEvidence(context, {
          id: this.ids.generate(),
          occurredAt,
          tenantId: current.tenantId,
          action: 'dispatch.offer.expire',
          resourceType: 'dispatch_offer',
          resourceId: current.id,
          reasonCode: 'DISPATCH.OFFER_EXPIRED',
        }),
      );
      return { code: 'OFFER_EXPIRED' };
    });
  }

  private finishSearch(
    context: RequestContext,
    job: CoreDispatchJob,
  ): Promise<CoreDispatchJobResult> {
    return this.unitOfWork.execute(context, async (transaction) => {
      const current = await this.repository.findBooking(transaction, job.resourceId);
      if (current === undefined) return { code: 'NO_OP_CURRENT_STATE' };
      const changed = await this.repository.finishSearch(
        transaction,
        job.resourceId,
        this.ids.generate(),
        job.jobIntentId,
      );
      if (!changed) return { code: 'NO_OP_CURRENT_STATE' };
      const finished = await this.repository.findBooking(transaction, job.resourceId);
      if (finished === undefined) throw new Error('Finished dispatch search disappeared');
      const occurredAt = finished.updatedAt;
      await this.delivery.appendEvent(transaction, context, {
        eventId: this.ids.generate(),
        eventType: 'booking.unfulfilled.v1',
        producer: 'core-dispatch-worker',
        aggregateType: 'booking',
        aggregateId: current.id,
        aggregateVersion: finished.version,
        streamType: 'bookingDispatch',
        streamId: current.id,
        occurredAt,
        data: { status: 'UNFULFILLED' },
      });
      await this.audit.append(
        transaction,
        auditEvidence(context, {
          id: this.ids.generate(),
          occurredAt,
          action: 'dispatch.search.finish',
          resourceType: 'booking',
          resourceId: current.id,
          reasonCode: 'DISPATCH.SEARCH_DEADLINE_EXPIRED',
        }),
      );
      return { code: 'BOOKING_UNFULFILLED' };
    });
  }

  private escalateIncident(
    context: RequestContext,
    job: CoreDispatchJob,
  ): Promise<CoreDispatchJobResult> {
    const expectedVersion = job.resourceVersion;
    const expectedTierValue = job.data['expectedTier'];
    const expectedTier = typeof expectedTierValue === 'number' ? expectedTierValue : undefined;
    if (expectedVersion === undefined || expectedTier === undefined) {
      return Promise.resolve({ code: 'INVALID_JOB_ENVELOPE' });
    }
    return this.unitOfWork.execute(context, async (transaction) => {
      const changed = await this.repository.escalateUnacknowledged(
        transaction,
        job.resourceId,
        expectedVersion,
        expectedTier,
        this.ids.generate(),
      );
      if (!changed) return { code: 'NO_OP_CURRENT_STATE' };
      const incident = await this.repository.findIncident(transaction, job.resourceId);
      if (incident === undefined) throw new Error('Escalated safety incident disappeared');
      const occurredAt = incident.updatedAt;
      await this.delivery.appendEvent(transaction, context, {
        eventId: this.ids.generate(),
        eventType: 'safety.incident.escalated.v1',
        producer: 'core-safety-worker',
        aggregateType: 'safetyIncident',
        aggregateId: incident.id,
        aggregateVersion: incident.version,
        streamType: 'safetyIncident',
        streamId: incident.id,
        ...(incident.tenantId === undefined ? {} : { tenantId: incident.tenantId }),
        ...(incident.facilityId === undefined ? {} : { facilityId: incident.facilityId }),
        occurredAt,
        data: {
          status: incident.status,
          escalationTier: incident.escalationTier,
          outcomeCode: 'UNACKNOWLEDGED_DEADLINE',
        },
      });
      await this.delivery.scheduleJob(transaction, context, {
        id: this.ids.generate(),
        deterministicJobId: `safety-deliver-alert-${incident.id}-tier-${String(incident.escalationTier)}`,
        jobType: 'safety.deliver-alert.v1',
        queueName: 'safety-critical',
        ...(incident.tenantId === undefined ? {} : { tenantId: incident.tenantId }),
        resourceType: 'safetyIncident',
        resourceId: incident.id,
        resourceVersion: incident.version,
        requestedAt: occurredAt,
        runAt: occurredAt,
        data: { severity: incident.severity, escalationTier: incident.escalationTier },
      });
      if (incident.escalationTier < 5) {
        await this.delivery.scheduleJob(transaction, context, {
          id: this.ids.generate(),
          deterministicJobId: `safety-escalate-unacknowledged-${incident.id}-v${String(incident.version)}`,
          jobType: 'safety.escalate-unacknowledged.v1',
          queueName: 'safety-critical',
          ...(incident.tenantId === undefined ? {} : { tenantId: incident.tenantId }),
          resourceType: 'safetyIncident',
          resourceId: incident.id,
          resourceVersion: incident.version,
          requestedAt: occurredAt,
          runAt: new Date(occurredAt.getTime() + this.policy.subsequentSafetyEscalationDelayMs),
          data: { expectedTier: incident.escalationTier },
        });
      }
      await this.audit.append(
        transaction,
        auditEvidence(context, {
          id: this.ids.generate(),
          occurredAt,
          ...(incident.tenantId === undefined ? {} : { tenantId: incident.tenantId }),
          action: 'safety.incident.auto-escalate',
          resourceType: 'safety_incident',
          resourceId: incident.id,
          reasonCode: 'SAFETY.UNACKNOWLEDGED_DEADLINE',
          safeContext: { escalationTier: incident.escalationTier },
        }),
      );
      return { code: 'INCIDENT_ESCALATED' };
    });
  }

  private async deliverAlert(
    context: RequestContext,
    job: CoreDispatchJob,
  ): Promise<CoreDispatchJobResult> {
    const severity = job.data['severity'];
    const escalationTier = job.data['escalationTier'];
    if (
      job.resourceVersion === undefined ||
      typeof severity !== 'string' ||
      !['CRITICAL', 'HIGH', 'MEDIUM'].includes(severity) ||
      typeof escalationTier !== 'number'
    ) {
      return { code: 'INVALID_JOB_ENVELOPE' };
    }
    const incident = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findIncident(transaction, job.resourceId),
    );
    if (incident === undefined) return { code: 'NO_OP_CURRENT_STATE' };
    if (
      incident.version !== job.resourceVersion ||
      incident.escalationTier !== escalationTier ||
      incident.severity !== severity ||
      incident.tenantId !== job.tenantId ||
      !['OPEN', 'ESCALATED'].includes(incident.status)
    ) {
      return { code: 'NO_OP_CURRENT_STATE' };
    }
    await this.alertDelivery.deliver({
      incidentId: incident.id,
      ...(incident.tenantId === undefined ? {} : { tenantId: incident.tenantId }),
      severity: incident.severity,
      escalationTier: incident.escalationTier,
      jobIntentId: job.jobIntentId,
    });
    return { code: 'ALERT_DELIVERED' };
  }

  private context(job: CoreDispatchJob): RequestContext {
    return new RequestContext({
      requestId: this.ids.generate(),
      correlationId: job.correlationId,
      causationId: job.jobIntentId,
      source: 'JOB',
      ...(job.tenantId === undefined
        ? {}
        : {
            scope: {
              tenantId: job.tenantId,
              facilityIds: [],
              accessScopeType: 'TENANT' as const,
            },
          }),
    });
  }
}
