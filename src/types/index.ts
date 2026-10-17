export type UserMode = 'user' | 'driver';
export type BookingStatus = 'draft' | 'pending' | 'assigned' | 'arriving' | 'arrived' | 'started' | 'completed' | 'cancelled' | 'rejected';
export type AmbulanceCategory = 'basic' | 'icu';
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

export interface SupportRequest {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: 'open' | 'closed';
  created_at: string;
}
