import { Booking } from '../types';

/**
 * Clearly-labelled sample trips. Shown only in demo mode or when the database
 * is not configured — never mixed with real booking rows.
 *
 * Kept in one place so trip history and every trip counter read from the
 * same source.
 */
export const SAMPLE_BOOKINGS: Booking[] = [
  {
    id: 'sample-ongoing',
    user_id: 'sample',
    driver_id: 'sample-driver',
    ambulance_id: 'sample-amb',
    category: 'basic',
    pickup_address: 'Thamel, Kathmandu',
    pickup_lat: 27.7172,
    pickup_lng: 85.324,
    destination_address: 'Grande International Hospital, Dhapasi',
    dest_lat: 27.7389,
    dest_lng: 85.3356,
    status: 'started',
    emergency_level: 'medium',
    distance_km: 8.5,
    duration_min: 24,
    payment_method: 'cash',
    created_at: '2026-10-17T10:30:00Z',
    updated_at: '2026-10-17T10:30:00Z',
  },
  {
    id: 'sample-completed',
    user_id: 'sample',
    driver_id: 'sample-driver',
    ambulance_id: 'sample-amb',
    category: 'icu',
    pickup_address: 'Baneshwor, Kathmandu',
    pickup_lat: 27.6939,
    pickup_lng: 85.3386,
    destination_address: 'Norvic International Hospital, Thapathali',
    dest_lat: 27.6967,
    dest_lng: 85.3147,
    status: 'completed',
    emergency_level: 'high',
    final_fare: 820,
    distance_km: 12.3,
    duration_min: 35,
    payment_method: 'cash',
    created_at: '2026-10-16T14:20:00Z',
    updated_at: '2026-10-16T15:00:00Z',
  },
  {
    id: 'sample-cancelled',
    user_id: 'sample',
    driver_id: 'sample-driver',
    ambulance_id: 'sample-amb',
    category: 'basic',
    pickup_address: 'Kupondole, Lalitpur',
    pickup_lat: 27.6789,
    pickup_lng: 85.3256,
    destination_address: 'Patan Hospital, Lagankhel',
    dest_lat: 27.6689,
    dest_lng: 85.3247,
    status: 'cancelled',
    emergency_level: 'low',
    distance_km: 5.2,
    duration_min: 15,
    payment_method: 'cash',
    created_at: '2026-10-15T09:00:00Z',
    updated_at: '2026-10-15T09:05:00Z',
  },
];
