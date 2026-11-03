export type BookingStatus =
  | 'REQUESTED'
  | 'SEARCHING'
  | 'PROVIDER_ACCEPTED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'UNFULFILLED';

export type OfferStatus =
  'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'WITHDRAWN' | 'SUPERSEDED';

export type TripStatus =
  | 'ASSIGNED'
  | 'PREPARING_TO_DEPART'
  | 'EN_ROUTE_TO_PICKUP'
  | 'ARRIVED_AT_PICKUP'
  | 'PATIENT_ON_BOARD'
  | 'EN_ROUTE_TO_DESTINATION'
  | 'ARRIVED_AT_DESTINATION'
  | 'COMPLETED'
  | 'CANCELLED';

export type TripCommand =
  | 'PREPARE'
  | 'DEPART_TO_PICKUP'
  | 'ARRIVE_AT_PICKUP'
  | 'BOARD_PATIENT'
  | 'DEPART_TO_DESTINATION'
  | 'ARRIVE_AT_DESTINATION'
  | 'COMPLETE';

export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'ESCALATED' | 'RESOLVED';
export type IncidentAction = 'ACKNOWLEDGE' | 'ESCALATE' | 'RESOLVE';
export type TrackingFreshness = 'LIVE' | 'STALE' | 'UNAVAILABLE';

const EARTH_RADIUS_METERS = 6_371_000;

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function straightLineDistanceMeters(
  origin: { readonly latitude: number; readonly longitude: number },
  destination: { readonly latitude: number; readonly longitude: number },
): number {
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const originLatitude = radians(origin.latitude);
  const destinationLatitude = radians(destination.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.max(
    1,
    Math.round(EARTH_RADIUS_METERS * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)))),
  );
}

export function fareAmountMinor(
  baseFareMinor: bigint,
  perKilometerFareMinor: bigint,
  distanceMeters: number,
): bigint {
  if (baseFareMinor < 0n || perKilometerFareMinor < 0n || distanceMeters < 1) {
    throw new Error('Fare inputs must be non-negative and distance must be positive');
  }
  const distance = BigInt(distanceMeters);
  const distanceFare = (perKilometerFareMinor * distance + 999n) / 1_000n;
  return baseFareMinor + distanceFare;
}

const TRIP_TRANSITIONS: Readonly<
  Record<TripCommand, Readonly<Partial<Record<TripStatus, TripStatus>>>>
> = Object.freeze({
  PREPARE: Object.freeze({ ASSIGNED: 'PREPARING_TO_DEPART' }),
  DEPART_TO_PICKUP: Object.freeze({
    ASSIGNED: 'EN_ROUTE_TO_PICKUP',
    PREPARING_TO_DEPART: 'EN_ROUTE_TO_PICKUP',
  }),
  ARRIVE_AT_PICKUP: Object.freeze({ EN_ROUTE_TO_PICKUP: 'ARRIVED_AT_PICKUP' }),
  BOARD_PATIENT: Object.freeze({ ARRIVED_AT_PICKUP: 'PATIENT_ON_BOARD' }),
  DEPART_TO_DESTINATION: Object.freeze({
    PATIENT_ON_BOARD: 'EN_ROUTE_TO_DESTINATION',
  }),
  ARRIVE_AT_DESTINATION: Object.freeze({
    EN_ROUTE_TO_DESTINATION: 'ARRIVED_AT_DESTINATION',
  }),
  COMPLETE: Object.freeze({ ARRIVED_AT_DESTINATION: 'COMPLETED' }),
});

export function transitionTrip(status: TripStatus, command: TripCommand): TripStatus | undefined {
  return TRIP_TRANSITIONS[command][status];
}

export function cancellationRequiresOverride(status: TripStatus): boolean {
  return ['PATIENT_ON_BOARD', 'EN_ROUTE_TO_DESTINATION', 'ARRIVED_AT_DESTINATION'].includes(status);
}

export function trackingFreshness(
  lastCapturedAt: Date | undefined,
  evaluatedAt: Date,
  staleAfterMs = 30_000,
  unavailableAfterMs = 120_000,
): TrackingFreshness {
  if (lastCapturedAt === undefined) return 'UNAVAILABLE';
  const age = Math.max(0, evaluatedAt.getTime() - lastCapturedAt.getTime());
  if (age >= unavailableAfterMs) return 'UNAVAILABLE';
  if (age >= staleAfterMs) return 'STALE';
  return 'LIVE';
}

export function transitionIncident(
  status: IncidentStatus,
  action: IncidentAction,
): IncidentStatus | undefined {
  if (status === 'RESOLVED') return undefined;
  if (action === 'ACKNOWLEDGE' && ['OPEN', 'ESCALATED'].includes(status)) return 'ACKNOWLEDGED';
  if (action === 'ESCALATE') return 'ESCALATED';
  if (action === 'RESOLVE') return 'RESOLVED';
  return undefined;
}
