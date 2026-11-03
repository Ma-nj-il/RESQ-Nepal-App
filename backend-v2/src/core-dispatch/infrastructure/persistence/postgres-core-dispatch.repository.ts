import { Injectable } from '@nestjs/common';

import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import { entityManagerFor } from '../../../shared/infrastructure/persistence/typeorm-unit-of-work.js';
import type {
  AssignmentRecord,
  BookingRecord,
  CoreDispatchRepository,
  CoverageAreaRecord,
  DispatchCommandResult,
  DispatchOfferRecord,
  FareQuoteRecord,
  SafetyIncidentRecord,
  TimelineRecord,
  TrackingStateRecord,
  TripRecord,
} from '../../application/ports/core-dispatch.repository.js';

interface CoverageRow {
  readonly coverage_area_id: string;
  readonly tenant_id: string;
  readonly facility_id: string;
  readonly service_category: string;
  readonly distance_to_center_meters: number;
  readonly radius_meters: number;
  readonly base_fare_minor: string;
  readonly per_kilometer_fare_minor: string;
  readonly currency: 'NPR';
  readonly version: number;
}

interface FareQuoteRow {
  readonly id: string;
  readonly requester_user_id: string;
  readonly coverage_area_id: string;
  readonly service_category: string;
  readonly pickup_latitude: string;
  readonly pickup_longitude: string;
  readonly destination_latitude: string;
  readonly destination_longitude: string;
  readonly distance_meters: number;
  readonly duration_seconds: number;
  readonly amount_minor: string;
  readonly currency: 'NPR';
  readonly route_source: string;
  readonly route_quality: FareQuoteRecord['routeQuality'];
  readonly policy_version: string;
  readonly version: number;
  readonly expires_at: Date;
  readonly created_at: Date;
}

