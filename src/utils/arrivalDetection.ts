import type { TrackingCoordinate } from './tracking';

export const ARRIVAL_RADIUS_METERS = 100;
export const MAX_ARRIVAL_ACCURACY_METERS = 50;
export const ARRIVAL_FIX_MAX_AGE_MS = 15_000;
export const REQUIRED_ARRIVAL_SAMPLES = 3;
const MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND = 60;
const MIN_JUMP_ALLOWANCE_METERS = 100;
const MAX_ARRIVAL_SAMPLE_GAP_MS = 30_000;

export interface ArrivalLocationFix extends TrackingCoordinate {
  accuracy: number | null;
  timestamp: number;
  source: 'gps' | 'simulated';
}

export interface ArrivalDetectorState {
  previousFix: ArrivalLocationFix | null;
  consecutiveSamples: number;
  reached: boolean;
}

export interface ArrivalDetectionResult {
  state: ArrivalDetectorState;
  valid: boolean;
  reached: boolean;
  distanceMeters: number | null;
}

export const emptyArrivalDetector = (): ArrivalDetectorState => ({
  previousFix: null,
  consecutiveSamples: 0,
  reached: false,
});

function distanceMeters(a: TrackingCoordinate, b: TrackingCoordinate): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(b.lat - a.lat);
  const longitudeDelta = toRadians(b.lng - a.lng);
  const latitudeA = toRadians(a.lat);
  const latitudeB = toRadians(b.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function isValidCoordinate(point: TrackingCoordinate): boolean {
  return Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180;
}

export function isUsableArrivalFix(
  fix: ArrivalLocationFix | null | undefined,
  now = Date.now(),
): fix is ArrivalLocationFix {
  return Boolean(
    fix &&
      isValidCoordinate(fix) &&
      fix.accuracy != null &&
      Number.isFinite(fix.accuracy) &&
      fix.accuracy > 0 &&
      fix.accuracy <= MAX_ARRIVAL_ACCURACY_METERS &&
      Number.isFinite(fix.timestamp) &&
      now >= fix.timestamp &&
      now - fix.timestamp <= ARRIVAL_FIX_MAX_AGE_MS,
  );
}

export function updateArrivalDetection(
  state: ArrivalDetectorState,
  fix: ArrivalLocationFix,
  destination: TrackingCoordinate,
  now = Date.now(),
): ArrivalDetectionResult {
  const reset = emptyArrivalDetector();
  if (!isValidCoordinate(destination) || !isUsableArrivalFix(fix, now)) {
    return { state: reset, valid: false, reached: false, distanceMeters: null };
  }

  const previous = state.previousFix;
  if (previous) {
    const elapsedSeconds = (fix.timestamp - previous.timestamp) / 1000;
    if (elapsedSeconds <= 0 || elapsedSeconds * 1000 > MAX_ARRIVAL_SAMPLE_GAP_MS) {
      return { state: reset, valid: false, reached: false, distanceMeters: null };
    }
    const jumpMeters = distanceMeters(previous, fix);
    const maximumJump =
      MIN_JUMP_ALLOWANCE_METERS +
      elapsedSeconds * MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND +
      previous.accuracy! +
      fix.accuracy!;
    if (jumpMeters > maximumJump) {
      return { state: reset, valid: false, reached: false, distanceMeters: null };
    }
  }

  const distance = distanceMeters(fix, destination);
  const withinRadius = distance <= ARRIVAL_RADIUS_METERS;
  const consecutiveSamples = withinRadius ? state.consecutiveSamples + 1 : 0;
  const nextState: ArrivalDetectorState = {
    previousFix: fix,
    consecutiveSamples,
    reached: withinRadius && consecutiveSamples >= REQUIRED_ARRIVAL_SAMPLES,
  };
  return {
    state: nextState,
    valid: true,
    reached: nextState.reached,
    distanceMeters: distance,
  };
}

export function createSimulatedArrivalFixes(
  target: TrackingCoordinate,
  now = Date.now(),
): ArrivalLocationFix[] {
  if (!isValidCoordinate(target)) return [];
  return [0.00012, 0.00008, 0.00004].map((offset, index) => ({
    lat: target.lat + offset,
    lng: target.lng + offset,
    accuracy: 8,
    timestamp: now - (2 - index) * 5_000,
    source: 'simulated',
  }));
}
