import { AmbulanceCategory } from '../types';

/**
 * Indicative fare rate card (NPR).
 *
 * These are product default prices used to estimate a fare before a booking
 * is created. They are NOT live pricing and do not include surge, waiting
 * charges, or hospital-specific rates. See docs/known-limitations.md.
 */
export interface FareRate {
  /** Indicative starting price shown on vehicle cards. */
  startingPrice: number;
  /** Base fare component. */
  base: number;
  /** Per-kilometre component. */
  perKm: number;
  /** Fixed service fee. */
  serviceFee: number;
}

export const FARE_RATE_CARD: Record<AmbulanceCategory, FareRate> = {
  basic: {
    startingPrice: 1500,
    base: 600,
    perKm: 150,
    serviceFee: 150,
  },
  icu: {
    startingPrice: 3500,
    base: 1400,
    perKm: 350,
    serviceFee: 350,
  },
};

/** Default trip distance used when no measured distance is available. */
export const DEFAULT_TRIP_DISTANCE_KM = 5.2;

/**
 * Estimates a fare from the rate card. Returns a breakdown so screens can
 * present each component honestly.
 */
export function estimateFare(
  category: AmbulanceCategory,
  distanceKm: number = DEFAULT_TRIP_DISTANCE_KM
): { baseFare: number; distanceCharge: number; serviceFee: number; totalFare: number } {
  const rate = FARE_RATE_CARD[category];
  const baseFare = rate.base;
  const distanceCharge = Math.round(rate.perKm * distanceKm);
  const serviceFee = rate.serviceFee;
  return {
    baseFare,
    distanceCharge,
    serviceFee,
    totalFare: baseFare + distanceCharge + serviceFee,
  };
}
