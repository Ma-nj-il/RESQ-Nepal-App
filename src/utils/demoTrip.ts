import { estimateFare } from '../constants/fares';
import type { FareBreakdown } from '../constants/fares';
import type { AmbulanceCategory } from '../types/index';
import type { TrackingCoordinate } from './tracking';

export interface DemoTripReceipt {
  isDemo: true;
  id: 'DEMO-TRIP-001';
  completedAt: string;
  category: AmbulanceCategory;
  pickupAddress: string;
  destinationAddress: string;
  pickupPoint: TrackingCoordinate | null;
  destinationPoint: TrackingCoordinate | null;
  estimatedDistanceKm: number | null;
  fare: FareBreakdown | null;
  paymentMethod: 'cash';
}

interface DemoTripInput {
  demoModeEnabled: boolean;
  category: AmbulanceCategory;
  pickupAddress?: string | null;
  destinationAddress?: string | null;
  pickupPoint?: TrackingCoordinate | null;
  destinationPoint?: TrackingCoordinate | null;
  routeEstimateDistanceKm?: number | null;
}

export function createDemoTripReceipt(
  input: DemoTripInput,
  completedAt = new Date().toISOString(),
): DemoTripReceipt | null {
  if (!input.demoModeEnabled) return null;

  const distance = input.routeEstimateDistanceKm;
  const estimatedDistanceKm =
    typeof distance === 'number' && Number.isFinite(distance) && distance >= 0
      ? distance
      : null;

  return {
    isDemo: true,
    id: 'DEMO-TRIP-001',
    completedAt,
    category: input.category,
    pickupAddress: input.pickupAddress?.trim() || 'Unavailable',
    destinationAddress: input.destinationAddress?.trim() || 'Unavailable',
    pickupPoint: input.pickupPoint ?? null,
    destinationPoint: input.destinationPoint ?? null,
    estimatedDistanceKm,
    fare: estimatedDistanceKm === null ? null : estimateFare(input.category, estimatedDistanceKm),
    paymentMethod: 'cash',
  };
}
