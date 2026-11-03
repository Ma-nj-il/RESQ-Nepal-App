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
import {
  transitionProviderApplication,
  type ProviderApplicationCommand,
  type ProviderApplicationStatus,
} from '../domain/provider-operations.js';
import type {
  ProviderApplicationRecord,
  ProviderApplicationReviewRecord,
  FacilityRecord,
  ProviderOrganizationRecord,
  ProviderOperationsRepository,
} from './ports/provider-operations.repository.js';

interface ProviderApplicationFields {
  readonly legalName: string;
  readonly displayName: string;
  readonly registrationNumber: string;
  readonly geographicUnitId: string;
  readonly facilityName: string;
  readonly facilityType: string;
  readonly publicPhone?: string;
}

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

function invalidTransition(): ApplicationError {
  return new ApplicationError({
    code: 'PROVIDER_APPLICATION.INVALID_TRANSITION',
    message: 'The provider application cannot perform this action in its current state.',
    status: 422,
  });
}

function json(record: ProviderApplicationRecord): JsonValue {
  return {
    id: record.id,
    applicantUserId: record.applicantUserId,
    legalName: record.legalName,
    displayName: record.displayName,
    registrationNumber: record.registrationNumber,
    geographicUnitId: record.geographicUnitId,
    facilityName: record.facilityName,
    facilityType: record.facilityType,
    ...(record.publicPhone === undefined ? {} : { publicPhone: record.publicPhone }),
    status: record.status,
    version: record.version,
    ...(record.submittedAt === undefined ? {} : { submittedAt: record.submittedAt.toISOString() }),
    ...(record.decidedAt === undefined ? {} : { decidedAt: record.decidedAt.toISOString() }),
    ...(record.tenantId === undefined ? {} : { tenantId: record.tenantId }),
    ...(record.facilityId === undefined ? {} : { facilityId: record.facilityId }),
  };
}

export class ProviderRegistryService {
  constructor(
    private readonly repository: ProviderOperationsRepository,
    private readonly idempotency: IdempotencyExecutor,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly delivery: DeliveryWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  listProviderOrganizations(
    context: RequestContext,
  ): Promise<readonly ProviderOrganizationRecord[]> {
    this.requireTenantOrAuthority(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listProviderOrganizations(transaction),
    );
  }

  listFacilities(context: RequestContext): Promise<readonly FacilityRecord[]> {
    this.requireTenantOrAuthority(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listFacilities(transaction),
    );
  }

  createApplication(
    context: RequestContext,
    key: string,
    input: ProviderApplicationFields,
  ): Promise<IdempotentResult<JsonValue>> {
    const applicantUserId = this.requireUser(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: 'provider.application.create',
        request: { ...input },
        successStatus: 201,
      },
      async (transaction) => {
        const now = this.clock.now();
        const application = await this.repository.createProviderApplication(transaction, {
          id: this.ids.generate(),
          applicantUserId,
          ...input,
          now,
        });
        await this.recordChange(transaction, context, application, now, {
          eventType: 'provider.application.draft-created.v1',
          action: 'provider.application.create',
          reasonCode: 'PROVIDER_APPLICATION.DRAFT_CREATED',
        });
        return json(application);
      },
    );
  }

