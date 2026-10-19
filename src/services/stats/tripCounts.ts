import { Booking, BookingStatus } from '../../types';

export interface TripCounts {
  total: number;
  completed: number;
  cancelled: number;
  active: number;
}

export const EMPTY_TRIP_COUNTS: TripCounts = {
  total: 0,
  completed: 0,
  cancelled: 0,
  active: 0,
};

/** Requests that are still in progress (not finished, not cancelled). */
const ACTIVE_STATUSES: BookingStatus[] = ['draft', 'pending', 'assigned', 'arriving', 'arrived', 'started'];
/** Requests the user or dispatch ended early. */
const CANCELLED_STATUSES: BookingStatus[] = ['cancelled', 'rejected'];

/**
 * One counting rule for every surface (drawer, account summary, profile):
 * - total: every stored request returned for the signed-in user — the app
 *   never writes retry duplicates, so one row = one request;
 * - completed: stored status `completed`;
 * - cancelled: stored status `cancelled` or `rejected`;
 * - active: anything still in progress.
 */
export const countTrips = (bookings: Booking[]): TripCounts => {
  const counts: TripCounts = { ...EMPTY_TRIP_COUNTS };
  for (const booking of bookings) {
    counts.total += 1;
    if (booking.status === 'completed') counts.completed += 1;
    else if (CANCELLED_STATUSES.includes(booking.status)) counts.cancelled += 1;
    else if (ACTIVE_STATUSES.includes(booking.status)) counts.active += 1;
  }
  return counts;
};