interface BookingRow {
  readonly id: string;
  readonly booking_reference: string;
  readonly requester_user_id: string;
  readonly fare_quote_id: string | null;
  readonly pickup_geographic_unit_id: string;
  readonly destination_geographic_unit_id: string | null;
  readonly service_category: string;
  readonly urgency: BookingRecord['urgency'];
  readonly payment_method: 'CASH';
  readonly pickup_latitude: string;
  readonly pickup_longitude: string;
  readonly destination_latitude: string;
  readonly destination_longitude: string;
  readonly consent_flags: Readonly<Record<string, boolean>>;
  readonly status: BookingRecord['status'];
  readonly version: number;
  readonly search_deadline: Date;
  readonly completed_at: Date | null;
  readonly cancelled_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface OfferRow {
  readonly id: string;
  readonly booking_id: string;
  readonly tenant_id: string;
  readonly facility_id: string;
  readonly status: DispatchOfferRecord['status'];
  readonly version: number;
  readonly expires_at: Date;
  readonly responded_at: Date | null;
  readonly response_reason_code: string | null;
  readonly response_reason: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface AssignmentRow {
  readonly id: string;
  readonly booking_id: string;
  readonly offer_id: string;
  readonly tenant_id: string;
  readonly facility_id: string;
  readonly driver_id: string;
  readonly ambulance_id: string;
  readonly dispatcher_user_id: string;
  readonly accepted_at: Date;
  readonly released_at: Date | null;
  readonly release_reason_code: string | null;
  readonly version: number;
}

interface TripRow {
  readonly id: string;
  readonly assignment_id: string;
  readonly booking_id: string;
  readonly requester_user_id: string;
  readonly tenant_id: string;
  readonly facility_id: string;
  readonly driver_id: string;
  readonly ambulance_id: string;
  readonly status: TripRecord['status'];
  readonly version: number;
  readonly started_at: Date | null;
  readonly completed_at: Date | null;
  readonly cancelled_at: Date | null;
  readonly distance_meters: string | null;
  readonly final_fare_minor: string | null;
  readonly final_fare_currency: 'NPR' | null;
  readonly final_fare_provenance: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface TrackingRow {
  readonly trip_id: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly accuracy_meters: string;
  readonly heading_degrees: string | null;
  readonly speed_meters_per_second: string | null;
  readonly quality: TrackingStateRecord['quality'];
  readonly sequence: string;
  readonly captured_at: Date;
  readonly received_at: Date;
  readonly version: number;
}

interface IncidentRow {
  readonly id: string;
  readonly creator_user_id: string;
  readonly trip_id: string | null;
  readonly booking_id: string | null;
  readonly tenant_id: string | null;
  readonly facility_id: string | null;
  readonly incident_type: SafetyIncidentRecord['incidentType'];
  readonly severity: SafetyIncidentRecord['severity'];
  readonly status: SafetyIncidentRecord['status'];
  readonly escalation_tier: number;
  readonly version: number;
  readonly acknowledged_by_user_id: string | null;
  readonly acknowledged_at: Date | null;
  readonly resolved_by_user_id: string | null;
  readonly resolved_at: Date | null;
  readonly resolution_code: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const BOOKING_SELECT = `
  SELECT id, booking_reference, requester_user_id, fare_quote_id,
         pickup_geographic_unit_id, destination_geographic_unit_id, service_category,
         urgency, payment_method, pickup_latitude, pickup_longitude,
         destination_latitude, destination_longitude, consent_flags, status, version,
         search_deadline, completed_at, cancelled_at, created_at, updated_at
    FROM dispatch.bookings`;

const OFFER_SELECT = `
  SELECT id, booking_id, tenant_id, facility_id, status, version, expires_at,
         responded_at, response_reason_code, response_reason, created_at, updated_at
    FROM dispatch.dispatch_offers`;

const ASSIGNMENT_SELECT = `
  SELECT id, booking_id, offer_id, tenant_id, facility_id, driver_id, ambulance_id,
         dispatcher_user_id, accepted_at, released_at, release_reason_code, version
    FROM dispatch.booking_assignments`;

const TRIP_SELECT = `
  SELECT id, assignment_id, booking_id, requester_user_id, tenant_id, facility_id,
         driver_id, ambulance_id, status, version, started_at, completed_at, cancelled_at,
         distance_meters, final_fare_minor, final_fare_currency, final_fare_provenance,
         created_at, updated_at
    FROM dispatch.trips`;

const INCIDENT_SELECT = `
  SELECT id, creator_user_id, trip_id, booking_id, tenant_id, facility_id,
         incident_type, severity, status, escalation_tier, version,
         acknowledged_by_user_id, acknowledged_at, resolved_by_user_id, resolved_at,
         resolution_code, created_at, updated_at
    FROM safety.safety_incidents`;

function quoteFrom(row: FareQuoteRow): FareQuoteRecord {
  return {
    id: row.id,
    requesterUserId: row.requester_user_id,
    coverageAreaId: row.coverage_area_id,
    serviceCategory: row.service_category,
    pickupLatitude: Number(row.pickup_latitude),
    pickupLongitude: Number(row.pickup_longitude),
    destinationLatitude: Number(row.destination_latitude),
    destinationLongitude: Number(row.destination_longitude),
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency,
    routeSource: row.route_source,
    routeQuality: row.route_quality,
    policyVersion: row.policy_version,
    version: row.version,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function bookingFrom(row: BookingRow): BookingRecord {
  return {
    id: row.id,
    bookingReference: row.booking_reference,
    requesterUserId: row.requester_user_id,
    ...(row.fare_quote_id === null ? {} : { fareQuoteId: row.fare_quote_id }),
    pickupGeographicUnitId: row.pickup_geographic_unit_id,
    ...(row.destination_geographic_unit_id === null
      ? {}
      : { destinationGeographicUnitId: row.destination_geographic_unit_id }),
    serviceCategory: row.service_category,
    urgency: row.urgency,
    paymentMethod: row.payment_method,
    pickupLatitude: Number(row.pickup_latitude),
    pickupLongitude: Number(row.pickup_longitude),
    destinationLatitude: Number(row.destination_latitude),
    destinationLongitude: Number(row.destination_longitude),
    consentFlags: Object.freeze({ ...row.consent_flags }),
    status: row.status,
    version: row.version,
    searchDeadline: row.search_deadline,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.cancelled_at === null ? {} : { cancelledAt: row.cancelled_at }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function offerFrom(row: OfferRow): DispatchOfferRecord {
  return {
    id: row.id,
    bookingId: row.booking_id,
    tenantId: row.tenant_id,
    facilityId: row.facility_id,
    status: row.status,
    version: row.version,
    expiresAt: row.expires_at,
    ...(row.responded_at === null ? {} : { respondedAt: row.responded_at }),
    ...(row.response_reason_code === null ? {} : { responseReasonCode: row.response_reason_code }),
    ...(row.response_reason === null ? {} : { responseReason: row.response_reason }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assignmentFrom(row: AssignmentRow): AssignmentRecord {
  return {
    id: row.id,
    bookingId: row.booking_id,
    offerId: row.offer_id,
    tenantId: row.tenant_id,
    facilityId: row.facility_id,
    driverId: row.driver_id,
    ambulanceId: row.ambulance_id,
    dispatcherUserId: row.dispatcher_user_id,
    acceptedAt: row.accepted_at,
    ...(row.released_at === null ? {} : { releasedAt: row.released_at }),
    ...(row.release_reason_code === null ? {} : { releaseReasonCode: row.release_reason_code }),
    version: row.version,
  };
}

function tripFrom(row: TripRow): TripRecord {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    bookingId: row.booking_id,
    requesterUserId: row.requester_user_id,
    tenantId: row.tenant_id,
    facilityId: row.facility_id,
    driverId: row.driver_id,
    ambulanceId: row.ambulance_id,
    status: row.status,
    version: row.version,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.cancelled_at === null ? {} : { cancelledAt: row.cancelled_at }),
    ...(row.distance_meters === null ? {} : { distanceMeters: BigInt(row.distance_meters) }),
    ...(row.final_fare_minor === null ? {} : { finalFareMinor: BigInt(row.final_fare_minor) }),
    ...(row.final_fare_currency === null ? {} : { finalFareCurrency: row.final_fare_currency }),
    ...(row.final_fare_provenance === null
      ? {}
      : { finalFareProvenance: row.final_fare_provenance }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function incidentFrom(row: IncidentRow): SafetyIncidentRecord {
  return {
    id: row.id,
    creatorUserId: row.creator_user_id,
    ...(row.trip_id === null ? {} : { tripId: row.trip_id }),
    ...(row.booking_id === null ? {} : { bookingId: row.booking_id }),
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.facility_id === null ? {} : { facilityId: row.facility_id }),
    incidentType: row.incident_type,
    severity: row.severity,
    status: row.status,
    escalationTier: row.escalation_tier,
    version: row.version,
    ...(row.acknowledged_by_user_id === null
      ? {}
      : { acknowledgedByUserId: row.acknowledged_by_user_id }),
    ...(row.acknowledged_at === null ? {} : { acknowledgedAt: row.acknowledged_at }),
    ...(row.resolved_by_user_id === null ? {} : { resolvedByUserId: row.resolved_by_user_id }),
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
    ...(row.resolution_code === null ? {} : { resolutionCode: row.resolution_code }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function first<T>(rows: readonly T[], label: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`Database did not return ${label}`);
  return row;
}

@Injectable()
export class PostgresCoreDispatchRepository implements CoreDispatchRepository {
  async findCoverage(
    transaction: TransactionContext,
    serviceCategory: string,
    latitude: number,
    longitude: number,
  ): Promise<readonly CoverageAreaRecord[]> {
    const rows: CoverageRow[] = await entityManagerFor(transaction).query(
      'SELECT * FROM dispatch.find_service_coverage($1,$2,$3)',
      [serviceCategory, latitude, longitude],
    );
    return rows.map((row) => ({
      id: row.coverage_area_id,
      tenantId: row.tenant_id,
      facilityId: row.facility_id,
      serviceCategory: row.service_category,
      distanceToCenterMeters: row.distance_to_center_meters,
      radiusMeters: row.radius_meters,
      baseFareMinor: BigInt(row.base_fare_minor),
      perKilometerFareMinor: BigInt(row.per_kilometer_fare_minor),
      currency: row.currency,
      version: row.version,
    }));
  }

  async createFareQuote(
    transaction: TransactionContext,
    input: Omit<FareQuoteRecord, 'version'>,
  ): Promise<FareQuoteRecord> {
    const rows: FareQuoteRow[] = await entityManagerFor(transaction).query(
      `INSERT INTO dispatch.fare_quotes (
         id, requester_user_id, coverage_area_id, service_category,
         pickup_latitude, pickup_longitude, destination_latitude, destination_longitude,
         distance_meters, duration_seconds, amount_minor, currency, route_source,
         route_quality, policy_version, expires_at, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        input.id,
        input.requesterUserId,
        input.coverageAreaId,
        input.serviceCategory,
        input.pickupLatitude,
        input.pickupLongitude,
        input.destinationLatitude,
        input.destinationLongitude,
        input.distanceMeters,
        input.durationSeconds,
        input.amountMinor.toString(),
        input.currency,
        input.routeSource,
        input.routeQuality,
        input.policyVersion,
        input.expiresAt,
        input.createdAt,
      ],
    );
    return quoteFrom(first(rows, 'created fare quote'));
  }

  async createBooking(
    transaction: TransactionContext,
    input: Parameters<CoreDispatchRepository['createBooking']>[1],
  ): Promise<boolean> {
    const booking = input.booking;
    const rows: { created: boolean }[] = await entityManagerFor(transaction).query(
      `SELECT dispatch.create_booking(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
       ) AS created`,
      [
        booking.id,
        booking.bookingReference,
        booking.fareQuoteId ?? null,
        booking.pickupGeographicUnitId,
        booking.destinationGeographicUnitId ?? null,
        booking.serviceCategory,
        booking.urgency,
        booking.paymentMethod,
        booking.pickupLatitude,
        booking.pickupLongitude,
        booking.destinationLatitude,
        booking.destinationLongitude,
        input.ciphertext,
        input.nonce,
        input.tag,
        input.keyVersion,
        JSON.stringify(booking.consentFlags),
        input.transitionId,
        input.commandId,
        booking.searchDeadline,
      ],
    );
    return rows[0]?.created === true;
  }

  async startBookingSearch(
    transaction: TransactionContext,
    input: Parameters<CoreDispatchRepository['startBookingSearch']>[1],
  ): Promise<DispatchCommandResult> {
    const rows: { result: DispatchCommandResult }[] = await entityManagerFor(transaction).query(
      `SELECT dispatch.start_booking_search($1,$2,$3,$4,$5::uuid[],$6::uuid[],$7) AS result`,
      [
        input.bookingId,
        input.expectedVersion,
        input.transitionId,
        input.commandId,
        [...input.offerIds],
        [...input.coverageAreaIds],
        input.offerExpiresAt,
      ],
    );
    return first(rows, 'booking search result').result;
  }

  async listBookings(transaction: TransactionContext): Promise<readonly BookingRecord[]> {
    const rows: BookingRow[] = await entityManagerFor(transaction).query(
      `${BOOKING_SELECT} ORDER BY created_at DESC, id`,
    );
    return rows.map(bookingFrom);
  }

  async findBooking(
    transaction: TransactionContext,
    bookingId: string,
  ): Promise<BookingRecord | undefined> {
    const rows: BookingRow[] = await entityManagerFor(transaction).query(
      `${BOOKING_SELECT} WHERE id = $1`,
      [bookingId],
    );
    return rows[0] === undefined ? undefined : bookingFrom(rows[0]);
  }

  async listBookingTimeline(
    transaction: TransactionContext,
    bookingId: string,
  ): Promise<readonly TimelineRecord[]> {
    interface TimelineRow {
      readonly id: string;
      readonly aggregate_type: TimelineRecord['aggregateType'];
      readonly from_status: string | null;
      readonly to_status: string;
      readonly command: string;
      readonly reason_code: string;
      readonly reason: string | null;
      readonly aggregate_version: number;
      readonly occurred_at: Date;
    }
    const rows: TimelineRow[] = await entityManagerFor(transaction).query(
      `SELECT transition.id, 'BOOKING'::varchar AS aggregate_type,
              transition.from_status, transition.to_status,
              transition.reason_code AS command, transition.reason_code,
              transition.reason, transition.aggregate_version,
              transition.created_at AS occurred_at
         FROM dispatch.booking_transitions transition
        WHERE transition.booking_id = $1
       UNION ALL
       SELECT transition.id, 'TRIP'::varchar AS aggregate_type,
              transition.from_status, transition.to_status, transition.command,
              transition.reason_code, transition.reason, transition.aggregate_version,
              transition.occurred_at
         FROM dispatch.trip_transitions transition
         JOIN dispatch.trips trip ON trip.id = transition.trip_id
        WHERE trip.booking_id = $1
       ORDER BY occurred_at, aggregate_type, aggregate_version, id`,
      [bookingId],
    );
    return rows.map((row) => ({
      id: row.id,
      aggregateType: row.aggregate_type,
      ...(row.from_status === null ? {} : { fromStatus: row.from_status }),
      toStatus: row.to_status,
      command: row.command,
      reasonCode: row.reason_code,
      ...(row.reason === null ? {} : { reason: row.reason }),
      aggregateVersion: row.aggregate_version,
      occurredAt: row.occurred_at,
    }));
  }

  async findAssignmentByBooking(
    transaction: TransactionContext,
    bookingId: string,
  ): Promise<AssignmentRecord | undefined> {
    const rows: AssignmentRow[] = await entityManagerFor(transaction).query(
      `${ASSIGNMENT_SELECT} WHERE booking_id = $1`,
      [bookingId],
    );
    return rows[0] === undefined ? undefined : assignmentFrom(rows[0]);
  }

  async listOffers(transaction: TransactionContext): Promise<readonly DispatchOfferRecord[]> {
    const rows: OfferRow[] = await entityManagerFor(transaction).query(
      `${OFFER_SELECT} ORDER BY created_at DESC, id`,
    );
    return rows.map(offerFrom);
  }

  async findOffer(
    transaction: TransactionContext,
    offerId: string,
  ): Promise<DispatchOfferRecord | undefined> {
    const rows: OfferRow[] = await entityManagerFor(transaction).query(
      `${OFFER_SELECT} WHERE id = $1`,
      [offerId],
    );
    return rows[0] === undefined ? undefined : offerFrom(rows[0]);
  }

  async findOffersByBooking(
    transaction: TransactionContext,
    bookingId: string,
  ): Promise<readonly DispatchOfferRecord[]> {
    const rows: OfferRow[] = await entityManagerFor(transaction).query(
      `${OFFER_SELECT} WHERE booking_id = $1 ORDER BY created_at, id`,
      [bookingId],
    );
    return rows.map(offerFrom);
  }

  async findAcceptedOfferOutcomes(
    transaction: TransactionContext,
    acceptedOfferId: string,
    dispatcherUserId: string,
  ): Promise<readonly DispatchOfferRecord[]> {
    const rows: OfferRow[] = await entityManagerFor(transaction).query(
      'SELECT * FROM dispatch.accepted_offer_outcomes($1,$2)',
      [acceptedOfferId, dispatcherUserId],
    );
    return rows.map(offerFrom);
  }

  async acceptOffer(
    transaction: TransactionContext,
    input: Parameters<CoreDispatchRepository['acceptOffer']>[1],
  ): Promise<DispatchCommandResult> {
    const rows: { result: DispatchCommandResult }[] = await entityManagerFor(transaction).query(
      `SELECT dispatch.accept_offer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result`,
      [
        input.offerId,
        input.expectedVersion,
        input.assignmentId,
        input.tripId,
        input.offerTransitionId,
        input.activeTransitionId,
        input.tripTransitionId,
        input.driverId,
        input.ambulanceId,
        input.dispatcherUserId,
        input.commandId,
      ],
    );
    return first(rows, 'offer acceptance result').result;
  }

  async resolveOffer(
    transaction: TransactionContext,
    input: Parameters<CoreDispatchRepository['resolveOffer']>[1],
  ): Promise<DispatchCommandResult> {
    const rows: { result: DispatchCommandResult }[] = await entityManagerFor(transaction).query(
      'SELECT dispatch.resolve_offer($1,$2,$3,$4,$5,$6) AS result',
      [
        input.offerId,
        input.expectedVersion,
        input.actorUserId,
        input.status,
        input.reasonCode,
        input.reason ?? null,
      ],
    );
    return first(rows, 'offer resolution result').result;
  }

  async listTrips(transaction: TransactionContext): Promise<readonly TripRecord[]> {
    const rows: TripRow[] = await entityManagerFor(transaction).query(
      `${TRIP_SELECT} ORDER BY created_at DESC, id`,
    );
    return rows.map(tripFrom);
  }

  async findTrip(transaction: TransactionContext, tripId: string): Promise<TripRecord | undefined> {
    const rows: TripRow[] = await entityManagerFor(transaction).query(
      `${TRIP_SELECT} WHERE id = $1`,
      [tripId],
    );
    return rows[0] === undefined ? undefined : tripFrom(rows[0]);
  }

  async findTripByBooking(
    transaction: TransactionContext,
    bookingId: string,
  ): Promise<TripRecord | undefined> {
    const rows: TripRow[] = await entityManagerFor(transaction).query(
      `${TRIP_SELECT} WHERE booking_id = $1`,
      [bookingId],
    );
    return rows[0] === undefined ? undefined : tripFrom(rows[0]);
  }

  async transitionTrip(
    transaction: TransactionContext,
    input: Parameters<CoreDispatchRepository['transitionTrip']>[1],
  ): ReturnType<CoreDispatchRepository['transitionTrip']> {
    const rows: { result: Awaited<ReturnType<CoreDispatchRepository['transitionTrip']>> }[] =
      await entityManagerFor(transaction).query(
        `SELECT dispatch.transition_trip(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::char(3),$14
         ) AS result`,
        [
          input.tripId,
          input.expectedVersion,
          input.transitionId,
          input.actorUserId,
          input.command,
          input.commandId,
          input.reasonCode,
          input.reason ?? null,
          input.pickupOdometerMeters?.toString() ?? null,
          input.completionOdometerMeters?.toString() ?? null,
          input.distanceMeters?.toString() ?? null,
          input.finalFareMinor?.toString() ?? null,
          input.finalFareCurrency ?? null,
          input.finalFareProvenance ?? null,
        ],
      );
    return Promise.resolve(first(rows, 'trip transition result').result);
  }

  async cancelBooking(
    transaction: TransactionContext,
    input: Parameters<CoreDispatchRepository['cancelBooking']>[1],
  ): Promise<DispatchCommandResult> {
    const rows: { result: DispatchCommandResult }[] = await entityManagerFor(transaction).query(
      `SELECT dispatch.cancel_booking(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::char(3),$14,$15
       ) AS result`,
      [
        input.bookingId,
        input.expectedVersion,
        input.cancellationId,
        input.tripTransitionId,
        input.bookingTransitionId,
        input.actorUserId,
        input.actorClass,
        input.policyCode,
        input.policyVersion,
        input.reasonCode,
        input.reason,
        input.feeMinor.toString(),
        input.feeCurrency,
        input.feeWaived,
        input.commandId,
      ],
    );
    return first(rows, 'booking cancellation result').result;
  }

  async resolveCancellationActorClass(
    transaction: TransactionContext,
    actorUserId: string,
  ): Promise<'REQUESTER' | 'PROVIDER' | 'CREW' | 'AUTHORITY' | undefined> {
    const rows: { actor_class: 'REQUESTER' | 'PROVIDER' | 'CREW' | 'AUTHORITY' | null }[] =
      await entityManagerFor(transaction).query(
        'SELECT dispatch.cancellation_actor_class($1) AS actor_class',
        [actorUserId],
      );
    const actorClass = first(rows, 'cancellation actor class').actor_class;
    return actorClass === null ? undefined : actorClass;
  }

  async ingestLocationPoint(
    transaction: TransactionContext,
    input: Parameters<CoreDispatchRepository['ingestLocationPoint']>[1],
  ): ReturnType<CoreDispatchRepository['ingestLocationPoint']> {
    const rows: { result: Awaited<ReturnType<CoreDispatchRepository['ingestLocationPoint']>> }[] =
      await entityManagerFor(transaction).query(
        `SELECT tracking.ingest_location_point(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
         ) AS result`,
        [
          input.id,
          input.tripId,
          input.sourceDeviceId,
          input.pointId,
          input.sequence.toString(),
          input.latitude,
          input.longitude,
          input.accuracyMeters,
          input.headingDegrees ?? null,
          input.speedMetersPerSecond ?? null,
          input.quality,
          input.capturedAt,
        ],
      );
    return Promise.resolve(first(rows, 'location ingest result').result);
  }

  async findTrackingState(
    transaction: TransactionContext,
    tripId: string,
  ): Promise<TrackingStateRecord | undefined> {
    const rows: TrackingRow[] = await entityManagerFor(transaction).query(
      `SELECT state.trip_id, point.latitude, point.longitude, point.accuracy_meters,
              point.heading_degrees, point.speed_meters_per_second, point.quality,
              point.sequence, point.captured_at, point.received_at, state.version
         FROM tracking.trip_tracking_state state
         JOIN tracking.location_points point ON point.id = state.last_location_point_id
        WHERE state.trip_id = $1`,
      [tripId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      tripId: row.trip_id,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracyMeters: Number(row.accuracy_meters),
      ...(row.heading_degrees === null ? {} : { headingDegrees: Number(row.heading_degrees) }),
      ...(row.speed_meters_per_second === null
        ? {}
        : { speedMetersPerSecond: Number(row.speed_meters_per_second) }),
      quality: row.quality,
      sequence: BigInt(row.sequence),
      capturedAt: row.captured_at,
      receivedAt: row.received_at,
      version: row.version,
    };
  }

  async canReadTracking(transaction: TransactionContext, tripId: string): Promise<boolean> {
    const rows: { allowed: boolean }[] = await entityManagerFor(transaction).query(
      'SELECT tracking.principal_can_read_trip($1) AS allowed',
      [tripId],
    );
    return rows[0]?.allowed === true;
  }

  async createIncident(
    transaction: TransactionContext,
    input: Parameters<CoreDispatchRepository['createIncident']>[1],
  ): Promise<boolean> {
    const rows: { created: boolean }[] = await entityManagerFor(transaction).query(
      `SELECT safety.create_incident(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
       ) AS created`,
      [
        input.incidentId,
        input.eventId,
        input.tripId ?? null,
        input.bookingId ?? null,
        input.tenantId ?? null,
        input.facilityId ?? null,
        input.incidentType,
        input.severity,
        input.ciphertext,
        input.nonce,
        input.tag,
        input.keyVersion,
      ],
    );
    return rows[0]?.created === true;
  }

  async findIncident(
    transaction: TransactionContext,
    incidentId: string,
  ): Promise<SafetyIncidentRecord | undefined> {
    const rows: IncidentRow[] = await entityManagerFor(transaction).query(
      `${INCIDENT_SELECT} WHERE id = $1`,
      [incidentId],
    );
    return rows[0] === undefined ? undefined : incidentFrom(rows[0]);
  }

  async listIncidents(transaction: TransactionContext): Promise<readonly SafetyIncidentRecord[]> {
    const rows: IncidentRow[] = await entityManagerFor(transaction).query(
      `${INCIDENT_SELECT} ORDER BY created_at DESC, id`,
    );
    return rows.map(incidentFrom);
  }

  async transitionIncident(
    transaction: TransactionContext,
    input: Parameters<CoreDispatchRepository['transitionIncident']>[1],
  ): ReturnType<CoreDispatchRepository['transitionIncident']> {
    const rows: { result: Awaited<ReturnType<CoreDispatchRepository['transitionIncident']>> }[] =
      await entityManagerFor(transaction).query(
        'SELECT safety.transition_incident($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [
          input.incidentId,
          input.expectedVersion,
          input.eventId,
          input.actorUserId,
          input.action,
          input.targetTier,
          input.outcomeCode,
          input.reason ?? null,
        ],
      );
    return Promise.resolve(first(rows, 'incident transition result').result);
  }

  async expireOffer(transaction: TransactionContext, offerId: string): Promise<boolean> {
    const rows: { changed: boolean }[] = await entityManagerFor(transaction).query(
      'SELECT dispatch.expire_offer($1) AS changed',
      [offerId],
    );
    return rows[0]?.changed === true;
  }

  async finishSearch(
    transaction: TransactionContext,
    bookingId: string,
    transitionId: string,
    commandId: string,
  ): Promise<boolean> {
    const rows: { changed: boolean }[] = await entityManagerFor(transaction).query(
      'SELECT dispatch.finish_search($1,$2,$3) AS changed',
      [bookingId, transitionId, commandId],
    );
    return rows[0]?.changed === true;
  }

  async escalateUnacknowledged(
    transaction: TransactionContext,
    incidentId: string,
    expectedVersion: number,
    expectedTier: number,
    eventId: string,
  ): Promise<boolean> {
    const rows: { changed: boolean }[] = await entityManagerFor(transaction).query(
      'SELECT safety.escalate_unacknowledged($1,$2,$3,$4) AS changed',
      [incidentId, expectedVersion, expectedTier, eventId],
    );
    return rows[0]?.changed === true;
  }
}
