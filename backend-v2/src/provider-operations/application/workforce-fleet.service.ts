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
  AmbulanceComplianceStatus,
  AmbulanceOperationalStatus,
  DriverAccountStatus,
  DriverDutyStatus,
} from '../domain/provider-operations.js';
import type {
  AmbulanceRecord,
  DriverApplicationRecord,
  DriverRecord,
  MaintenanceRecord,
  ProviderOperationsRepository,
} from './ports/provider-operations.repository.js';

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

function invalid(code: string, message: string): ApplicationError {
  return new ApplicationError({ code, message, status: 422 });
}

function driverJson(record: DriverRecord): JsonValue {
  return {
    id: record.id,
    tenantId: record.tenantId,
    userId: record.userId,
    licenceNumber: record.licenceNumber,
    licenceExpiresOn: record.licenceExpiresOn,
    verificationStatus: record.verificationStatus,
    accountStatus: record.accountStatus,
    dutyStatus: record.dutyStatus,
    facilityIds: [...record.facilityIds],
    eligible: record.eligibilityReasons.length === 0,
    eligibilityReasons: [...record.eligibilityReasons],
    version: record.version,
  };
}

function driverApplicationJson(record: DriverApplicationRecord): JsonValue {
  return {
    id: record.id,
    applicantUserId: record.applicantUserId,
    tenantId: record.tenantId,
    facilityId: record.facilityId,
    licenceNumber: record.licenceNumber,
    licenceExpiresOn: record.licenceExpiresOn,
    status: record.status,
    version: record.version,
    ...(record.submittedAt === undefined ? {} : { submittedAt: record.submittedAt.toISOString() }),
  };
}

function ambulanceJson(record: AmbulanceRecord): JsonValue {
  return {
    id: record.id,
    tenantId: record.tenantId,
    facilityId: record.facilityId,
    plateNumber: record.plateNumber,
    ...(record.vin === undefined ? {} : { vin: record.vin }),
    category: record.category,
    complianceStatus: record.complianceStatus,
    operationalStatus: record.operationalStatus,
    gpsQuality: record.gpsQuality,
    readinessStatus: record.readinessStatus,
    readinessReasons: [...record.readinessReasons],
    readinessVersion: record.readinessVersion,
    version: record.version,
  };
}

export class WorkforceFleetService {
  constructor(
    private readonly repository: ProviderOperationsRepository,
    private readonly idempotency: IdempotencyExecutor,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly delivery: DeliveryWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  createDriverApplication(
    context: RequestContext,
    key: string,
    input: {
      readonly tenantId: string;
      readonly facilityId: string;
      readonly licenceNumber: string;
      readonly licenceExpiresOn: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const applicantUserId = this.requireUser(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: 'workforce.driver-application.create',
        request: { ...input },
        successStatus: 201,
      },
      async (transaction) => {
        const now = this.clock.now();
        const application = await this.repository.createDriverApplication(transaction, {
          id: this.ids.generate(),
          applicantUserId,
          ...input,
          now,
        });
        await this.recordEvent(transaction, context, {
          eventType: 'workforce.driver-application.created.v1',
          aggregateType: 'driverApplication',
          aggregateId: application.id,
          aggregateVersion: application.version,
          streamType: 'driverApplication',
          streamId: application.id,
          occurredAt: now,
          data: { status: application.status },
        });
        return driverApplicationJson(application);
      },
    );
  }

  listOwnDriverApplications(context: RequestContext): Promise<readonly DriverApplicationRecord[]> {
    const userId = this.requireUser(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listDriverApplications(transaction, userId),
    );
  }

  listTenantDriverApplications(
    context: RequestContext,
  ): Promise<readonly DriverApplicationRecord[]> {
    this.requireTenant(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listDriverApplications(transaction),
    );
  }

  submitDriverApplication(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
  ): Promise<IdempotentResult<JsonValue>> {
    const userId = this.requireUser(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `workforce.driver-application.submit:${applicationId}`,
        request: { applicationId, expectedVersion },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findDriverApplication(transaction, applicationId);
        if (current === undefined || current.applicantUserId !== userId) throw notFound();
        if (!['DRAFT', 'NEEDS_INFORMATION'].includes(current.status)) {
          throw invalid(
            'DRIVER_APPLICATION.INVALID_TRANSITION',
            'The driver application cannot be submitted in its current state.',
          );
        }
        const now = this.clock.now();
        const changed = await this.repository.transitionDriverApplication(transaction, {
          applicationId,
          expectedVersion,
          fromStatuses: [current.status],
          toStatus: 'SUBMITTED',
          now,
        });
        if (changed === undefined) throw stale();
        await this.recordEvent(transaction, context, {
          eventType: 'workforce.driver-application.submitted.v1',
          aggregateType: 'driverApplication',
          aggregateId: changed.id,
          aggregateVersion: changed.version,
          streamType: 'driverApplication',
          streamId: changed.id,
          occurredAt: now,
          data: { status: changed.status },
        });
        return driverApplicationJson(changed);
      },
    );
  }

