import type { JsonValue } from '../../shared/application/idempotency/idempotency.js';
import type {
  AssignmentRecord,
  BookingRecord,
  DispatchOfferRecord,
  FareQuoteRecord,
  SafetyIncidentRecord,
  TimelineRecord,
  TrackingStateRecord,
  TripRecord,
} from './ports/core-dispatch.repository.js';

export function fareQuoteJson(record: FareQuoteRecord): JsonValue {
  return {
    id: record.id,
    serviceCategory: record.serviceCategory,
    pickup: { latitude: record.pickupLatitude, longitude: record.pickupLongitude },
    destination: {
      latitude: record.destinationLatitude,
      longitude: record.destinationLongitude,
    },
    route: {
      distanceMeters: record.distanceMeters,
      durationSeconds: record.durationSeconds,
      source: record.routeSource,
      quality: record.routeQuality,
    },
    fare: { amountMinor: record.amountMinor.toString(), currency: record.currency },
    policyVersion: record.policyVersion,
    version: record.version,
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

export function bookingJson(record: BookingRecord): JsonValue {
  return {
    id: record.id,
    bookingReference: record.bookingReference,
    ...(record.fareQuoteId === undefined ? {} : { fareQuoteId: record.fareQuoteId }),
    pickupGeographicUnitId: record.pickupGeographicUnitId,
    ...(record.destinationGeographicUnitId === undefined
      ? {}
      : { destinationGeographicUnitId: record.destinationGeographicUnitId }),
    serviceCategory: record.serviceCategory,
    urgency: record.urgency,
    paymentMethod: record.paymentMethod,
    pickup: { latitude: record.pickupLatitude, longitude: record.pickupLongitude },
    destination: {
      latitude: record.destinationLatitude,
      longitude: record.destinationLongitude,
    },
    consentFlags: { ...record.consentFlags },
    status: record.status,
    version: record.version,
    searchDeadline: record.searchDeadline.toISOString(),
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt.toISOString() }),
    ...(record.cancelledAt === undefined ? {} : { cancelledAt: record.cancelledAt.toISOString() }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function offerJson(record: DispatchOfferRecord): JsonValue {
  return {
    id: record.id,
    bookingId: record.bookingId,
    tenantId: record.tenantId,
    facilityId: record.facilityId,
    status: record.status,
    version: record.version,
    expiresAt: record.expiresAt.toISOString(),
    ...(record.respondedAt === undefined ? {} : { respondedAt: record.respondedAt.toISOString() }),
    ...(record.responseReasonCode === undefined
      ? {}
      : { responseReasonCode: record.responseReasonCode }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function assignmentJson(record: AssignmentRecord): JsonValue {
  return {
    id: record.id,
    bookingId: record.bookingId,
    offerId: record.offerId,
    tenantId: record.tenantId,
    facilityId: record.facilityId,
    driverId: record.driverId,
    ambulanceId: record.ambulanceId,
    acceptedAt: record.acceptedAt.toISOString(),
    version: record.version,
  };
}

export function tripJson(record: TripRecord): JsonValue {
  return {
    id: record.id,
    assignmentId: record.assignmentId,
    bookingId: record.bookingId,
    tenantId: record.tenantId,
    facilityId: record.facilityId,
    driverId: record.driverId,
    ambulanceId: record.ambulanceId,
    status: record.status,
    version: record.version,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt.toISOString() }),
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt.toISOString() }),
    ...(record.cancelledAt === undefined ? {} : { cancelledAt: record.cancelledAt.toISOString() }),
    ...(record.distanceMeters === undefined
      ? {}
      : { distanceMeters: record.distanceMeters.toString() }),
    ...(record.finalFareMinor === undefined
      ? {}
      : {
          finalFare: {
            amountMinor: record.finalFareMinor.toString(),
            currency: record.finalFareCurrency ?? 'NPR',
            provenance: record.finalFareProvenance ?? 'UNKNOWN',
          },
        }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function timelineJson(record: TimelineRecord): JsonValue {
  return {
    id: record.id,
    aggregateType: record.aggregateType,
    ...(record.fromStatus === undefined ? {} : { fromStatus: record.fromStatus }),
    toStatus: record.toStatus,
    command: record.command,
    reasonCode: record.reasonCode,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    aggregateVersion: record.aggregateVersion,
    occurredAt: record.occurredAt.toISOString(),
  };
}

export function trackingJson(
  record: TrackingStateRecord,
  freshness: 'LIVE' | 'STALE' | 'UNAVAILABLE',
  evaluatedAt: Date,
): JsonValue {
  return {
    tripId: record.tripId,
    position: {
      latitude: record.latitude,
      longitude: record.longitude,
      accuracyMeters: record.accuracyMeters,
      ...(record.headingDegrees === undefined ? {} : { headingDegrees: record.headingDegrees }),
      ...(record.speedMetersPerSecond === undefined
        ? {}
        : { speedMetersPerSecond: record.speedMetersPerSecond }),
    },
    quality: record.quality,
    freshness,
    ageSeconds: Math.max(
      0,
      Math.floor((evaluatedAt.getTime() - record.capturedAt.getTime()) / 1_000),
    ),
    sequence: record.sequence.toString(),
    capturedAt: record.capturedAt.toISOString(),
    receivedAt: record.receivedAt.toISOString(),
    version: record.version,
  };
}

export function incidentJson(record: SafetyIncidentRecord): JsonValue {
  return {
    id: record.id,
    ...(record.tripId === undefined ? {} : { tripId: record.tripId }),
    ...(record.bookingId === undefined ? {} : { bookingId: record.bookingId }),
    ...(record.tenantId === undefined ? {} : { tenantId: record.tenantId }),
    ...(record.facilityId === undefined ? {} : { facilityId: record.facilityId }),
    incidentType: record.incidentType,
    severity: record.severity,
    status: record.status,
    escalationTier: record.escalationTier,
    version: record.version,
    ...(record.acknowledgedAt === undefined
      ? {}
      : { acknowledgedAt: record.acknowledgedAt.toISOString() }),
    ...(record.resolvedAt === undefined ? {} : { resolvedAt: record.resolvedAt.toISOString() }),
    ...(record.resolutionCode === undefined ? {} : { resolutionCode: record.resolutionCode }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
