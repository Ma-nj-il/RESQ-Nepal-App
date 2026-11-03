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
import { fareAmountMinor } from '../domain/core-dispatch.js';
import { auditEvidence } from './core-dispatch-evidence.js';
import {
  authenticationRequired,
  dispatchResultError,
  resourceNotFound,
} from './core-dispatch-errors.js';
import {
  assignmentJson,
  bookingJson,
  fareQuoteJson,
  offerJson,
  timelineJson,
} from './core-dispatch-json.js';
import type { CoreDispatchPolicy } from './core-dispatch.policy.js';
import type {
  AssignmentRecord,
  BookingRecord,
  CoreDispatchRepository,
  CoverageAreaRecord,
  DispatchOfferRecord,
  FareQuoteRecord,
  TimelineRecord,
} from './ports/core-dispatch.repository.js';
import type { PatientDataProtector } from './ports/patient-data-protector.js';
import type { Coordinate, RoutingProvider } from './ports/routing-provider.js';

export interface FareQuoteInput {
  readonly serviceCategory: string;
  readonly pickup: Coordinate;
  readonly destination: Coordinate;
}

export interface BookingCreationInput extends FareQuoteInput {
  readonly fareQuoteId: string;
  readonly pickupGeographicUnitId: string;
  readonly destinationGeographicUnitId?: string;
  readonly urgency: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  readonly patient: Readonly<Record<string, JsonValue>>;
  readonly consentFlags: Readonly<Record<string, boolean>>;
}

export interface OfferAcceptanceInput {
  readonly driverId: string;
  readonly ambulanceId: string;
}

export interface CancellationInput {
  readonly reasonCode: string;
  readonly reason: string;
}

export interface TenantDispatchOfferDetail {
  readonly offer: DispatchOfferRecord;
  readonly booking: BookingRecord;
}

const FARE_POLICY_VERSION = 'FARE_NPR_V1';
const CANCELLATION_POLICY_VERSION = 'CANCELLATION_V1';

export class BookingDispatchService {
  constructor(
    private readonly repository: CoreDispatchRepository,
    private readonly routing: RoutingProvider,
    private readonly patientData: PatientDataProtector,
    private readonly policy: CoreDispatchPolicy,
    private readonly idempotency: IdempotencyExecutor,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly delivery: DeliveryWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async coverage(
    context: RequestContext,
    serviceCategory: string,
    pickup: Coordinate,
  ): Promise<readonly CoverageAreaRecord[]> {
    this.requireUser(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.findCoverage(transaction, serviceCategory, pickup.latitude, pickup.longitude),
    );
  }

  async createFareQuote(context: RequestContext, input: FareQuoteInput): Promise<FareQuoteRecord> {
    const requesterUserId = this.requireUser(context);
    const coverage = await this.coverage(context, input.serviceCategory, input.pickup);
    if (coverage.length === 0) throw this.outsideCoverage();
    const route = await this.routing.estimate(input.pickup, input.destination);
    const selected = this.lowestFareCoverage(coverage, route.distanceMeters);
    const createdAt = this.clock.now();
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.createFareQuote(transaction, {
        id: this.ids.generate(),
        requesterUserId,
        coverageAreaId: selected.id,
        serviceCategory: input.serviceCategory,
        pickupLatitude: input.pickup.latitude,
        pickupLongitude: input.pickup.longitude,
        destinationLatitude: input.destination.latitude,
        destinationLongitude: input.destination.longitude,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        amountMinor: fareAmountMinor(
          selected.baseFareMinor,
          selected.perKilometerFareMinor,
          route.distanceMeters,
        ),
        currency: selected.currency,
        routeSource: route.source,
        routeQuality: route.quality,
        policyVersion: FARE_POLICY_VERSION,
        expiresAt: new Date(createdAt.getTime() + this.policy.quoteTtlMs),
        createdAt,
      }),
    );
  }

