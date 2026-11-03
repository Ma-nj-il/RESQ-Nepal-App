import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import type {
  BookingStatus,
  IncidentAction,
  IncidentStatus,
  OfferStatus,
  TripCommand,
  TripStatus,
} from '../../domain/core-dispatch.js';

export interface CoverageAreaRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly facilityId: string;
  readonly serviceCategory: string;
  readonly distanceToCenterMeters: number;
  readonly radiusMeters: number;
  readonly baseFareMinor: bigint;
  readonly perKilometerFareMinor: bigint;
  readonly currency: 'NPR';
  readonly version: number;
}

export interface FareQuoteRecord {
  readonly id: string;
  readonly requesterUserId: string;
  readonly coverageAreaId: string;
  readonly serviceCategory: string;
  readonly pickupLatitude: number;
  readonly pickupLongitude: number;
  readonly destinationLatitude: number;
  readonly destinationLongitude: number;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly amountMinor: bigint;
  readonly currency: 'NPR';
  readonly routeSource: string;
  readonly routeQuality: 'PROVIDER_ROUTE' | 'DEVELOPMENT_ESTIMATE';
  readonly policyVersion: string;
  readonly version: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface BookingRecord {
  readonly id: string;
  readonly bookingReference: string;
  readonly requesterUserId: string;
  readonly fareQuoteId?: string;
  readonly pickupGeographicUnitId: string;
  readonly destinationGeographicUnitId?: string;
  readonly serviceCategory: string;
  readonly urgency: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  readonly paymentMethod: 'CASH';
  readonly pickupLatitude: number;
  readonly pickupLongitude: number;
  readonly destinationLatitude: number;
  readonly destinationLongitude: number;
  readonly consentFlags: Readonly<Record<string, boolean>>;
  readonly status: BookingStatus;
  readonly version: number;
  readonly searchDeadline: Date;
  readonly completedAt?: Date;
  readonly cancelledAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DispatchOfferRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly tenantId: string;
  readonly facilityId: string;
  readonly status: OfferStatus;
  readonly version: number;
  readonly expiresAt: Date;
  readonly respondedAt?: Date;
  readonly responseReasonCode?: string;
  readonly responseReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AssignmentRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly offerId: string;
  readonly tenantId: string;
  readonly facilityId: string;
  readonly driverId: string;
  readonly ambulanceId: string;
  readonly dispatcherUserId: string;
  readonly acceptedAt: Date;
  readonly releasedAt?: Date;
  readonly releaseReasonCode?: string;
  readonly version: number;
}

export interface TripRecord {
  readonly id: string;
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly requesterUserId: string;
  readonly tenantId: string;
  readonly facilityId: string;
  readonly driverId: string;
  readonly ambulanceId: string;
  readonly status: TripStatus;
  readonly version: number;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly cancelledAt?: Date;
  readonly distanceMeters?: bigint;
  readonly finalFareMinor?: bigint;
  readonly finalFareCurrency?: 'NPR';
  readonly finalFareProvenance?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TimelineRecord {
  readonly id: string;
  readonly aggregateType: 'BOOKING' | 'TRIP';
  readonly fromStatus?: string;
  readonly toStatus: string;
  readonly command: string;
  readonly reasonCode: string;
  readonly reason?: string;
  readonly aggregateVersion: number;
  readonly occurredAt: Date;
}

export interface TrackingStateRecord {
  readonly tripId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
  readonly headingDegrees?: number;
  readonly speedMetersPerSecond?: number;
  readonly quality: 'GOOD' | 'REDUCED' | 'POOR';
  readonly sequence: bigint;
  readonly capturedAt: Date;
  readonly receivedAt: Date;
  readonly version: number;
}

export interface SafetyIncidentRecord {
  readonly id: string;
  readonly creatorUserId: string;
  readonly tripId?: string;
  readonly bookingId?: string;
  readonly tenantId?: string;
  readonly facilityId?: string;
  readonly incidentType: 'SOS' | 'SAFETY_CONCERN' | 'ROUTE_DEVIATION';
  readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  readonly status: IncidentStatus;
  readonly escalationTier: number;
  readonly version: number;
  readonly acknowledgedByUserId?: string;
  readonly acknowledgedAt?: Date;
  readonly resolvedByUserId?: string;
  readonly resolvedAt?: Date;
  readonly resolutionCode?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type DispatchCommandResult =
  | 'ACCEPTED'
  | 'SEARCHING'
  | 'CANCELLED'
  | 'DECLINED'
  | 'WITHDRAWN'
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'STALE_VERSION'
  | 'INVALID_TRANSITION'
  | 'INVALID_COVERAGE'
  | 'CONFLICT'
  | 'OFFER_RESOLVED'
  | 'OFFER_EXPIRED'
  | 'PROVIDER_NOT_ELIGIBLE'
  | 'DRIVER_NOT_ELIGIBLE'
  | 'AMBULANCE_NOT_ELIGIBLE'
  | 'RESOURCE_CONFLICT'
  | 'OVERRIDE_REQUIRED'
  | 'COMPLETION_EVIDENCE_REQUIRED';

export interface CoreDispatchRepository {
  findCoverage(
    transaction: TransactionContext,
    serviceCategory: string,
    latitude: number,
    longitude: number,
  ): Promise<readonly CoverageAreaRecord[]>;
  createFareQuote(
    transaction: TransactionContext,
    input: Omit<FareQuoteRecord, 'version'>,
  ): Promise<FareQuoteRecord>;
  createBooking(
    transaction: TransactionContext,
    input: {
      readonly booking: Omit<
        BookingRecord,
        | 'requesterUserId'
        | 'status'
        | 'version'
        | 'completedAt'
        | 'cancelledAt'
        | 'createdAt'
        | 'updatedAt'
      >;
      readonly ciphertext: Buffer;
      readonly nonce: Buffer;
      readonly tag: Buffer;
      readonly keyVersion: string;
      readonly transitionId: string;
      readonly commandId: string;
    },
  ): Promise<boolean>;
  startBookingSearch(
    transaction: TransactionContext,
    input: {
      readonly bookingId: string;
      readonly expectedVersion: number;
      readonly transitionId: string;
      readonly commandId: string;
      readonly offerIds: readonly string[];
      readonly coverageAreaIds: readonly string[];
      readonly offerExpiresAt: Date;
    },
  ): Promise<DispatchCommandResult>;
  listBookings(transaction: TransactionContext): Promise<readonly BookingRecord[]>;
  findBooking(
    transaction: TransactionContext,
    bookingId: string,
  ): Promise<BookingRecord | undefined>;
  listBookingTimeline(
    transaction: TransactionContext,
    bookingId: string,
  ): Promise<readonly TimelineRecord[]>;
  findAssignmentByBooking(
    transaction: TransactionContext,
    bookingId: string,
  ): Promise<AssignmentRecord | undefined>;
  listOffers(transaction: TransactionContext): Promise<readonly DispatchOfferRecord[]>;
  findOffer(
    transaction: TransactionContext,
    offerId: string,
  ): Promise<DispatchOfferRecord | undefined>;
  findOffersByBooking(
    transaction: TransactionContext,
    bookingId: string,
  ): Promise<readonly DispatchOfferRecord[]>;
  findAcceptedOfferOutcomes(
    transaction: TransactionContext,
    acceptedOfferId: string,
    dispatcherUserId: string,
  ): Promise<readonly DispatchOfferRecord[]>;
  acceptOffer(
    transaction: TransactionContext,
    input: {
      readonly offerId: string;
      readonly expectedVersion: number;
      readonly assignmentId: string;
      readonly tripId: string;
      readonly offerTransitionId: string;
      readonly activeTransitionId: string;
      readonly tripTransitionId: string;
      readonly driverId: string;
      readonly ambulanceId: string;
      readonly dispatcherUserId: string;
      readonly commandId: string;
    },
  ): Promise<DispatchCommandResult>;
  resolveOffer(
    transaction: TransactionContext,
    input: {
      readonly offerId: string;
      readonly expectedVersion: number;
      readonly actorUserId: string;
      readonly status: 'DECLINED' | 'WITHDRAWN';
      readonly reasonCode: string;
      readonly reason?: string;
    },
  ): Promise<DispatchCommandResult>;
  listTrips(transaction: TransactionContext): Promise<readonly TripRecord[]>;
  findTrip(transaction: TransactionContext, tripId: string): Promise<TripRecord | undefined>;
  findTripByBooking(
    transaction: TransactionContext,
    bookingId: string,
  ): Promise<TripRecord | undefined>;
  transitionTrip(
    transaction: TransactionContext,
    input: {
      readonly tripId: string;
      readonly expectedVersion: number;
      readonly transitionId: string;
      readonly actorUserId: string;
      readonly command: TripCommand;
      readonly commandId: string;
      readonly reasonCode: string;
      readonly reason?: string;
      readonly pickupOdometerMeters?: bigint;
      readonly completionOdometerMeters?: bigint;
      readonly distanceMeters?: bigint;
      readonly finalFareMinor?: bigint;
      readonly finalFareCurrency?: string;
      readonly finalFareProvenance?: string;
    },
  ): Promise<DispatchCommandResult | TripStatus>;
  cancelBooking(
    transaction: TransactionContext,
    input: {
      readonly bookingId: string;
      readonly expectedVersion: number;
      readonly cancellationId: string;
      readonly tripTransitionId: string;
      readonly bookingTransitionId: string;
      readonly actorUserId: string;
      readonly actorClass: 'REQUESTER' | 'PROVIDER' | 'CREW' | 'AUTHORITY';
      readonly policyCode: string;
      readonly policyVersion: string;
      readonly reasonCode: string;
      readonly reason: string;
      readonly feeMinor: bigint;
      readonly feeCurrency: string;
      readonly feeWaived: boolean;
      readonly commandId: string;
    },
  ): Promise<DispatchCommandResult>;
  resolveCancellationActorClass(
    transaction: TransactionContext,
    actorUserId: string,
  ): Promise<'REQUESTER' | 'PROVIDER' | 'CREW' | 'AUTHORITY' | undefined>;
  ingestLocationPoint(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly tripId: string;
      readonly sourceDeviceId: string;
      readonly pointId: string;
      readonly sequence: bigint;
      readonly latitude: number;
      readonly longitude: number;
      readonly accuracyMeters: number;
      readonly headingDegrees?: number;
      readonly speedMetersPerSecond?: number;
      readonly quality: 'GOOD' | 'REDUCED' | 'POOR';
      readonly capturedAt: Date;
    },
  ): Promise<
    | 'ACCEPTED'
    | 'DUPLICATE'
    | 'STALE_SEQUENCE'
    | 'STALE_CAPTURE'
    | 'TRIP_NOT_ACTIVE'
    | 'NOT_AUTHORIZED'
    | 'INVALID_POINT'
  >;
  findTrackingState(
    transaction: TransactionContext,
    tripId: string,
  ): Promise<TrackingStateRecord | undefined>;
  canReadTracking(transaction: TransactionContext, tripId: string): Promise<boolean>;
  createIncident(
    transaction: TransactionContext,
    input: {
      readonly incidentId: string;
      readonly eventId: string;
      readonly tripId?: string;
      readonly bookingId?: string;
      readonly tenantId?: string;
      readonly facilityId?: string;
      readonly incidentType: SafetyIncidentRecord['incidentType'];
      readonly severity: SafetyIncidentRecord['severity'];
      readonly ciphertext: Buffer;
      readonly nonce: Buffer;
      readonly tag: Buffer;
      readonly keyVersion: string;
    },
  ): Promise<boolean>;
  findIncident(
    transaction: TransactionContext,
    incidentId: string,
  ): Promise<SafetyIncidentRecord | undefined>;
  listIncidents(transaction: TransactionContext): Promise<readonly SafetyIncidentRecord[]>;
  transitionIncident(
    transaction: TransactionContext,
    input: {
      readonly incidentId: string;
      readonly expectedVersion: number;
      readonly eventId: string;
      readonly actorUserId: string;
      readonly action: IncidentAction;
      readonly targetTier: number;
      readonly outcomeCode: string;
      readonly reason?: string;
    },
  ): Promise<IncidentStatus | DispatchCommandResult | 'INVALID_ESCALATION_TIER'>;
  expireOffer(transaction: TransactionContext, offerId: string): Promise<boolean>;
  finishSearch(
    transaction: TransactionContext,
    bookingId: string,
    transitionId: string,
    commandId: string,
  ): Promise<boolean>;
  escalateUnacknowledged(
    transaction: TransactionContext,
    incidentId: string,
    expectedVersion: number,
    expectedTier: number,
    eventId: string,
  ): Promise<boolean>;
}

export const CORE_DISPATCH_REPOSITORY = Symbol('CORE_DISPATCH_REPOSITORY');
