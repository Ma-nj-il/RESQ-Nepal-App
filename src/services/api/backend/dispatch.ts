import {
  amountMinor, array, boolean, bookingStatus, cursorPage, integer, money, number, object, oneOf, optional,
  record, text, timestamp, tripStatus, uuid, windowPage,
} from './decoders';
import { invalidResponse } from './errors';
import type { CommandIdentity } from './requester';
import type { BackendSession } from './session';

const position = object({ latitude: number(-90, 90), longitude: number(-180, 180) });
export const fareQuote = object({
  id: uuid, serviceCategory: text, pickup: position, destination: position,
  route: object({ distanceMeters: integer(0), durationSeconds: integer(0), source: text,
    quality: oneOf(['PROVIDER_ROUTE', 'DEVELOPMENT_ESTIMATE']) }),
  fare: money, policyVersion: text, version: integer(1), expiresAt: timestamp, createdAt: timestamp,
});
export const booking = object({
  id: uuid, bookingReference: text, fareQuoteId: optional(uuid), pickupGeographicUnitId: uuid,
  destinationGeographicUnitId: optional(uuid), serviceCategory: text,
  urgency: oneOf(['ROUTINE', 'URGENT', 'EMERGENCY']), paymentMethod: oneOf(['CASH']),
  pickup: position, destination: position,
  consentFlags: object({ emergencyTransport: boolean, locationSharing: boolean }),
  status: bookingStatus, version: integer(1), searchDeadline: timestamp,
  completedAt: optional(timestamp), cancelledAt: optional(timestamp), createdAt: timestamp, updatedAt: timestamp,
});
export const trip = object({
  id: uuid, assignmentId: uuid, bookingId: uuid, tenantId: uuid, facilityId: uuid, driverId: uuid, ambulanceId: uuid,
  status: tripStatus, version: integer(1), startedAt: optional(timestamp), completedAt: optional(timestamp),
  cancelledAt: optional(timestamp), distanceMeters: optional(amountMinor),
  finalFare: optional(object({ amountMinor, currency: oneOf(['NPR']), provenance: text })),
  createdAt: timestamp, updatedAt: timestamp,
});
export const timeline = object({
  id: uuid, aggregateType: oneOf(['BOOKING', 'TRIP']), fromStatus: optional(text), toStatus: text,
  command: text, reasonCode: text, reason: optional(text), aggregateVersion: integer(1), occurredAt: timestamp,
});
export const assignment = object({
  id: uuid, bookingId: uuid, offerId: uuid, tenantId: uuid, facilityId: uuid,
  driverId: uuid, ambulanceId: uuid, acceptedAt: timestamp, version: integer(1),
});
const recoveryShape = object({
  observedAt: timestamp, booking, assignment: optional(assignment), trip: optional(trip),
  timeline: object({ items: array(timeline, 200), truncated: boolean }),
});
export function recoverySnapshot(value: unknown) {
  const snapshot = recoveryShape(value);
  const { booking, assignment, trip, timeline } = snapshot;
  if ((assignment === undefined) !== (trip === undefined) ||
      (assignment && assignment.bookingId !== booking.id) ||
      (trip && (!assignment || trip.bookingId !== booking.id || trip.assignmentId !== assignment.id ||
        trip.tenantId !== assignment.tenantId || trip.facilityId !== assignment.facilityId ||
        trip.driverId !== assignment.driverId || trip.ambulanceId !== assignment.ambulanceId)) ||
      timeline.items.some((item) => item.aggregateVersion > (item.aggregateType === 'BOOKING' ? booking.version : (trip?.version ?? 0))) ||
      new Set(timeline.items.map(item => item.id)).size !== timeline.items.length) invalidResponse();
  return snapshot;
}
export type RecoverySnapshot = ReturnType<typeof recoverySnapshot>;
const populatedTracking = object({
  tripId: uuid, position: object({ latitude: number(-90, 90), longitude: number(-180, 180),
    accuracyMeters: number(0, 500), headingDegrees: optional(number(0, 360)), speedMetersPerSecond: optional(number(0, 100)) }),
  quality: oneOf(['GOOD', 'REDUCED', 'POOR']), freshness: oneOf(['LIVE', 'STALE', 'UNAVAILABLE']),
  ageSeconds: integer(0), sequence: amountMinor, capturedAt: timestamp, receivedAt: timestamp, version: integer(1),
});
export function tracking(value: unknown) {
  const input = record(value);
  if (input.position === undefined) {
    if (input.freshness !== 'UNAVAILABLE') invalidResponse();
    return { tripId: uuid(input.tripId), freshness: 'UNAVAILABLE' as const };
  }
  return populatedTracking(value);
}
export const incident = object({
  id: uuid, tripId: optional(uuid), bookingId: optional(uuid), tenantId: optional(uuid), facilityId: optional(uuid),
  incidentType: text, severity: oneOf(['CRITICAL', 'HIGH', 'MEDIUM']), status: oneOf(['OPEN', 'ACKNOWLEDGED', 'ESCALATED', 'RESOLVED']),
  escalationTier: integer(0), version: integer(1), acknowledgedAt: optional(timestamp), resolvedAt: optional(timestamp),
  resolutionCode: optional(text), createdAt: timestamp, updatedAt: timestamp,
});

