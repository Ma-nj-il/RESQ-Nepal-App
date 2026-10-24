import type { TrackingCoordinate } from './tracking';

export interface DemoAssignmentPreview {
  driverName: string;
  vehicleRegistration: string;
  vehicleModel: string;
  etaLabel: string;
  distanceLabel: string;
  ambulanceLocation: TrackingCoordinate | null;
}

export function buildDemoAssignmentPreview(
  demoModeEnabled: boolean,
  pickup: TrackingCoordinate | null,
): DemoAssignmentPreview | null {
  if (!demoModeEnabled) return null;

  let ambulanceLocation: TrackingCoordinate | null = null;
  if (pickup) {
    const lat = pickup.lat + 0.004;
    const lng = pickup.lng + 0.004;
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      ambulanceLocation = { lat, lng };
    }
  }

  return {
    driverName: 'Maya Demo',
    vehicleRegistration: 'DEMO-AMB-001',
    vehicleModel: 'Sample ambulance · demonstration only',
    etaLabel: 'Approx. 5 min',
    distanceLabel: 'Approx. 1.2 km',
    ambulanceLocation,
  };
}
