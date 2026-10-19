import { BookingStatus, Hospital, SosLocationStatus } from '../../types';

/**
 * Typed contracts for the future RESQ Nepal backend API.
 *
 * The mobile app talks to Supabase directly today (see src/services/database).
 * These types describe the request/response shapes a future HTTP API must
 * expose so the UI can migrate without changing its screens. They are
 * documentation-as-types: nothing in this file performs network calls and no
 * endpoint is implemented yet. Route sketches, authorization rules and the
 * error format are in docs/future-api-contracts.md.
 */

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/* ---------- auth & profile ---------- */

export interface ProfileUpdateRequest {
  full_name?: string;
  email?: string;
  gender?: string | null;
  avatar_url?: string | null;
}

/* ---------- bookings ---------- */

export interface RoutePointDto {
  address: string;
  lat: number | null;
  lng: number | null;
}

export interface PatientDetailsDto {
  forSomeoneElse: boolean;
  patientName?: string;
  patientPhone?: string;
  onsiteContactName?: string;
  onsiteContactPhone?: string;
  assistanceNotes?: string;
}

export interface CreateBookingRequest {
  category: 'basic' | 'icu';
  pickup: RoutePointDto;
  destination: RoutePointDto;
  patient: PatientDetailsDto;
  paymentMethod: 'cash';
  notes?: string;
}

export interface BookingDto {
  id: string;
  status: BookingStatus;
  category: 'basic' | 'icu';
  pickup: RoutePointDto;
  destination: RoutePointDto;
  driverId: string | null;
  ambulanceId: string | null;
  finalFare: number | null;
  paymentMethod: 'cash';
  paymentStatus: 'pending' | 'collected';
  createdAt: string;
  updatedAt: string;
}

export interface TripCountsDto {
  total: number;
  completed: number;
  cancelled: number;
  active: number;
}

/* ---------- saved places & hospitals ---------- */

export interface SavedPlaceDto extends RoutePointDto {
  id: string;
  name: string;
  label: 'Home' | 'Work' | 'Family' | 'Other';
}

export interface SavedHospitalDto {
  hospitalId: string;
  savedAt: string;
}

export type HospitalSearchResponse = Page<Hospital>;

/* ---------- notifications ---------- */

export interface AppNotificationDto {
  id: string;
  bookingId: string | null;
  category: 'booking' | 'trip' | 'account' | 'promo';
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationPreferencesDto {
  bookingUpdates: boolean;
  tripStatus: boolean;
  general: boolean;
  promo: boolean;
}

/* ---------- safety ---------- */

export interface SosEventRequest {
  lat: number | null;
  lng: number | null;
  locationStatus: SosLocationStatus;
  contactIds: string[];
}

export interface SosEventDto {
  id: string;
  status: 'queued' | 'sent_to_contacts' | 'failed';
  createdAt: string;
}

/* ---------- driver onboarding & trips ---------- */

export type DriverApplicationStatus = 'submitted' | 'under_review' | 'needs_info' | 'approved' | 'rejected';

export interface DriverApplicationRequest {
  fullName: string;
  phone: string;
  licenceNumber: string;
  licenceExpiry: string;
  vehiclePlate: string;
  category: 'basic' | 'icu';
  equipment: string[];
  hospitalAffiliation: string;
}

export interface DriverApplicationDto extends DriverApplicationRequest {
  id: string;
  status: DriverApplicationStatus;
  reviewNote: string | null;
  submittedAt: string;
}

/* ---------- receipts & feedback ---------- */

export interface ReceiptDto {
  bookingId: string;
  fare: number | null;
  paymentMethod: 'cash';
  paymentStatus: 'pending' | 'collected';
  completedAt: string;
}

export interface FeedbackRequest {
  bookingId: string;
  rating: number;
  comment?: string;
}
