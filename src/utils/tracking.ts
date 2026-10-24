import type { BookingStatus } from '../types';

export const ACTIVE_TRACKING_STATUSES: readonly BookingStatus[] = [
  'assigned',
  'arriving',
  'arrived',
  'started',
];

export const LOCATION_STALE_AFTER_MS = 90_000;
export const TRACKING_POLL_INTERVAL_MS = 10_000;
export const ROUTE_REFRESH_MIN_INTERVAL_MS = 45_000;
export const ROUTE_REFRESH_MIN_MOVEMENT_KM = 0.1;
export const ROUTE_REFRESH_MAX_INTERVAL_MS = 90_000;
export const SECURE_TRIP_TRACKING_ENABLED =
  process.env.EXPO_PUBLIC_SECURE_TRIP_TRACKING_ENABLED === 'true';

export interface TrackingCoordinate {
  lat: number;
  lng: number;
}

export interface TrackingLocation extends TrackingCoordinate {
  recorded_at?: string;
}

export function isAssignedDriverLocation(
  location: { driver_id?: string | null } | null | undefined,
  assignedDriverId: string | null | undefined,
): boolean {
  return Boolean(location && assignedDriverId && location.driver_id === assignedDriverId);
}

export function isTrackableBookingStatus(status: BookingStatus | string): boolean {
  return ACTIVE_TRACKING_STATUSES.includes(status as BookingStatus);
}

export function isFreshTrackingLocation(
  location: TrackingLocation | null | undefined,
  now = Date.now(),
): boolean {
  if (!location) return false;
  if (
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lng) ||
    location.lat < -90 ||
    location.lat > 90 ||
    location.lng < -180 ||
    location.lng > 180
  ) {
    return false;
  }
  const recordedAt = Date.parse(location.recorded_at ?? '');
  const age = now - recordedAt;
  return Number.isFinite(recordedAt) && age >= 0 && age <= LOCATION_STALE_AFTER_MS;
}

export function trackingAgeLabel(recordedAt: string, now = Date.now()): string | null {
  const timestamp = Date.parse(recordedAt);
  if (!Number.isFinite(timestamp) || timestamp > now) return null;
  const ageSeconds = Math.floor((now - timestamp) / 1000);
  if (ageSeconds < 60) return `Updated ${ageSeconds}s ago`;
  return `Updated ${Math.floor(ageSeconds / 60)}m ago`;
}

function distanceKm(a: TrackingCoordinate, b: TrackingCoordinate): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(value)));
}

export interface RouteRefreshPoint extends TrackingCoordinate {
  targetKey: string;
  requestedAt: number;
}

export function shouldRefreshTrackingRoute(
  previous: RouteRefreshPoint | null,
  current: TrackingCoordinate,
  targetKey: string,
  now = Date.now(),
): boolean {
  if (!previous || previous.targetKey !== targetKey) return true;
  const elapsed = now - previous.requestedAt;
  if (elapsed < ROUTE_REFRESH_MIN_INTERVAL_MS) return false;
  return (
    elapsed >= ROUTE_REFRESH_MAX_INTERVAL_MS ||
    distanceKm(previous, current) >= ROUTE_REFRESH_MIN_MOVEMENT_KM
  );
}

export function canPublishRealTracking(
  demoMode: boolean,
  supabaseConfigured: boolean,
  bookingId?: string | null,
  driverId?: string | null,
  status?: BookingStatus | string | null,
  secureTrackingEnabled = false,
): boolean {
  return Boolean(
    !demoMode &&
      supabaseConfigured &&
      secureTrackingEnabled &&
      bookingId &&
      driverId &&
      status &&
      isTrackableBookingStatus(status),
  );
}