  createBooking(
    context: RequestContext,
    key: string,
    input: BookingCreationInput,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireUser(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: 'dispatch.booking.create',
        request: {
          fareQuoteId: input.fareQuoteId,
          serviceCategory: input.serviceCategory,
          pickupGeographicUnitId: input.pickupGeographicUnitId,
          ...(input.destinationGeographicUnitId === undefined
            ? {}
            : { destinationGeographicUnitId: input.destinationGeographicUnitId }),
          urgency: input.urgency,
          pickup: {
            latitude: input.pickup.latitude,
            longitude: input.pickup.longitude,
          },
          destination: {
            latitude: input.destination.latitude,
            longitude: input.destination.longitude,
          },
          patient: { ...input.patient },
          consentFlags: { ...input.consentFlags },
        },
        successStatus: 201,
      },
      (transaction) => this.createAndStartSearch(transaction, context, input),
    );
  }

  listBookings(context: RequestContext, afterId?: string): Promise<readonly BookingRecord[]> {
    this.requireUser(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listBookings(transaction, afterId),
    );
  }

  async booking(context: RequestContext, bookingId: string): Promise<BookingRecord> {
    this.requireUser(context);
    const booking = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findBooking(transaction, bookingId),
    );
    if (booking === undefined) throw resourceNotFound();
    return booking;
  }

  async timeline(context: RequestContext, bookingId: string): Promise<readonly TimelineRecord[]> {
    await this.booking(context, bookingId);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listBookingTimeline(transaction, bookingId),
    );
  }

  async assignment(context: RequestContext, bookingId: string): Promise<AssignmentRecord> {
    await this.booking(context, bookingId);
    const assignment = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findAssignmentByBooking(transaction, bookingId),
    );
    if (assignment === undefined) throw resourceNotFound();
    return assignment;
  }

  listOffers(context: RequestContext): Promise<readonly DispatchOfferRecord[]> {
    this.requireTenant(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listOffers(transaction),
    );
  }

  async listOfferDetails(context: RequestContext): Promise<readonly TenantDispatchOfferDetail[]> {
    this.requireTenant(context);
    return this.unitOfWork.execute(context, async (transaction) => {
      const offers = await this.repository.listOffers(transaction);
      const details: TenantDispatchOfferDetail[] = [];
      for (const offer of offers) {
        const booking = await this.repository.findBooking(transaction, offer.bookingId);
        if (booking !== undefined) details.push({ offer, booking });
      }
      return details;
    });
  }

  async offer(context: RequestContext, offerId: string): Promise<DispatchOfferRecord> {
    this.requireTenant(context);
    const offer = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findOffer(transaction, offerId),
    );
    if (offer === undefined) throw resourceNotFound();
    return offer;
  }

  async offerDetail(context: RequestContext, offerId: string): Promise<TenantDispatchOfferDetail> {
    this.requireTenant(context);
    const detail = await this.unitOfWork.execute(context, async (transaction) => {
      const offer = await this.repository.findOffer(transaction, offerId);
      if (offer === undefined) return undefined;
      const booking = await this.repository.findBooking(transaction, offer.bookingId);
      return booking === undefined ? undefined : { offer, booking };
    });
    if (detail === undefined) throw resourceNotFound();
    return detail;
  }

  acceptOffer(
    context: RequestContext,
    key: string,
    offerId: string,
    expectedVersion: number,
    input: OfferAcceptanceInput,
  ): Promise<IdempotentResult<JsonValue>> {
    const dispatcherUserId = this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `dispatch.offer.accept:${offerId}`,
        request: { offerId, expectedVersion, ...input },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findOffer(transaction, offerId);
        if (current === undefined) throw resourceNotFound();
        const commandId = context.requestId;
        const result = await this.repository.acceptOffer(transaction, {
          offerId,
          expectedVersion,
          assignmentId: this.ids.generate(),
          tripId: this.ids.generate(),
          offerTransitionId: this.ids.generate(),
          activeTransitionId: this.ids.generate(),
          tripTransitionId: this.ids.generate(),
          driverId: input.driverId,
          ambulanceId: input.ambulanceId,
          dispatcherUserId,
          commandId,
        });
        if (result !== 'ACCEPTED') throw dispatchResultError(result);

        const assignment = await this.repository.findAssignmentByBooking(
          transaction,
          current.bookingId,
        );
        const offers = await this.repository.findAcceptedOfferOutcomes(
          transaction,
          offerId,
          dispatcherUserId,
        );
        const trip = await this.repository.findTripByBooking(transaction, current.bookingId);
        if (assignment === undefined || trip === undefined) {
          throw new Error('Accepted dispatch did not return its assignment and trip');
        }
        const now = assignment.acceptedAt;
        for (const resolved of offers.filter((offer) =>
          ['ACCEPTED', 'SUPERSEDED'].includes(offer.status),
        )) {
          await this.delivery.appendEvent(transaction, context, {
            eventId: this.ids.generate(),
            eventType:
              resolved.status === 'ACCEPTED'
                ? 'dispatch.offer.accepted.v1'
                : 'dispatch.offer.superseded.v1',
            producer: 'core-dispatch',
            aggregateType: 'dispatchOffer',
            aggregateId: resolved.id,
            aggregateVersion: resolved.version,
            streamType: 'bookingDispatch',
            streamId: resolved.bookingId,
            tenantId: resolved.tenantId,
            facilityId: resolved.facilityId,
            occurredAt: now,
            data: { status: resolved.status },
          });
        }
        await this.delivery.appendEvent(transaction, context, {
          eventId: this.ids.generate(),
          eventType: 'dispatch.assignment.created.v1',
          producer: 'core-dispatch',
          aggregateType: 'assignment',
          aggregateId: assignment.id,
          aggregateVersion: assignment.version,
          streamType: 'bookingDispatch',
          streamId: assignment.bookingId,
          tenantId: assignment.tenantId,
          facilityId: assignment.facilityId,
          occurredAt: now,
          data: { tripId: trip.id, driverId: trip.driverId, ambulanceId: trip.ambulanceId },
        });
        await this.audit.append(
          transaction,
          auditEvidence(context, {
            id: this.ids.generate(),
            occurredAt: now,
            tenantId: assignment.tenantId,
            action: 'dispatch.offer.accept',
            resourceType: 'dispatch_offer',
            resourceId: offerId,
            reasonCode: 'DISPATCH.OFFER_ACCEPTED',
            safeContext: { bookingId: assignment.bookingId, tripId: trip.id },
          }),
        );
        return {
          offer: offerJson(offers.find((offer) => offer.id === offerId) ?? current),
          assignment: assignmentJson(assignment),
          tripId: trip.id,
        };
      },
    );
  }

  declineOffer(
    context: RequestContext,
    key: string,
    offerId: string,
    expectedVersion: number,
    input: CancellationInput,
  ): Promise<IdempotentResult<JsonValue>> {
    const actorUserId = this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `dispatch.offer.decline:${offerId}`,
        request: { offerId, expectedVersion, ...input },
        successStatus: 200,
      },
      async (transaction) => {
        const offer = await this.repository.findOffer(transaction, offerId);
        if (offer === undefined) throw resourceNotFound();
        const result = await this.repository.resolveOffer(transaction, {
          offerId,
          expectedVersion,
          actorUserId,
          status: 'DECLINED',
          reasonCode: input.reasonCode,
          reason: input.reason,
        });
        if (result !== 'DECLINED') throw dispatchResultError(result);
        const changed = await this.repository.findOffer(transaction, offerId);
        if (changed === undefined) throw new Error('Declined dispatch offer disappeared');
        const occurredAt = changed.respondedAt ?? changed.updatedAt;
        await this.delivery.appendEvent(transaction, context, {
          eventId: this.ids.generate(),
          eventType: 'dispatch.offer.declined.v1',
          producer: 'core-dispatch',
          aggregateType: 'dispatchOffer',
          aggregateId: offerId,
          aggregateVersion: changed.version,
          streamType: 'bookingDispatch',
          streamId: offer.bookingId,
          tenantId: offer.tenantId,
          facilityId: offer.facilityId,
          occurredAt,
          data: { status: 'DECLINED', reasonCode: input.reasonCode },
        });
        await this.audit.append(
          transaction,
          auditEvidence(context, {
            id: this.ids.generate(),
            occurredAt,
            tenantId: offer.tenantId,
            action: 'dispatch.offer.decline',
            resourceType: 'dispatch_offer',
            resourceId: offerId,
            reasonCode: input.reasonCode,
          }),
        );
        return offerJson(changed);
      },
    );
  }

  cancelBooking(
    context: RequestContext,
    key: string,
    bookingId: string,
    expectedVersion: number,
    input: CancellationInput,
  ): Promise<IdempotentResult<JsonValue>> {
    const actorUserId = this.requireUser(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `dispatch.booking.cancel:${bookingId}`,
        request: { bookingId, expectedVersion, ...input },
        successStatus: 200,
      },
      async (transaction) => {
        const actorClass = await this.repository.resolveCancellationActorClass(
          transaction,
          actorUserId,
        );
        if (actorClass === undefined) throw resourceNotFound();
        const booking = await this.repository.findBooking(transaction, bookingId);
        if (booking === undefined) throw resourceNotFound();
        const tripBeforeCancellation = await this.repository.findTripByBooking(
          transaction,
          bookingId,
        );
        const result = await this.repository.cancelBooking(transaction, {
          bookingId,
          expectedVersion,
          cancellationId: this.ids.generate(),
          tripTransitionId: this.ids.generate(),
          bookingTransitionId: this.ids.generate(),
          actorUserId,
          actorClass,
          policyCode: 'NO_UNAPPROVED_CANCELLATION_FEE',
          policyVersion: CANCELLATION_POLICY_VERSION,
          reasonCode: input.reasonCode,
          reason: input.reason,
          feeMinor: 0n,
          feeCurrency: 'NPR',
          feeWaived: true,
          commandId: context.requestId,
        });
        if (result !== 'CANCELLED') throw dispatchResultError(result);
        const changed = await this.repository.findBooking(transaction, bookingId);
        if (changed === undefined) throw new Error('Cancelled booking disappeared');
        const trip = await this.repository.findTripByBooking(transaction, bookingId);
        const assignment =
          trip === undefined
            ? undefined
            : await this.repository.findAssignmentByBooking(transaction, bookingId);
        const releasedAssignment =
          assignment?.releasedAt !== undefined && assignment.releaseReasonCode === 'TRIP_CANCELLED'
            ? {
                record: assignment,
                releasedAt: assignment.releasedAt,
                reasonCode: assignment.releaseReasonCode,
              }
            : undefined;
        if (trip !== undefined && releasedAssignment === undefined) {
          throw new Error('Cancelled trip did not release its assignment');
        }
        const occurredAt = changed.cancelledAt ?? changed.updatedAt;
        await this.delivery.appendEvent(transaction, context, {
          eventId: this.ids.generate(),
          eventType: 'booking.cancelled.v1',
          producer: 'core-dispatch',
          aggregateType: 'booking',
          aggregateId: bookingId,
          aggregateVersion: changed.version,
          streamType: 'bookingDispatch',
          streamId: bookingId,
          ...(trip === undefined
            ? tripBeforeCancellation === undefined
              ? {}
              : {
                  tenantId: tripBeforeCancellation.tenantId,
                  facilityId: tripBeforeCancellation.facilityId,
                }
            : { tenantId: trip.tenantId, facilityId: trip.facilityId }),
          occurredAt,
          data: { status: 'CANCELLED', reasonCode: input.reasonCode },
        });
        if (trip !== undefined && releasedAssignment !== undefined) {
          await this.delivery.appendEvent(transaction, context, {
            eventId: this.ids.generate(),
            eventType: 'trip.cancelled.v1',
            producer: 'core-dispatch',
            aggregateType: 'trip',
            aggregateId: trip.id,
            aggregateVersion: trip.version,
            streamType: 'trip',
            streamId: trip.id,
            tenantId: trip.tenantId,
            facilityId: trip.facilityId,
            occurredAt: trip.cancelledAt ?? trip.updatedAt,
            data: { bookingId, status: 'CANCELLED', reasonCode: input.reasonCode },
          });
          await this.delivery.appendEvent(transaction, context, {
            eventId: this.ids.generate(),
            eventType: 'dispatch.assignment.released.v1',
            producer: 'core-dispatch',
            aggregateType: 'assignment',
            aggregateId: releasedAssignment.record.id,
            aggregateVersion: releasedAssignment.record.version,
            streamType: 'bookingDispatch',
            streamId: releasedAssignment.record.bookingId,
            tenantId: releasedAssignment.record.tenantId,
            facilityId: releasedAssignment.record.facilityId,
            occurredAt: releasedAssignment.releasedAt,
            data: { reasonCode: releasedAssignment.reasonCode },
          });
        }
        await this.audit.append(
          transaction,
          auditEvidence(context, {
            id: this.ids.generate(),
            occurredAt,
            ...(trip === undefined
              ? tripBeforeCancellation === undefined
                ? {}
                : { tenantId: tripBeforeCancellation.tenantId }
              : { tenantId: trip.tenantId }),
            action: 'dispatch.booking.cancel',
            resourceType: 'booking',
            resourceId: bookingId,
            reasonCode: input.reasonCode,
            safeContext: { actorClass },
          }),
        );
        return bookingJson(changed);
      },
    );
  }

  private async createAndStartSearch(
    transaction: TransactionContext,
    context: RequestContext,
    input: BookingCreationInput,
  ): Promise<JsonValue> {
    const coverage = await this.repository.findCoverage(
      transaction,
      input.serviceCategory,
      input.pickup.latitude,
      input.pickup.longitude,
    );
    if (coverage.length === 0) throw this.outsideCoverage();
    const now = this.clock.now();
    const bookingId = this.ids.generate();
    const searchDeadline = new Date(now.getTime() + this.policy.searchTtlMs);
    const offerExpiresAt = new Date(
      Math.min(searchDeadline.getTime(), now.getTime() + this.policy.offerTtlMs),
    );
    const protectedPatient = await this.patientData.protect(input.patient);
    const created = await this.repository.createBooking(transaction, {
      booking: {
        id: bookingId,
        bookingReference: this.bookingReference(bookingId),
        fareQuoteId: input.fareQuoteId,
        pickupGeographicUnitId: input.pickupGeographicUnitId,
        ...(input.destinationGeographicUnitId === undefined
          ? {}
          : { destinationGeographicUnitId: input.destinationGeographicUnitId }),
        serviceCategory: input.serviceCategory,
        urgency: input.urgency,
        paymentMethod: 'CASH',
        pickupLatitude: input.pickup.latitude,
        pickupLongitude: input.pickup.longitude,
        destinationLatitude: input.destination.latitude,
        destinationLongitude: input.destination.longitude,
        consentFlags: input.consentFlags,
        searchDeadline,
      },
      ...protectedPatient,
      transitionId: this.ids.generate(),
      commandId: context.requestId,
    });
    if (!created) {
      throw new ApplicationError({
        code: 'FARE_QUOTE.INVALID_OR_EXPIRED',
        message: 'The selected fare quote is invalid or expired.',
        status: 409,
      });
    }
    await this.delivery.appendEvent(transaction, context, {
      eventId: this.ids.generate(),
      eventType: 'booking.requested.v1',
      producer: 'core-dispatch',
      aggregateType: 'booking',
      aggregateId: bookingId,
      aggregateVersion: 1,
      streamType: 'bookingDispatch',
      streamId: bookingId,
      occurredAt: now,
      data: { status: 'REQUESTED', serviceCategory: input.serviceCategory, urgency: input.urgency },
    });

    const offerIds = coverage.map(() => this.ids.generate());
    const search = await this.repository.startBookingSearch(transaction, {
      bookingId,
      expectedVersion: 1,
      transitionId: this.ids.generate(),
      commandId: context.requestId,
      offerIds,
      coverageAreaIds: coverage.map((area) => area.id),
      offerExpiresAt,
    });
    if (search !== 'SEARCHING') throw dispatchResultError(search);
    await this.delivery.appendEvent(transaction, context, {
      eventId: this.ids.generate(),
      eventType: 'booking.search-started.v1',
      producer: 'core-dispatch',
      aggregateType: 'booking',
      aggregateId: bookingId,
      aggregateVersion: 2,
      streamType: 'bookingDispatch',
      streamId: bookingId,
      occurredAt: now,
      data: { status: 'SEARCHING', offerCount: offerIds.length },
    });
    for (const [index, offerId] of offerIds.entries()) {
      const area = coverage[index];
      if (area === undefined) throw new Error('Coverage and dispatch offer cardinality diverged');
      await this.delivery.appendEvent(transaction, context, {
        eventId: this.ids.generate(),
        eventType: 'dispatch.offer.created.v1',
        producer: 'core-dispatch',
        aggregateType: 'dispatchOffer',
        aggregateId: offerId,
        aggregateVersion: 1,
        streamType: 'bookingDispatch',
        streamId: bookingId,
        tenantId: area.tenantId,
        facilityId: area.facilityId,
        occurredAt: now,
        data: { status: 'PENDING', expiresAt: offerExpiresAt.toISOString() },
      });
      await this.delivery.scheduleJob(transaction, context, {
        id: this.ids.generate(),
        deterministicJobId: `dispatch-expire-offer-${offerId}-v1`,
        jobType: 'dispatch.expire-offer.v1',
        queueName: 'dispatch-critical',
        tenantId: area.tenantId,
        resourceType: 'dispatchOffer',
        resourceId: offerId,
        resourceVersion: 1,
        requestedAt: now,
        runAt: offerExpiresAt,
        data: { bookingId },
      });
    }
    await this.delivery.scheduleJob(transaction, context, {
      id: this.ids.generate(),
      deterministicJobId: `dispatch-finish-search-${bookingId}-v2`,
      jobType: 'dispatch.finish-search.v1',
      queueName: 'dispatch-critical',
      resourceType: 'booking',
      resourceId: bookingId,
      resourceVersion: 2,
      requestedAt: now,
      runAt: searchDeadline,
    });
    await this.audit.append(
      transaction,
      auditEvidence(context, {
        id: this.ids.generate(),
        occurredAt: now,
        action: 'dispatch.booking.create',
        resourceType: 'booking',
        resourceId: bookingId,
        reasonCode: 'BOOKING.REQUESTED',
        safeContext: { serviceCategory: input.serviceCategory, urgency: input.urgency },
      }),
    );
    const booking = await this.repository.findBooking(transaction, bookingId);
    if (booking === undefined) throw new Error('Created booking could not be read');
    return bookingJson(booking);
  }

  private lowestFareCoverage(
    coverage: readonly CoverageAreaRecord[],
    distanceMeters: number,
  ): CoverageAreaRecord {
    const sorted = [...coverage].sort((left, right) => {
      const leftFare = fareAmountMinor(
        left.baseFareMinor,
        left.perKilometerFareMinor,
        distanceMeters,
      );
      const rightFare = fareAmountMinor(
        right.baseFareMinor,
        right.perKilometerFareMinor,
        distanceMeters,
      );
      if (leftFare !== rightFare) return leftFare < rightFare ? -1 : 1;
      if (left.distanceToCenterMeters !== right.distanceToCenterMeters) {
        return left.distanceToCenterMeters - right.distanceToCenterMeters;
      }
      return left.id.localeCompare(right.id);
    });
    const selected = sorted[0];
    if (selected === undefined) throw this.outsideCoverage();
    return selected;
  }

  private bookingReference(bookingId: string): string {
    return `RESQ-${bookingId.replaceAll('-', '').slice(-20).toUpperCase()}`;
  }

  private outsideCoverage(): ApplicationError {
    return new ApplicationError({
      code: 'DISPATCH.OUTSIDE_COVERAGE',
      message: 'No approved provider currently covers this service request.',
      status: 422,
    });
  }

  private requireUser(context: RequestContext): string {
    if (context.actor?.type !== 'USER') throw authenticationRequired();
    return context.actor.id;
  }

  private requireTenant(context: RequestContext): string {
    const actor = this.requireUser(context);
    if (context.scope.tenantId === undefined) throw resourceNotFound();
    return actor;
  }
}

export const bookingDispatchJson = Object.freeze({
  fareQuote: fareQuoteJson,
  booking: bookingJson,
  offer: offerJson,
  assignment: assignmentJson,
  timeline: timelineJson,
});
