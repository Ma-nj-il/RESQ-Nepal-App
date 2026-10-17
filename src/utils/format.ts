import { AmbulanceCategory, BookingStatus, PaymentMethod } from '../types';

/** Formats an amount as Nepali Rupees, e.g. `Rs. 1,250`. */
export const formatCurrency = (amount: number, withDecimals = false): string => {
  const formatted = amount.toLocaleString('en-IN', {
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  });
  return `Rs. ${formatted}`;
};

/** Formats a distance in km: `2.4 km`. */
export const formatDistance = (km: number): string => `${km.toFixed(1)} km`;

/** Formats minutes as `8 mins` / `1 hr 5 mins`. */
export const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${Math.round(minutes)} mins`;
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hrs} hr ${mins} mins` : `${hrs} hr`;
};

/** Formats an ISO date as `Dec 22, 2024`. */
export const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/** Formats an ISO date as `09:41 AM`. */
export const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

/** Human-readable booking status labels. */
export const bookingStatusLabel: Record<BookingStatus, string> = {
  draft: 'Draft',
  pending: 'Finding ambulance...',
  assigned: 'Ambulance assigned',
  arriving: 'Ambulance arriving',
  arrived: 'Ambulance has arrived',
  started: 'Trip started',
  completed: 'Trip completed',
  cancelled: 'Cancelled',
  rejected: 'Request rejected',
};

export const categoryLabel: Record<AmbulanceCategory, string> = {
  basic: 'Basic Ambulance',
  icu: 'ICU / Emergency',
};

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  wallet: 'RESQ Nepal Wallet',
  cash: 'Cash',
  card: 'Card',
  esewa: 'eSewa',
  khalti: 'Khalti',
};

/** Estimates fare in NPR for a category + distance. */
export const estimateFare = (category: AmbulanceCategory, distanceKm: number) => {
  const base = category === 'icu' ? 2500 : 1200;
  const perKm = category === 'icu' ? 120 : 65;
  const serviceFee = Math.round((base + perKm * distanceKm) * 0.05);
  const subtotal = base + Math.round(perKm * distanceKm);
  return {
    base,
    distance: Math.round(perKm * distanceKm),
    serviceFee,
    total: subtotal + serviceFee,
  };
};

/** Haversine distance in km between two coordinates. */
export const haversineKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

/** Validates a Nepali mobile number (98/97/96 prefix, 10 digits). */
export const isValidNepaliPhone = (phone: string): boolean => {
  const digits = phone.replace(/\D/g, '');
  return /^9[678]\d{8}$/.test(digits);
};
