import type { JsonValue } from '../../../shared/application/idempotency/idempotency.js';
import type {
  AssignmentRecord,
  BookingRecord,
  CoverageAreaRecord,
  DispatchOfferRecord,
  SafetyIncidentRecord,
  TimelineRecord,
  TripRecord,
} from '../../application/ports/core-dispatch.repository.js';
import {
  assignmentJson,
  bookingJson,
  incidentJson,
  timelineJson,
  tripJson,
} from '../../application/core-dispatch-json.js';

export function serviceCoverageProjection(
  serviceCategory: string,
  records: readonly CoverageAreaRecord[],
): JsonValue {
  return {
    serviceCategory,
    covered: records.length > 0,
    eligibleFacilityCount: records.length,
  };
}

/** The requester projection deliberately contains no encrypted-storage representation. */
export function requesterBookingProjection(record: BookingRecord): JsonValue {
  return bookingJson(record);
}

/** Offered tenants receive only the operational minimum needed to assess an offer. */
export function tenantBookingProjection(record: BookingRecord): JsonValue {
  return {
    id: record.id,
    bookingReference: record.bookingReference,
    serviceCategory: record.serviceCategory,
    urgency: record.urgency,
    pickup: { latitude: record.pickupLatitude, longitude: record.pickupLongitude },
    status: record.status,
    version: record.version,
    searchDeadline: record.searchDeadline.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Authority projections omit precise route coordinates and requester/patient identity. */
export function authorityBookingProjection(record: BookingRecord): JsonValue {
  return {
    id: record.id,
    bookingReference: record.bookingReference,
    pickupGeographicUnitId: record.pickupGeographicUnitId,
    ...(record.destinationGeographicUnitId === undefined
      ? {}
      : { destinationGeographicUnitId: record.destinationGeographicUnitId }),
    serviceCategory: record.serviceCategory,
    urgency: record.urgency,
    status: record.status,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function tenantDispatchOfferProjection(
  offer: DispatchOfferRecord,
  booking: BookingRecord,
): JsonValue {
  return {
    id: offer.id,
    booking: tenantBookingProjection(booking),
    facilityId: offer.facilityId,
    status: offer.status,
    version: offer.version,
    expiresAt: offer.expiresAt.toISOString(),
    ...(offer.respondedAt === undefined ? {} : { respondedAt: offer.respondedAt.toISOString() }),
    ...(offer.responseReasonCode === undefined
      ? {}
      : { responseReasonCode: offer.responseReasonCode }),
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
  };
}

export function requesterAssignmentProjection(record: AssignmentRecord): JsonValue {
  return assignmentJson(record);
}

export function requesterTripProjection(record: TripRecord): JsonValue {
  return tripJson(record);
}

export function tenantTripProjection(record: TripRecord): JsonValue {
  return tripJson(record);
}

export function authorityTripProjection(record: TripRecord): JsonValue {
  return {
    id: record.id,
    bookingId: record.bookingId,
    tenantId: record.tenantId,
    facilityId: record.facilityId,
    status: record.status,
    version: record.version,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt.toISOString() }),
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt.toISOString() }),
    ...(record.cancelledAt === undefined ? {} : { cancelledAt: record.cancelledAt.toISOString() }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function involvedTimelineProjection(record: TimelineRecord): JsonValue {
  return timelineJson(record);
}

export function requesterIncidentProjection(record: SafetyIncidentRecord): JsonValue {
  return incidentJson(record);
}

export function tenantIncidentProjection(record: SafetyIncidentRecord): JsonValue {
  return incidentJson(record);
}

export function authorityIncidentProjection(record: SafetyIncidentRecord): JsonValue {
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
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