  requestDriverInformation(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    return this.reviewDriverApplication(
      context,
      key,
      applicationId,
      expectedVersion,
      'NEEDS_INFORMATION',
      reason,
      'workforce.driver-application.information-requested.v1',
    );
  }

  rejectDriverApplication(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    return this.reviewDriverApplication(
      context,
      key,
      applicationId,
      expectedVersion,
      'REJECTED',
      reason,
      'workforce.driver-verification.changed.v1',
    );
  }

  approveDriverApplication(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    const reviewerUserId = this.requireUser(context);
    this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `workforce.driver-application.approve:${applicationId}`,
        request: { applicationId, expectedVersion, reason },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findDriverApplication(transaction, applicationId);
        if (current === undefined) throw notFound();
        if (current.applicantUserId === reviewerUserId) {
          throw new ApplicationError({
            code: 'DRIVER_APPLICATION.SEGREGATION_OF_DUTIES_REQUIRED',
            message: 'The applicant cannot approve their own driver application.',
            status: 403,
          });
        }
        if (current.status !== 'SUBMITTED') {
          throw invalid(
            'DRIVER_APPLICATION.INVALID_TRANSITION',
            'The driver application cannot be approved in its current state.',
          );
        }
        const now = this.clock.now();
        const driver = await this.repository.approveDriverApplication(transaction, {
          applicationId,
          expectedVersion,
          driverId: this.ids.generate(),
          affiliationId: this.ids.generate(),
          reviewerUserId,
          reason,
          now,
        });
        if (driver === undefined) throw stale();
        await this.recordTenantChange(transaction, context, {
          eventType: 'workforce.driver-verification.changed.v1',
          aggregateType: 'driver',
          aggregateId: driver.id,
          aggregateVersion: driver.version,
          streamType: 'driver',
          streamId: driver.id,
          occurredAt: now,
          data: { verificationStatus: driver.verificationStatus },
          action: 'workforce.driver-application.approve',
          reason,
        });
        return driverJson(driver);
      },
    );
  }

  listDrivers(context: RequestContext): Promise<readonly DriverRecord[]> {
    this.requireTenantOrAuthority(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listDrivers(transaction),
    );
  }

  async driver(context: RequestContext, driverId: string): Promise<DriverRecord> {
    this.requireTenantOrAuthority(context);
    const record = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findDriver(transaction, driverId),
    );
    if (record === undefined) throw notFound();
    return record;
  }

  changeDriverAccountStatus(
    context: RequestContext,
    key: string,
    driverId: string,
    expectedVersion: number,
    status: DriverAccountStatus,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireTenant(context);
    return this.changeDriverState(context, key, driverId, expectedVersion, reason, {
      operation: 'workforce.driver-account-status.change',
      eventType: 'workforce.driver-account-status.changed.v1',
      field: 'accountStatus',
      value: status,
      apply: (transaction, now) =>
        this.repository.changeDriverAccountStatus(transaction, {
          driverId,
          expectedVersion,
          status,
          now,
        }),
    });
  }

  changeDriverDutyStatus(
    context: RequestContext,
    key: string,
    driverId: string,
    expectedVersion: number,
    status: DriverDutyStatus,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `workforce.driver-duty-status.change:${driverId}`,
        request: { driverId, expectedVersion, status, reason },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findDriver(transaction, driverId);
        if (current === undefined) throw notFound();
        if (['RESERVED', 'ON_TRIP'].includes(current.dutyStatus)) {
          throw invalid(
            'DRIVER.ACTIVE_ASSIGNMENT_CONFLICT',
            'Duty status cannot be changed while the driver is assigned to active work.',
          );
        }
        if (
          status === 'AVAILABLE' &&
          current.eligibilityReasons.some((item) => item !== 'NOT_AVAILABLE_FOR_DUTY')
        ) {
          throw invalid('DRIVER.NOT_ELIGIBLE', 'The driver is not eligible to become available.');
        }
        const now = this.clock.now();
        const driver = await this.repository.changeDriverDutyStatus(transaction, {
          driverId,
          expectedVersion,
          status,
          now,
        });
        if (driver === undefined) throw stale();
        await this.recordTenantChange(transaction, context, {
          eventType: 'workforce.driver-duty-status.changed.v1',
          aggregateType: 'driver',
          aggregateId: driver.id,
          aggregateVersion: driver.version,
          streamType: 'driver',
          streamId: driver.id,
          occurredAt: now,
          data: { dutyStatus: driver.dutyStatus },
          action: 'workforce.driver-duty-status.change',
          reason,
        });
        return driverJson(driver);
      },
    );
  }

  createAmbulance(
    context: RequestContext,
    key: string,
    input: {
      readonly facilityId: string;
      readonly plateNumber: string;
      readonly vin?: string;
      readonly category: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    const registeredByUserId = this.requireUser(context);
    this.requireFacility(context, input.facilityId);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: 'fleet.ambulance.create',
        request: { ...input },
        successStatus: 201,
      },
      async (transaction) => {
        const now = this.clock.now();
        const ambulance = await this.repository.createAmbulance(transaction, {
          id: this.ids.generate(),
          tenantId,
          registeredByUserId,
          ...input,
          now,
        });
        await this.recordTenantChange(transaction, context, {
          eventType: 'fleet.ambulance-registered.v1',
          aggregateType: 'ambulance',
          aggregateId: ambulance.id,
          aggregateVersion: ambulance.version,
          streamType: 'ambulance',
          streamId: ambulance.id,
          occurredAt: now,
          data: { complianceStatus: ambulance.complianceStatus },
          action: 'fleet.ambulance.create',
          reason: 'Fleet registration',
          facilityId: ambulance.facilityId,
        });
        return ambulanceJson(ambulance);
      },
    );
  }

  listAmbulances(context: RequestContext): Promise<readonly AmbulanceRecord[]> {
    this.requireTenantOrAuthority(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listAmbulances(transaction),
    );
  }

  async ambulance(context: RequestContext, ambulanceId: string): Promise<AmbulanceRecord> {
    this.requireTenantOrAuthority(context);
    const record = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findAmbulance(transaction, ambulanceId),
    );
    if (record === undefined) throw notFound();
    return record;
  }

  updateAmbulance(
    context: RequestContext,
    key: string,
    ambulanceId: string,
    expectedVersion: number,
    input: { readonly plateNumber: string; readonly vin?: string; readonly category: string },
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `fleet.ambulance.update:${ambulanceId}`,
        request: { ambulanceId, expectedVersion, ...input },
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const ambulance = await this.repository.updateAmbulance(transaction, {
          ambulanceId,
          expectedVersion,
          ...input,
          now,
        });
        if (ambulance === undefined) throw stale();
        await this.recordTenantChange(transaction, context, {
          eventType: 'fleet.ambulance-details.changed.v1',
          aggregateType: 'ambulance',
          aggregateId: ambulance.id,
          aggregateVersion: ambulance.version,
          streamType: 'ambulance',
          streamId: ambulance.id,
          occurredAt: now,
          data: { category: ambulance.category },
          action: 'fleet.ambulance.update',
          reason: 'Fleet record update',
          facilityId: ambulance.facilityId,
        });
        return ambulanceJson(ambulance);
      },
    );
  }

  changeAmbulanceOperationalStatus(
    context: RequestContext,
    key: string,
    ambulanceId: string,
    expectedVersion: number,
    status: AmbulanceOperationalStatus,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `fleet.ambulance-operational-status.change:${ambulanceId}`,
        request: { ambulanceId, expectedVersion, status, reason },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findAmbulance(transaction, ambulanceId);
        if (current === undefined) throw notFound();
        if (['RESERVED', 'DISPATCHED'].includes(current.operationalStatus)) {
          throw invalid(
            'AMBULANCE.ACTIVE_ASSIGNMENT_CONFLICT',
            'Operational status cannot be changed while the ambulance is assigned.',
          );
        }
        if (
          status === 'AVAILABLE' &&
          current.readinessReasons.some((item) => item !== 'NOT_OPERATIONALLY_AVAILABLE')
        ) {
          throw invalid('AMBULANCE.NOT_ELIGIBLE', 'The ambulance is not ready for dispatch.');
        }
        const now = this.clock.now();
        const ambulance = await this.repository.changeAmbulanceOperationalStatus(transaction, {
          ambulanceId,
          expectedVersion,
          status,
          now,
        });
        if (ambulance === undefined) throw stale();
        await this.recordTenantChange(transaction, context, {
          eventType: 'fleet.ambulance-operational-status.changed.v1',
          aggregateType: 'ambulance',
          aggregateId: ambulance.id,
          aggregateVersion: ambulance.version,
          streamType: 'ambulance',
          streamId: ambulance.id,
          occurredAt: now,
          data: { operationalStatus: ambulance.operationalStatus },
          action: 'fleet.ambulance-operational-status.change',
          reason,
          facilityId: ambulance.facilityId,
        });
        return ambulanceJson(ambulance);
      },
    );
  }

  reviewAmbulanceCompliance(
    context: RequestContext,
    key: string,
    ambulanceId: string,
    expectedVersion: number,
    status: Exclude<AmbulanceComplianceStatus, 'PENDING_REVIEW'>,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    const reviewerUserId = this.requireUser(context);
    const authorityGrantId = this.requireAuthority(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `fleet.ambulance-compliance.review:${ambulanceId}`,
        request: { ambulanceId, expectedVersion, status, reason },
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const ambulance = await this.repository.reviewAmbulanceCompliance(transaction, {
          reviewId: this.ids.generate(),
          ambulanceId,
          expectedVersion,
          status,
          reviewerUserId,
          authorityGrantId,
          reason,
          now,
        });
        if (ambulance === undefined) throw stale();
        await this.recordTenantChange(transaction, context, {
          eventType: 'fleet.ambulance-compliance.changed.v1',
          aggregateType: 'ambulance',
          aggregateId: ambulance.id,
          aggregateVersion: ambulance.version,
          streamType: 'ambulance',
          streamId: ambulance.id,
          occurredAt: now,
          data: {
            complianceStatus: ambulance.complianceStatus,
            readinessStatus: ambulance.readinessStatus,
          },
          action: 'fleet.ambulance-compliance.review',
          reason,
          tenantId: ambulance.tenantId,
          facilityId: ambulance.facilityId,
        });
        return ambulanceJson(ambulance);
      },
    );
  }

  listMaintenance(
    context: RequestContext,
    ambulanceId: string,
  ): Promise<readonly MaintenanceRecord[]> {
    this.requireTenant(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listMaintenanceRecords(transaction, ambulanceId),
    );
  }

  createMaintenance(
    context: RequestContext,
    key: string,
    ambulanceId: string,
    input: {
      readonly maintenanceType: MaintenanceRecord['maintenanceType'];
      readonly status: MaintenanceRecord['status'];
      readonly scheduledFor: Date;
      readonly odometerMeters?: number;
      readonly notes: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `fleet.maintenance.create:${ambulanceId}`,
        request: {
          ambulanceId,
          ...input,
          scheduledFor: input.scheduledFor.toISOString(),
        },
        successStatus: 201,
      },
      async (transaction) => {
        const ambulance = await this.repository.findAmbulance(transaction, ambulanceId);
        if (ambulance === undefined) throw notFound();
        if (
          input.status === 'IN_PROGRESS' &&
          ['RESERVED', 'DISPATCHED'].includes(ambulance.operationalStatus)
        ) {
          throw invalid(
            'AMBULANCE.ACTIVE_ASSIGNMENT_CONFLICT',
            'Maintenance cannot begin while the ambulance is assigned.',
          );
        }
        const now = this.clock.now();
        const maintenance = await this.repository.createMaintenanceRecord(transaction, {
          id: this.ids.generate(),
          tenantId,
          facilityId: ambulance.facilityId,
          ambulanceId,
          ...input,
          now,
        });
        await this.recordTenantChange(transaction, context, {
          eventType: 'fleet.maintenance-due.v1',
          aggregateType: 'maintenanceRecord',
          aggregateId: maintenance.id,
          aggregateVersion: maintenance.version,
          streamType: 'ambulance',
          streamId: ambulanceId,
          occurredAt: now,
          data: { status: maintenance.status, maintenanceType: maintenance.maintenanceType },
          action: 'fleet.maintenance.create',
          reason: input.notes,
          facilityId: ambulance.facilityId,
        });
        await this.delivery.scheduleJob(transaction, context, {
          id: this.ids.generate(),
          deterministicJobId: `maintenance-${maintenance.id}-readiness-v${String(maintenance.version)}`,
          jobType: 'compliance.recalculate-readiness.v1',
          queueName: 'compliance',
          tenantId,
          resourceType: 'ambulance',
          resourceId: ambulanceId,
          resourceVersion: ambulance.readinessVersion,
          requestedAt: now,
          runAt: now,
          data: { cause: 'MAINTENANCE_CHANGED' },
        });
        return {
          id: maintenance.id,
          ambulanceId: maintenance.ambulanceId,
          maintenanceType: maintenance.maintenanceType,
          status: maintenance.status,
          scheduledFor: maintenance.scheduledFor.toISOString(),
          notes: maintenance.notes,
          version: maintenance.version,
        };
      },
    );
  }

  upsertEquipment(
    context: RequestContext,
    key: string,
    ambulanceId: string,
    input: {
      readonly equipmentType: string;
      readonly required: boolean;
      readonly present: boolean;
      readonly expiresOn?: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `fleet.equipment.upsert:${ambulanceId}:${input.equipmentType}`,
        request: { ambulanceId, ...input },
        successStatus: 200,
      },
      async (transaction) => {
        const ambulance = await this.repository.findAmbulance(transaction, ambulanceId);
        if (ambulance === undefined) throw notFound();
        const now = this.clock.now();
        await this.repository.upsertEquipment(transaction, {
          id: this.ids.generate(),
          ambulanceId,
          ...input,
          now,
        });
        await this.delivery.scheduleJob(transaction, context, {
          id: this.ids.generate(),
          deterministicJobId: `equipment-${ambulanceId}-${this.ids.generate()}`,
          jobType: 'compliance.recalculate-readiness.v1',
          queueName: 'compliance',
          tenantId,
          resourceType: 'ambulance',
          resourceId: ambulanceId,
          resourceVersion: ambulance.readinessVersion,
          requestedAt: now,
          runAt: now,
          data: { cause: 'EQUIPMENT_CHANGED' },
        });
        if (input.expiresOn !== undefined) {
          const runAt = new Date(`${input.expiresOn}T00:00:00.000Z`);
          runAt.setUTCDate(runAt.getUTCDate() + 1);
          await this.delivery.scheduleJob(transaction, context, {
            id: this.ids.generate(),
            deterministicJobId: `equipment-expiry-${ambulanceId}-${this.ids.generate()}`,
            jobType: 'compliance.recalculate-readiness.v1',
            queueName: 'compliance',
            tenantId,
            resourceType: 'ambulance',
            resourceId: ambulanceId,
            resourceVersion: ambulance.readinessVersion,
            requestedAt: now,
            runAt,
            data: { cause: 'EQUIPMENT_EXPIRY' },
          });
        }
        return { ambulanceId, ...input };
      },
    );
  }

  private reviewDriverApplication(
    context: RequestContext,
    key: string,
    applicationId: string,
    expectedVersion: number,
    toStatus: 'NEEDS_INFORMATION' | 'REJECTED',
    reason: string,
    eventType: string,
  ): Promise<IdempotentResult<JsonValue>> {
    const reviewerUserId = this.requireUser(context);
    this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `workforce.driver-application.${toStatus.toLowerCase()}:${applicationId}`,
        request: { applicationId, expectedVersion, reason },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findDriverApplication(transaction, applicationId);
        if (current === undefined) throw notFound();
        if (current.status !== 'SUBMITTED') {
          throw invalid(
            'DRIVER_APPLICATION.INVALID_TRANSITION',
            'The driver application cannot be reviewed in its current state.',
          );
        }
        if (current.applicantUserId === reviewerUserId) {
          throw new ApplicationError({
            code: 'DRIVER_APPLICATION.SEGREGATION_OF_DUTIES_REQUIRED',
            message: 'The applicant cannot review their own driver application.',
            status: 403,
          });
        }
        const now = this.clock.now();
        const changed = await this.repository.transitionDriverApplication(transaction, {
          applicationId,
          expectedVersion,
          fromStatuses: ['SUBMITTED'],
          toStatus,
          reviewerUserId,
          reason,
          now,
        });
        if (changed === undefined) throw stale();
        await this.recordTenantChange(transaction, context, {
          eventType,
          aggregateType: 'driverApplication',
          aggregateId: changed.id,
          aggregateVersion: changed.version,
          streamType: 'driverApplication',
          streamId: changed.id,
          occurredAt: now,
          data: { status: changed.status },
          action: 'workforce.driver-application.review',
          reason,
          facilityId: changed.facilityId,
        });
        return driverApplicationJson(changed);
      },
    );
  }

  private changeDriverState(
    context: RequestContext,
    key: string,
    driverId: string,
    expectedVersion: number,
    reason: string,
    change: {
      readonly operation: string;
      readonly eventType: string;
      readonly field: string;
      readonly value: string;
      readonly apply: (
        transaction: TransactionContext,
        now: Date,
      ) => Promise<DriverRecord | undefined>;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `${change.operation}:${driverId}`,
        request: { driverId, expectedVersion, status: change.value, reason },
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const driver = await change.apply(transaction, now);
        if (driver === undefined) throw stale();
        await this.recordTenantChange(transaction, context, {
          eventType: change.eventType,
          aggregateType: 'driver',
          aggregateId: driver.id,
          aggregateVersion: driver.version,
          streamType: 'driver',
          streamId: driver.id,
          occurredAt: now,
          data: { [change.field]: change.value },
          action: change.operation,
          reason,
        });
        return driverJson(driver);
      },
    );
  }

  private async recordEvent(
    transaction: TransactionContext,
    context: RequestContext,
    event: Omit<Parameters<DeliveryWriter['appendEvent']>[2], 'eventId' | 'producer'>,
  ): Promise<void> {
    await this.delivery.appendEvent(transaction, context, {
      ...event,
      eventId: this.ids.generate(),
      producer: 'workforce-fleet',
    });
  }

  private async recordTenantChange(
    transaction: TransactionContext,
    context: RequestContext,
    evidence: Omit<
      Parameters<DeliveryWriter['appendEvent']>[2],
      'eventId' | 'producer' | 'tenantId'
    > & {
      readonly action: string;
      readonly reason: string;
      readonly tenantId?: string;
    },
  ): Promise<void> {
    const tenantId = evidence.tenantId ?? this.requireTenant(context);
    const { action, reason, ...event } = evidence;
    await this.recordEvent(transaction, context, { ...event, tenantId });
    await this.audit.append(transaction, {
      id: this.ids.generate(),
      occurredAt: evidence.occurredAt,
      tenantId,
      actorType: context.actor?.type ?? 'SYSTEM_POLICY',
      ...(context.actor === undefined ? {} : { actorId: context.actor.id }),
      ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      ...(context.scope.authorityGrantId === undefined
        ? {}
        : { authorityGrantId: context.scope.authorityGrantId }),
      ...(context.authentication === undefined
        ? {}
        : { authenticationAssurance: context.authentication.assurance }),
      action,
      resourceType: evidence.aggregateType,
      resourceId: evidence.aggregateId,
      outcome: 'ALLOWED',
      reasonCode: `${action.toUpperCase()}.ALLOWED`,
      correlationId: context.correlationId,
      source: context.source,
      safeContext: { reason },
      retentionClass: 'OPERATIONS',
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

  private requireTenant(context: RequestContext): string {
    const tenantId = context.scope.tenantId;
    if (tenantId === undefined) {
      throw new ApplicationError({
        code: 'ACCESS.PERMISSION_DENIED',
        message: 'This action is not permitted.',
        status: 403,
      });
    }
    return tenantId;
  }

  private requireAuthority(context: RequestContext): string {
    if (context.scope.authorityGrantId === undefined || context.scope.authority === undefined) {
      throw new ApplicationError({
        code: 'ACCESS.PERMISSION_DENIED',
        message: 'This action is not permitted.',
        status: 403,
      });
    }
    return context.scope.authorityGrantId;
  }

  private requireTenantOrAuthority(context: RequestContext): void {
    if (context.scope.tenantId === undefined && context.scope.authorityGrantId === undefined) {
      this.requireTenant(context);
    }
  }

  private requireFacility(context: RequestContext, facilityId: string): void {
    if (
      context.scope.accessScopeType === 'FACILITY_SET' &&
      !context.scope.facilityIds.includes(facilityId)
    ) {
      throw new ApplicationError({
        code: 'ACCESS.PERMISSION_DENIED',
        message: 'This action is not permitted.',
        status: 403,
      });
    }
  }
}
