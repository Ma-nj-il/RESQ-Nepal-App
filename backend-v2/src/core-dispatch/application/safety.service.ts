import type { AuditWriter } from '../../shared/application/audit/audit-writer.js';
import type { RequestContext } from '../../shared/application/context/request-context.js';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type {
  IdempotencyExecutor,
  IdempotentResult,
  JsonValue,
} from '../../shared/application/idempotency/idempotency.js';
import type { DeliveryWriter } from '../../shared/application/messaging/delivery-writer.js';
import type { UnitOfWork } from '../../shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { IncidentAction } from '../domain/core-dispatch.js';
import { auditEvidence } from './core-dispatch-evidence.js';
import {
  authenticationRequired,
  dispatchResultError,
  resourceNotFound,
} from './core-dispatch-errors.js';
import { incidentJson } from './core-dispatch-json.js';
import type { CoreDispatchPolicy } from './core-dispatch.policy.js';
import type {
  CoreDispatchRepository,
  SafetyIncidentRecord,
} from './ports/core-dispatch.repository.js';
import type { PatientDataProtector } from './ports/patient-data-protector.js';

export interface SafetyIncidentCreationInput {
  readonly tripId?: string;
  readonly incidentType: SafetyIncidentRecord['incidentType'];
  readonly severity: SafetyIncidentRecord['severity'];
  readonly details: Readonly<Record<string, JsonValue>>;
}

export interface SafetyIncidentTransitionInput {
  readonly targetTier?: number;
  readonly outcomeCode: string;
  readonly reason?: string;
}

export class SafetyService {
  constructor(
    private readonly repository: CoreDispatchRepository,
    private readonly patientData: PatientDataProtector,
    private readonly policy: CoreDispatchPolicy,
    private readonly idempotency: IdempotencyExecutor,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly delivery: DeliveryWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  createIncident(
    context: RequestContext,
    key: string,
    input: SafetyIncidentCreationInput,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireUser(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: 'safety.incident.create',
        request: {
          ...(input.tripId === undefined ? {} : { tripId: input.tripId }),
          incidentType: input.incidentType,
          severity: input.severity,
          details: { ...input.details },
        },
        successStatus: 201,
      },
      async (transaction) => {
        const trip =
          input.tripId === undefined
            ? undefined
            : await this.repository.findTrip(transaction, input.tripId);
        if (input.tripId !== undefined && trip === undefined) throw resourceNotFound();
        const incidentId = this.ids.generate();
        const protectedDetails = await this.patientData.protect(input.details);
        const created = await this.repository.createIncident(transaction, {
          incidentId,
          eventId: this.ids.generate(),
          ...(trip === undefined
            ? {}
            : {
                tripId: trip.id,
                bookingId: trip.bookingId,
                tenantId: trip.tenantId,
                facilityId: trip.facilityId,
              }),
          incidentType: input.incidentType,
          severity: input.severity,
          ...protectedDetails,
        });
        if (!created) {
          throw new ApplicationError({
            code: 'SAFETY.INCIDENT_REJECTED',
            message: 'The safety incident could not be created for this resource.',
            status: 422,
          });
        }
        const incident = await this.repository.findIncident(transaction, incidentId);
        if (incident === undefined) throw new Error('Created safety incident could not be read');
        const now = incident.createdAt;
        await this.delivery.appendEvent(transaction, context, {
          eventId: this.ids.generate(),
          eventType: 'safety.incident.created.v1',
          producer: 'core-safety',
          aggregateType: 'safetyIncident',
          aggregateId: incidentId,
          aggregateVersion: incident.version,
          streamType: 'safetyIncident',
          streamId: incidentId,
          ...(incident.tenantId === undefined ? {} : { tenantId: incident.tenantId }),
          ...(incident.facilityId === undefined ? {} : { facilityId: incident.facilityId }),
          occurredAt: now,
          data: {
            incidentType: incident.incidentType,
            severity: incident.severity,
            status: incident.status,
            escalationTier: incident.escalationTier,
          },
        });
        await this.scheduleAlert(transaction, context, incident, now);
        await this.scheduleEscalation(transaction, context, incident, now);
        await this.audit.append(
          transaction,
          auditEvidence(context, {
            id: this.ids.generate(),
            occurredAt: now,
            ...(incident.tenantId === undefined ? {} : { tenantId: incident.tenantId }),
            action: 'safety.incident.create',
            resourceType: 'safety_incident',
            resourceId: incidentId,
            reasonCode: 'SAFETY.INCIDENT_CREATED',
            safeContext: {
              incidentType: incident.incidentType,
              severity: incident.severity,
              boundToTrip: incident.tripId !== undefined,
            },
          }),
        );
        return incidentJson(incident);
      },
    );
  }

  listIncidents(context: RequestContext): Promise<readonly SafetyIncidentRecord[]> {
    this.requireUser(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listIncidents(transaction),
    );
  }

