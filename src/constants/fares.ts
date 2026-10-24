import type { AmbulanceCategory } from '../types/index';

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

export interface FareBreakdown {
  baseFare: number;
  distanceCharge: number;
  serviceFee: number;
  totalFare: number;
  /** Distance used for the estimate, in kilometres. */
  distanceKm: number;
}

/**
 * Estimates a fare from the rate card — only when a real distance is
 * available. Returns `null` when the distance is unknown so screens can show a
 * transparent "fare confirmed after the trip" state instead of inventing a
 * number from a made-up default distance.
 */
export function estimateFare(
  category: AmbulanceCategory,
  distanceKm: number | null | undefined,
): FareBreakdown | null {
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm)) {
    return null;
  }
  const rate = FARE_RATE_CARD[category];
  const baseFare = rate.base;
  const distanceCharge = Math.round(rate.perKm * distanceKm);
  const serviceFee = rate.serviceFee;
  return {
    baseFare,
    distanceCharge,
    serviceFee,
    totalFare: baseFare + distanceCharge + serviceFee,
    distanceKm,
  };
}

/**
 * "Starting from" price for a category, straight from the rate card. This is
 * the only number shown before a distance is measured.
 */
export function startingPrice(category: AmbulanceCategory): number {
  return FARE_RATE_CARD[category].startingPrice;
}
