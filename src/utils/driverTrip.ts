import type { BookingStatus } from '../types';

export type DriverTripPhase =
  | 'pickup'
  | 'arrived'
  | 'started'
  | 'hospital-arrived'
  | 'completed';

export function phaseFromBookingStatus(status: BookingStatus): DriverTripPhase | null {
  switch (status) {
    case 'assigned':
    case 'arriving':
      return 'pickup';
    case 'arrived':
      return 'arrived';
    case 'started':
      return 'started';
    case 'completed':
      return 'completed';
    default:
      return null;
  }
}

const NEXT_PHASE: Record<DriverTripPhase, DriverTripPhase | null> = {
  pickup: 'arrived',
  arrived: 'started',
  started: 'hospital-arrived',
  'hospital-arrived': 'completed',
  completed: null,
};

export function canAdvanceDriverTripPhase(
  current: DriverTripPhase,
  next: DriverTripPhase,
): boolean {
  return NEXT_PHASE[current] === next;
}

export function isValidTripCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function getDriverTripDestination(
  phase: DriverTripPhase,
  pickup: { lat: number; lng: number },
  hospital: { lat: number; lng: number },
): { lat: number; lng: number } | null {
  const destination =
    phase === 'started' || phase === 'hospital-arrived' ? hospital : pickup;
  return isValidTripCoordinate(destination.lat, destination.lng) ? destination : null;
}

export function buildGoogleMapsDirectionsUrl(
  lat: number,
  lng: number,
): string | null {
  if (!isValidTripCoordinate(lat, lng)) return null;
  const destination = encodeURIComponent(`${lat},${lng}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving&dir_action=navigate`;
}