  async incident(context: RequestContext, incidentId: string): Promise<SafetyIncidentRecord> {
    this.requireUser(context);
    const incident = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findIncident(transaction, incidentId),
    );
    if (incident === undefined) throw resourceNotFound();
    return incident;
  }

  transition(
    context: RequestContext,
    key: string,
    incidentId: string,
    expectedVersion: number,
    action: IncidentAction,
    input: SafetyIncidentTransitionInput,
  ): Promise<IdempotentResult<JsonValue>> {
    const actorUserId = this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `safety.incident.${action.toLowerCase()}:${incidentId}`,
        request: {
          incidentId,
          expectedVersion,
          action,
          targetTier: input.targetTier ?? 0,
          outcomeCode: input.outcomeCode,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findIncident(transaction, incidentId);
        if (current === undefined) throw resourceNotFound();
        const result = await this.repository.transitionIncident(transaction, {
          incidentId,
          expectedVersion,
          eventId: this.ids.generate(),
          actorUserId,
          action,
          targetTier: input.targetTier ?? current.escalationTier,
          outcomeCode: input.outcomeCode,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        });
        if (result === 'INVALID_ESCALATION_TIER') {
          throw new ApplicationError({
            code: 'SAFETY.INVALID_ESCALATION_TIER',
            message: 'The requested safety escalation tier is invalid.',
            status: 422,
          });
        }
        if (
          ['NOT_FOUND', 'NOT_AUTHORIZED', 'STALE_VERSION', 'INVALID_TRANSITION'].includes(result)
        ) {
          throw dispatchResultError(result as Parameters<typeof dispatchResultError>[0]);
        }
        const changed = await this.repository.findIncident(transaction, incidentId);
        if (changed === undefined) throw new Error('Transitioned safety incident disappeared');
        const occurredAt = changed.updatedAt;
        const eventType =
          action === 'ACKNOWLEDGE'
            ? 'safety.incident.acknowledged.v1'
            : action === 'ESCALATE'
              ? 'safety.incident.escalated.v1'
              : 'safety.incident.resolved.v1';
        await this.delivery.appendEvent(transaction, context, {
          eventId: this.ids.generate(),
          eventType,
          producer: 'core-safety',
          aggregateType: 'safetyIncident',
          aggregateId: incidentId,
          aggregateVersion: changed.version,
          streamType: 'safetyIncident',
          streamId: incidentId,
          ...(changed.tenantId === undefined ? {} : { tenantId: changed.tenantId }),
          ...(changed.facilityId === undefined ? {} : { facilityId: changed.facilityId }),
          occurredAt,
          data: {
            status: changed.status,
            escalationTier: changed.escalationTier,
            outcomeCode: input.outcomeCode,
          },
        });
        if (action === 'ESCALATE') {
          await this.scheduleAlert(transaction, context, changed, occurredAt);
          await this.scheduleEscalation(transaction, context, changed, occurredAt);
        }
        await this.audit.append(
          transaction,
          auditEvidence(context, {
            id: this.ids.generate(),
            occurredAt,
            ...(changed.tenantId === undefined ? {} : { tenantId: changed.tenantId }),
            action: `safety.incident.${action.toLowerCase()}`,
            resourceType: 'safety_incident',
            resourceId: incidentId,
            reasonCode: input.outcomeCode,
            safeContext: {
              fromStatus: current.status,
              toStatus: changed.status,
              escalationTier: changed.escalationTier,
            },
          }),
        );
        return incidentJson(changed);
      },
    );
  }

  private async scheduleAlert(
    transaction: Parameters<DeliveryWriter['scheduleJob']>[0],
    context: RequestContext,
    incident: SafetyIncidentRecord,
    now: Date,
  ): Promise<void> {
    await this.delivery.scheduleJob(transaction, context, {
      id: this.ids.generate(),
      deterministicJobId: `safety-deliver-alert-${incident.id}-tier-${String(incident.escalationTier)}`,
      jobType: 'safety.deliver-alert.v1',
      queueName: 'safety-critical',
      ...(incident.tenantId === undefined ? {} : { tenantId: incident.tenantId }),
      resourceType: 'safetyIncident',
      resourceId: incident.id,
      resourceVersion: incident.version,
      requestedAt: now,
      runAt: now,
      data: { severity: incident.severity, escalationTier: incident.escalationTier },
    });
  }

  private async scheduleEscalation(
    transaction: Parameters<DeliveryWriter['scheduleJob']>[0],
    context: RequestContext,
    incident: SafetyIncidentRecord,
    now: Date,
  ): Promise<void> {
    if (incident.escalationTier >= 5) return;
    const delay =
      incident.escalationTier === 0
        ? this.policy.firstSafetyEscalationDelayMs
        : this.policy.subsequentSafetyEscalationDelayMs;
    await this.delivery.scheduleJob(transaction, context, {
      id: this.ids.generate(),
      deterministicJobId: `safety-escalate-unacknowledged-${incident.id}-v${String(incident.version)}`,
      jobType: 'safety.escalate-unacknowledged.v1',
      queueName: 'safety-critical',
      ...(incident.tenantId === undefined ? {} : { tenantId: incident.tenantId }),
      resourceType: 'safetyIncident',
      resourceId: incident.id,
      resourceVersion: incident.version,
      requestedAt: now,
      runAt: new Date(now.getTime() + delay),
      data: { expectedTier: incident.escalationTier },
    });
  }

  private requireUser(context: RequestContext): string {
    if (context.actor?.type !== 'USER') throw authenticationRequired();
    return context.actor.id;
  }

  private requireTenant(context: RequestContext): string {
    const userId = this.requireUser(context);
    if (context.scope.tenantId === undefined) throw resourceNotFound();
    return userId;
  }
}

export const safetyJson = Object.freeze({ incident: incidentJson });