export type QuoteInput = {
  serviceCategory: string;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
};
export type BookingInput = QuoteInput & {
  fareQuoteId: string;
  pickupGeographicUnitId: string;
  destinationGeographicUnitId?: string;
  urgency: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  patientName: string;
  patientPhone?: string;
  pickupContactName: string;
  pickupContactPhone: string;
  assistanceNotes?: string;
  emergencyTransportConsent: boolean;
  locationSharingConsent: boolean;
};

export function createDispatchApi(session: BackendSession) {
  return {
    coverage: (body: Pick<QuoteInput, 'serviceCategory' | 'pickupLatitude' | 'pickupLongitude'>) => session.request({
      path: '/api/v1/service-coverage-checks', method: 'POST', body,
      decode: object({ serviceCategory: text, covered: boolean, eligibleFacilityCount: integer(0) }),
    }),
    quote: (body: QuoteInput) => session.request({ path: '/api/v1/fare-quotes', method: 'POST', body, decode: fareQuote }),
    createBooking: (body: BookingInput, idempotencyKey: string) => session.request({
      path: '/api/v1/bookings', method: 'POST', body, idempotencyKey, decode: booking,
    }),
    bookings: (afterId?: string) => session.request({ path: '/api/v1/bookings', decode: cursorPage(booking),
      query: { afterId: afterId === undefined ? undefined : uuid(afterId) } }),
    booking: (id: string) => session.request({ path: `/api/v1/bookings/${uuid(id)}`, decode: booking }),
    recovery: (id: string, signal?: AbortSignal) => session.request({ path: `/api/v1/bookings/${uuid(id)}/recovery`, signal, decode: recoverySnapshot }),
    timeline: (id: string) => session.request({ path: `/api/v1/bookings/${uuid(id)}/timeline`, decode: windowPage(timeline, 200) }),
    assignment: (id: string) => session.request({ path: `/api/v1/bookings/${uuid(id)}/assignment`, decode: assignment }),
    cancelBooking: (id: string, body: { reasonCode: string; reason: string }, command: CommandIdentity) => session.request({
      path: `/api/v1/bookings/${uuid(id)}/cancellation`, method: 'POST', body, ...command, decode: booking,
    }),
    trips: (afterId?: string) => session.request({ path: '/api/v1/trips', decode: cursorPage(trip),
      query: { afterId: afterId === undefined ? undefined : uuid(afterId) } }),
    trip: (id: string) => session.request({ path: `/api/v1/trips/${uuid(id)}`, decode: trip }),
    tracking: (id: string) => session.request({ path: `/api/v1/trips/${uuid(id)}/tracking`, decode: tracking }),
    createIncident: (body: { tripId?: string; incidentType: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'; details: string }, idempotencyKey: string) => session.request({
      path: '/api/v1/safety-incidents', method: 'POST', body, idempotencyKey, decode: incident,
    }),
    incident: (id: string) => session.request({ path: `/api/v1/safety-incidents/${uuid(id)}`, decode: incident }),
  };
}
