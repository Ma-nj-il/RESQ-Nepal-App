import { BookingStatus } from '../types';
import { TimelineStep } from '../components/booking/TripTimeline';

/** Shared booking timeline for the status and active-trip screens. */
export const BOOKING_TIMELINE_STEPS: TimelineStep[] = [
  { key: 'pending', label: 'Request submitted', icon: '📝' },
  { key: 'assigned', label: 'Ambulance assigned', icon: '🧑‍✈️' },
  { key: 'arriving', label: 'On the way to pickup', icon: '🚑' },
  { key: 'arrived', label: 'Arrived at pickup', icon: '📍' },
  { key: 'started', label: 'Trip started', icon: '🏥' },
  { key: 'completed', label: 'Trip completed', icon: '✅' },
];

export const BOOKING_STATUS_FLOW: BookingStatus[] = [
  'pending',
  'assigned',
  'arriving',
  'arrived',
  'started',
  'completed',
];

/** Index of a status in the normal flow; -1 for cancelled/rejected/draft. */
export function bookingStatusIndex(status: BookingStatus): number {
  return BOOKING_STATUS_FLOW.indexOf(status);
}