  async application(
    context: RequestContext,
    applicationId: string,
  ): Promise<ProviderApplicationRecord> {
    this.requireUser(context);
    const result = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findProviderApplication(transaction, applicationId),
    );
    if (result === undefined) throw notFound();
    return result;
  }

  listForAuthority(
    context: RequestContext,
    statuses?: readonly ProviderApplicationStatus[],
  ): Promise<readonly ProviderApplicationRecord[]> {
    this.requireAuthority(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listProviderApplications(transaction, statuses),
    );
  }

  updateApplication(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    input: ProviderApplicationFields,
  ): Promise<IdempotentResult<JsonValue>> {
    const applicantUserId = this.requireUser(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `provider.application.update:${applicationId}`,
        request: { applicationId, expectedVersion, ...input },
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const application = await this.repository.updateProviderApplicationDraft(transaction, {
          applicationId,
          applicantUserId,
          expectedVersion,
          ...input,
          now,
        });
        if (application === undefined) throw stale();
        await this.recordChange(transaction, context, application, now, {
          eventType: 'provider.application.draft-updated.v1',
          action: 'provider.application.update',
          reasonCode: 'PROVIDER_APPLICATION.DRAFT_UPDATED',
        });
        return json(application);
      },
    );
  }

  submit(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireUser(context);
    return this.transition(context, key, applicationId, expectedVersion, 'SUBMIT', {
      operation: 'provider.application.submit',
      eventType: 'provider.application.submitted.v1',
      reasonCode: 'PROVIDER_APPLICATION.SUBMITTED',
    });
  }

  withdraw(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireUser(context);
    return this.transition(context, key, applicationId, expectedVersion, 'WITHDRAW', {
      operation: 'provider.application.withdraw',
      eventType: 'provider.application.withdrawn.v1',
      reasonCode: 'PROVIDER_APPLICATION.WITHDRAWN',
      reason,
    });
  }

  requestInformation(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    return this.reviewTransition(
      context,
      key,
      applicationId,
      expectedVersion,
      'REQUEST_INFORMATION',
      {
        decision: 'INFORMATION_REQUESTED',
        operation: 'provider.application.request-information',
        eventType: 'provider.application.information-requested.v1',
        reasonCode: 'PROVIDER_APPLICATION.INFORMATION_REQUESTED',
        reason,
      },
    );
  }

  recommend(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireAuthority(context, 'PROVINCE');
    return this.reviewTransition(context, key, applicationId, expectedVersion, 'RECOMMEND', {
      decision: 'RECOMMENDED',
      operation: 'provider.application.recommend',
      eventType: 'provider.application.recommended.v1',
      reasonCode: 'PROVIDER_APPLICATION.RECOMMENDED',
      reason,
    });
  }

  reject(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    return this.reviewTransition(context, key, applicationId, expectedVersion, 'REJECT', {
      decision: 'REJECTED',
      operation: 'provider.application.reject',
      eventType: 'provider.application.rejected.v1',
      reasonCode: 'PROVIDER_APPLICATION.REJECTED',
      reason,
    });
  }

  approve(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    const reviewerUserId = this.requireUser(context);
    const authorityGrantId = this.requireAuthority(context, 'PLATFORM');
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `provider.application.approve:${applicationId}`,
        request: { applicationId, expectedVersion, reason },
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const application = await this.repository.findProviderApplication(
          transaction,
          applicationId,
        );
        if (application === undefined) throw notFound();
        if (transitionProviderApplication(application.status, 'APPROVE') === undefined) {
          throw invalidTransition();
        }
        const approved = await this.repository.approveProviderApplication(transaction, {
          applicationId,
          expectedVersion,
          reviewId: this.ids.generate(),
          tenantId: this.ids.generate(),
          facilityId: this.ids.generate(),
          membershipId: this.ids.generate(),
          accessAssignmentId: this.ids.generate(),
          reviewerUserId,
          authorityGrantId,
          reason,
          now,
          assignmentValidUntil: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000),
        });
        if (approved === undefined) throw stale();
        await this.recordChange(transaction, context, approved, now, {
          eventType: 'provider.application.approved.v1',
          action: 'provider.application.approve',
          reasonCode: 'PROVIDER_APPLICATION.APPROVED',
          reason,
        });
        return json(approved);
      },
    );
  }

  private transition(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    command: ProviderApplicationCommand,
    evidence: {
      readonly operation: string;
      readonly eventType: string;
      readonly reasonCode: string;
      readonly reason?: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `${evidence.operation}:${applicationId}`,
        request: { applicationId, expectedVersion, reason: evidence.reason ?? null },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findProviderApplication(transaction, applicationId);
        if (current === undefined) throw notFound();
        const target = transitionProviderApplication(current.status, command);
        if (target === undefined) throw invalidTransition();
        const now = this.clock.now();
        const changed = await this.repository.transitionProviderApplication(transaction, {
          applicationId,
          expectedVersion,
          fromStatuses: [current.status],
          toStatus: target,
          now,
        });
        if (changed === undefined) throw stale();
        await this.recordChange(transaction, context, changed, now, {
          eventType: evidence.eventType,
          action: evidence.operation,
          reasonCode: evidence.reasonCode,
          ...(evidence.reason === undefined ? {} : { reason: evidence.reason }),
        });
        return json(changed);
      },
    );
  }

  private reviewTransition(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    command: ProviderApplicationCommand,
    evidence: {
      readonly decision: ProviderApplicationReviewRecord['decision'];
      readonly operation: string;
      readonly eventType: string;
      readonly reasonCode: string;
      readonly reason: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const reviewerUserId = this.requireUser(context);
    const authorityGrantId = this.requireAuthority(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `${evidence.operation}:${applicationId}`,
        request: { applicationId, expectedVersion, reason: evidence.reason },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findProviderApplication(transaction, applicationId);
        if (current === undefined) throw notFound();
        if (current.applicantUserId === reviewerUserId) {
          throw new ApplicationError({
            code: 'PROVIDER_APPLICATION.SEGREGATION_OF_DUTIES_REQUIRED',
            message: 'The applicant cannot review this provider application.',
            status: 403,
          });
        }
        const target = transitionProviderApplication(current.status, command);
        if (target === undefined) throw invalidTransition();
        const now = this.clock.now();
        const changed = await this.repository.transitionProviderApplication(transaction, {
          applicationId,
          expectedVersion,
          fromStatuses: [current.status],
          toStatus: target,
          now,
        });
        if (changed === undefined) throw stale();
        await this.repository.recordProviderReview(transaction, {
          id: this.ids.generate(),
          applicationId,
          reviewerUserId,
          authorityGrantId,
          decision: evidence.decision,
          reason: evidence.reason,
          fromStatus: current.status,
          toStatus: target,
          createdAt: now,
        });
        await this.recordChange(transaction, context, changed, now, {
          eventType: evidence.eventType,
          action: evidence.operation,
          reasonCode: evidence.reasonCode,
          reason: evidence.reason,
        });
        return json(changed);
      },
    );
  }

  private async recordChange(
    transaction: TransactionContext,
    context: RequestContext,
    application: ProviderApplicationRecord,
    now: Date,
    evidence: {
      readonly eventType: string;
      readonly action: string;
      readonly reasonCode: string;
      readonly reason?: string;
    },
  ): Promise<void> {
    await this.delivery.appendEvent(transaction, context, {
      eventId: this.ids.generate(),
      eventType: evidence.eventType,
      producer: 'provider-registry',
      aggregateType: 'providerApplication',
      aggregateId: application.id,
      aggregateVersion: application.version,
      streamType: 'providerApplication',
      streamId: application.id,
      occurredAt: now,
      data: { status: application.status },
    });
    await this.audit.append(transaction, {
      id: this.ids.generate(),
      occurredAt: now,
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
      resourceType: 'provider_application',
      resourceId: application.id,
      outcome: 'ALLOWED',
      reasonCode: evidence.reasonCode,
      correlationId: context.correlationId,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
      source: context.source,
      safeContext: {
        status: application.status,
        ...(evidence.reason === undefined ? {} : { reason: evidence.reason }),
      },
      retentionClass: 'PROVIDER_COMPLIANCE',
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

  private requireAuthority(
    context: RequestContext,
    requiredLevel?: 'PROVINCE' | 'PLATFORM',
  ): string {
    const grantId = context.scope.authorityGrantId;
    if (
      grantId === undefined ||
      context.scope.authority === undefined ||
      (requiredLevel !== undefined && context.scope.authority.level !== requiredLevel)
    ) {
      throw new ApplicationError({
        code: 'ACCESS.PERMISSION_DENIED',
        message: 'This action is not permitted.',
        status: 403,
      });
    }
    return grantId;
  }

  private requireTenantOrAuthority(context: RequestContext): void {
    if (context.scope.tenantId === undefined && context.scope.authorityGrantId === undefined) {
      throw new ApplicationError({
        code: 'ACCESS.PERMISSION_DENIED',
        message: 'This action is not permitted.',
        status: 403,
      });
    }
  }
}
