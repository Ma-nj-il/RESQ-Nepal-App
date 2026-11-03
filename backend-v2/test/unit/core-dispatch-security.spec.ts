import { jest } from '@jest/globals';

import { BookingDispatchService } from '../../src/core-dispatch/application/booking-dispatch.service.js';
import { CoreDispatchJobProcessor } from '../../src/core-dispatch/application/core-dispatch-job.processor.js';
import type { CoreDispatchPolicy } from '../../src/core-dispatch/application/core-dispatch.policy.js';
import type {
  AssignmentRecord,
  BookingRecord,
  CoreDispatchRepository,
  SafetyIncidentRecord,
  TripRecord,
} from '../../src/core-dispatch/application/ports/core-dispatch.repository.js';
import type { PatientDataProtector } from '../../src/core-dispatch/application/ports/patient-data-protector.js';
import type { RoutingProvider } from '../../src/core-dispatch/application/ports/routing-provider.js';
import type { SafetyAlertDelivery } from '../../src/core-dispatch/application/ports/safety-alert-delivery.js';
import { UnavailableSafetyAlertDelivery } from '../../src/core-dispatch/infrastructure/providers/unavailable-safety-alert.delivery.js';
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
const REQUESTER_ID = '018f0000-0000-7000-8000-000000000002';
const TENANT_ID = '018f0000-0000-7000-8000-000000000003';
const FACILITY_ID = '018f0000-0000-7000-8000-000000000004';
const BOOKING_ID = '018f0000-0000-7000-8000-000000000005';
const TRIP_ID = '018f0000-0000-7000-8000-000000000006';
const INCIDENT_ID = '018f0000-0000-7000-8000-000000000007';
const ASSIGNMENT_ID = '018f0000-0000-7000-8000-000000000009';
const TRANSACTION: TransactionContext = { transactionId: 'test-transaction' };

const POLICY: CoreDispatchPolicy = Object.freeze({
  quoteTtlMs: 300_000,
  searchTtlMs: 300_000,
  offerTtlMs: 60_000,
  trackingStaleAfterMs: 30_000,
  trackingUnavailableAfterMs: 120_000,
  firstSafetyEscalationDelayMs: 30_000,
  subsequentSafetyEscalationDelayMs: 60_000,
});

function tenantContext(): RequestContext {
  return new RequestContext({
    requestId: 'request-id',
    correlationId: 'correlation-id',
    source: 'HTTP',
    actor: { type: 'USER', id: ACTOR_ID },
    authentication: {
      assurance: 'AAL1',
      tokenVersion: 1,
      permissionCodes: ['trip.cancel', 'tracking.publish'],
    },
    scope: {
      tenantId: TENANT_ID,
      facilityIds: [FACILITY_ID],
      accessScopeType: 'FACILITY_SET',
    },
  });
}

function booking(status: BookingRecord['status'], version: number): BookingRecord {
  return {
    id: BOOKING_ID,
    bookingReference: 'RESQ-BOOKING',
    requesterUserId: REQUESTER_ID,
    pickupGeographicUnitId: '018f0000-0000-7000-8000-000000000008',
    serviceCategory: 'AMBULANCE',
    urgency: 'EMERGENCY',
    paymentMethod: 'CASH',
    pickupLatitude: 27.7172,
    pickupLongitude: 85.324,
    destinationLatitude: 27.672,
    destinationLongitude: 85.4298,
    consentFlags: { emergencyTransport: true, locationSharing: true },
    status,
    version,
    searchDeadline: new Date(NOW.getTime() + 60_000),
    ...(status === 'CANCELLED' ? { cancelledAt: NOW } : {}),
    createdAt: new Date(NOW.getTime() - 60_000),
    updatedAt: NOW,
  };
}

function trip(status: TripRecord['status'], version: number): TripRecord {
  return {
    id: TRIP_ID,
    assignmentId: ASSIGNMENT_ID,
    bookingId: BOOKING_ID,
    requesterUserId: REQUESTER_ID,
    tenantId: TENANT_ID,
    facilityId: FACILITY_ID,
    driverId: '018f0000-0000-7000-8000-000000000010',
    ambulanceId: '018f0000-0000-7000-8000-000000000011',
    status,
    version,
    ...(status === 'CANCELLED' ? { cancelledAt: NOW } : {}),
    createdAt: new Date(NOW.getTime() - 60_000),
    updatedAt: NOW,
  };
}

