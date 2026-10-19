export type UserMode = 'user' | 'driver';
export type BookingStatus = 'draft' | 'pending' | 'assigned' | 'arriving' | 'arrived' | 'started' | 'completed' | 'cancelled' | 'rejected';
export type AmbulanceCategory = 'basic' | 'icu';

/** Sensitive identity documents are stored privately; only metadata is read by the app. */
export type IdentityDocumentType = 'CITIZENSHIP' | 'DRIVING_LICENSE' | 'VEHICLE_BLUE_BOOK';
export type IdentityDocumentUploadStatus =
  | 'PENDING_UPLOAD'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'UPLOAD_FAILED'
  | 'REMOVED';
export type IdentityApplicationType = 'USER' | 'DRIVER';
export type IdentityApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING_VERIFICATION'
  | 'APPROVED'
  | 'REJECTED'
  | 'ADDITIONAL_INFORMATION_REQUIRED';
export type AmbulanceStatus = 'available' | 'busy' | 'offline';
export type DriverStatus = 'pending' | 'verified' | 'rejected';
export type PaymentMethod = 'wallet' | 'cash' | 'card' | 'esewa' | 'khalti';
export type TripStatus = 'ongoing' | 'completed' | 'cancelled';

export interface User {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  avatar_url?: string;
  gender?: string;
  date_of_birth?: string;
  /** Stored on the private profile; masked anywhere it is displayed. */
  citizenship_number?: string;
  mode: UserMode;
  created_at: string;
  updated_at: string;
}

export interface Driver {
  id: string;
  user_id: string;
  license_number: string;
  license_expiry: string;
  status: DriverStatus;
  rating: number;
  total_rides: number;
  rejection_reason?: string;
  verified_at?: string;
  created_at: string;
}

export interface Ambulance {
  id: string;
  driver_id: string;
  category: AmbulanceCategory;
  plate_number: string;
  model: string;
  color: string;
  status: AmbulanceStatus;
  equipment: string[];
  hospital_affiliation?: string;
  created_at: string;
}

export interface Booking {
  id: string;
  user_id: string;
  driver_id?: string;
  ambulance_id?: string;
  category: AmbulanceCategory;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  destination_address: string;
  dest_lat: number;
  dest_lng: number;
  status: BookingStatus;
  patient_name?: string;
  patient_age?: string;
  patient_condition?: string;
  patient_phone?: string;
  emergency_level: 'low' | 'medium' | 'high';
  estimated_fare?: number;
  final_fare?: number;
  distance_km?: number;
  duration_min?: number;
  payment_method: PaymentMethod;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface BookingStatusHistory {
  id: string;
  booking_id: string;
  status: BookingStatus;
  note?: string;
  created_at: string;
}

export interface Rating {
  id: string;
  booking_id: string;
  user_id: string;
  driver_id: string;
  rating: number;
  feedback?: string;
  tip_amount?: number;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  booking_id?: string;
  title: string;
  body: string;
  type: 'booking' | 'trip' | 'promo' | 'system';
  read: boolean;
  created_at: string;
}

export interface SavedPlace {
  id: string;
  user_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  type: 'home' | 'work' | 'other';
  created_at: string;
}

export interface Hospital {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone?: string | null;
  emergency_contact?: string | null;
  created_at?: string;
}

/**
 * A chosen route point. Coordinates may be unknown (e.g. a typed address that
 * could not be geocoded) — they are never fabricated to fill the gap.
 */
export interface RoutePoint {
  address: string;
  lat: number | null;
  lng: number | null;
  /** Where this point came from, so screens can label it honestly. */
  source?: 'current' | 'search' | 'saved' | 'recent' | 'sample' | 'typed' | 'map';
}

export type SosLocationStatus = 'acquired' | 'unavailable';
export type SosDeliveryStatus = 'queued' | 'sms_opened' | 'cancelled';

/** A locally-recorded SOS activation. Nothing is sent anywhere automatically. */
export interface SosEvent {
  id: string;
  created_at: string;
  lat: number | null;
  lng: number | null;
  location_status: SosLocationStatus;
  delivery_status: SosDeliveryStatus;
  /** SMS recipient used when the user opened the composer, if configured. */
  sms_recipient: string | null;
}

export interface SupportRequest {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: 'open' | 'closed';
  created_at: string;
}

/**
 * Safe document metadata returned to the app. The private object key is
 * intentionally omitted; upload/removal goes through the service layer.
 */
export interface IdentityDocument {
  id: string;
  account_id: string;
  driver_id?: string | null;
  vehicle_id?: string | null;
  document_type: IdentityDocumentType;
  original_filename?: string | null;
  mime_type: string;
  file_size: number;
  upload_status: IdentityDocumentUploadStatus;
  created_at: string;
  updated_at?: string;
}

export interface RegistrationApplication {
  id: string;
  reference_id: string;
  account_id: string;
  application_type: IdentityApplicationType;
  status: IdentityApplicationStatus;
  status_reason?: string | null;
  submitted_at?: string | null;
  last_status_update: string;
  created_at: string;
  updated_at?: string;
}