function releasedAssignment(): AssignmentRecord {
  return {
    id: ASSIGNMENT_ID,
    bookingId: BOOKING_ID,
    offerId: '018f0000-0000-7000-8000-000000000014',
    tenantId: TENANT_ID,
    facilityId: FACILITY_ID,
    driverId: '018f0000-0000-7000-8000-000000000010',
    ambulanceId: '018f0000-0000-7000-8000-000000000011',
    dispatcherUserId: ACTOR_ID,
    acceptedAt: new Date(NOW.getTime() - 60_000),
    releasedAt: NOW,
    releaseReasonCode: 'TRIP_CANCELLED',
    version: 2,
  };
}

function incident(overrides: Partial<SafetyIncidentRecord> = {}): SafetyIncidentRecord {
  return {
    id: INCIDENT_ID,
    creatorUserId: REQUESTER_ID,
    tripId: TRIP_ID,
    bookingId: BOOKING_ID,
    tenantId: TENANT_ID,
    facilityId: FACILITY_ID,
    incidentType: 'SOS',
    severity: 'CRITICAL',
    status: 'OPEN',
    escalationTier: 2,
    version: 3,
    createdAt: new Date(NOW.getTime() - 60_000),
    updatedAt: NOW,
    ...overrides,
  };
}

function support(): {
  unitOfWork: UnitOfWork;
  idempotency: IdempotencyExecutor;
  audit: jest.Mocked<AuditWriter>;
  delivery: jest.Mocked<DeliveryWriter>;
  clock: Clock;
  ids: IdGenerator;
} {
  const unitOfWork: UnitOfWork = { execute: (_context, work) => work(TRANSACTION) };
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

describe('core dispatch actor and safety invariants', () => {
  it('uses the server-resolved crew class for cancellation policy and evidence', async () => {
    const resolveCancellationActorClass = jest.fn<
      CoreDispatchRepository['resolveCancellationActorClass']
    >(() => Promise.resolve('CREW'));
    const findBooking = jest
      .fn<CoreDispatchRepository['findBooking']>()
      .mockResolvedValueOnce(booking('ACTIVE', 4))
      .mockResolvedValueOnce(booking('CANCELLED', 5));
    const findTripByBooking = jest
      .fn<CoreDispatchRepository['findTripByBooking']>()
      .mockResolvedValueOnce(trip('ARRIVED_AT_PICKUP', 3))
      .mockResolvedValueOnce(trip('CANCELLED', 4));
    const cancelBooking = jest.fn<CoreDispatchRepository['cancelBooking']>(() =>
      Promise.resolve('CANCELLED'),
    );
    const findAssignmentByBooking = jest.fn<CoreDispatchRepository['findAssignmentByBooking']>(() =>
      Promise.resolve(releasedAssignment()),
    );
    const repository = {
      resolveCancellationActorClass,
      findBooking,
      findTripByBooking,
      findAssignmentByBooking,
      cancelBooking,
    } as unknown as CoreDispatchRepository;
    const dependencies = support();
    const service = new BookingDispatchService(
      repository,
      {} as RoutingProvider,
      {} as PatientDataProtector,
      POLICY,
      dependencies.idempotency,
      dependencies.unitOfWork,
      dependencies.audit,
      dependencies.delivery,
      dependencies.clock,
      dependencies.ids,
    );

    await service.cancelBooking(tenantContext(), 'cancellation-key-0001', BOOKING_ID, 4, {
      reasonCode: 'CREW_REQUEST',
      reason: 'Vehicle cannot continue safely',
    });

    expect(resolveCancellationActorClass).toHaveBeenCalledWith(TRANSACTION, ACTOR_ID);
    expect(cancelBooking).toHaveBeenCalledWith(
      TRANSACTION,
      expect.objectContaining({ actorClass: 'CREW', feeMinor: 0n, feeCurrency: 'NPR' }),
    );
    expect(dependencies.audit.append.mock.calls[0]).toEqual([
      TRANSACTION,
      expect.objectContaining({ safeContext: { actorClass: 'CREW' } }),
    ]);
    expect(dependencies.delivery.appendEvent.mock.calls).toContainEqual([
      TRANSACTION,
      expect.any(RequestContext),
      expect.objectContaining({
        eventType: 'dispatch.assignment.released.v1',
        aggregateType: 'assignment',
        aggregateId: ASSIGNMENT_ID,
        aggregateVersion: 2,
        streamType: 'bookingDispatch',
        streamId: BOOKING_ID,
        tenantId: TENANT_ID,
        facilityId: FACILITY_ID,
        data: { reasonCode: 'TRIP_CANCELLED' },
      }),
    ]);
  });

  it('does not reveal a booking when actor classification cannot be resolved', async () => {
    const findBooking = jest.fn<CoreDispatchRepository['findBooking']>();
    const repository = {
      resolveCancellationActorClass: jest.fn(() => Promise.resolve(undefined)),
      findBooking,
    } as unknown as CoreDispatchRepository;
    const dependencies = support();
    const service = new BookingDispatchService(
      repository,
      {} as RoutingProvider,
      {} as PatientDataProtector,
      POLICY,
      dependencies.idempotency,
      dependencies.unitOfWork,
      dependencies.audit,
      dependencies.delivery,
      dependencies.clock,
      dependencies.ids,
    );

    await expect(
      service.cancelBooking(tenantContext(), 'cancellation-key-0002', BOOKING_ID, 4, {
        reasonCode: 'CREW_REQUEST',
        reason: 'Vehicle cannot continue safely',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE.NOT_FOUND', status: 404 });
    expect(findBooking).not.toHaveBeenCalled();
  });

  it('re-reads incident state and suppresses stale alert jobs', async () => {
    const repository = {
      findIncident: jest.fn(() => Promise.resolve(incident({ status: 'RESOLVED', version: 4 }))),
    } as unknown as CoreDispatchRepository;
    const alertDelivery = {
      deliver: jest.fn<SafetyAlertDelivery['deliver']>(),
    };
    const dependencies = support();
    const processor = new CoreDispatchJobProcessor(
      repository,
      alertDelivery,
      POLICY,
      dependencies.unitOfWork,
      dependencies.audit,
      dependencies.delivery,
      dependencies.clock,
      dependencies.ids,
    );

    await expect(
      processor.process({
        jobIntentId: '018f0000-0000-7000-8000-000000000012',
        jobType: 'safety.deliver-alert.v1',
        tenantId: TENANT_ID,
        resourceType: 'safetyIncident',
        resourceId: INCIDENT_ID,
        resourceVersion: 3,
        runAt: NOW.toISOString(),
        correlationId: 'correlation-id',
        causationId: 'causation-id',
        data: { severity: 'CRITICAL', escalationTier: 2 },
      }),
    ).resolves.toEqual({ code: 'NO_OP_CURRENT_STATE' });
    expect(alertDelivery.deliver).not.toHaveBeenCalled();
  });

  it('delivers only an alert envelope that still matches current incident state', async () => {
    const repository = {
      findIncident: jest.fn(() => Promise.resolve(incident())),
    } as unknown as CoreDispatchRepository;
    const alertDelivery = {
      deliver: jest.fn<SafetyAlertDelivery['deliver']>(),
    };
    const dependencies = support();
    const processor = new CoreDispatchJobProcessor(
      repository,
      alertDelivery,
      POLICY,
      dependencies.unitOfWork,
      dependencies.audit,
      dependencies.delivery,
      dependencies.clock,
      dependencies.ids,
    );
    const jobIntentId = '018f0000-0000-7000-8000-000000000013';

    await expect(
      processor.process({
        jobIntentId,
        jobType: 'safety.deliver-alert.v1',
        tenantId: TENANT_ID,
        resourceType: 'safetyIncident',
        resourceId: INCIDENT_ID,
        resourceVersion: 3,
        runAt: NOW.toISOString(),
        correlationId: 'correlation-id',
        causationId: 'causation-id',
        data: { severity: 'CRITICAL', escalationTier: 2 },
      }),
    ).resolves.toEqual({ code: 'ALERT_DELIVERED' });
    expect(alertDelivery.deliver).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      tenantId: TENANT_ID,
      severity: 'CRITICAL',
      escalationTier: 2,
      jobIntentId,
    });
  });

  it('keeps safety delivery fail-closed without an approved provider', async () => {
    await expect(new UnavailableSafetyAlertDelivery().deliver()).rejects.toMatchObject({
      code: 'SAFETY.ALERT_PROVIDER_UNAVAILABLE',
      status: 503,
      retryable: true,
    });
  });
});
