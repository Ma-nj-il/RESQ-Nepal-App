import { supabase, isSupabaseConfigured } from './client';
import { BookingStatusHistory } from '../../types';

export interface TripLocation {
  id?: number;
  booking_id: string;
  driver_id: string;
  lat: number;
  lng: number;
  heading?: number;
  speed_kmh?: number;
  recorded_at?: string;
}

export const tripsService = {
  /**
   * Appends a GPS breadcrumb for an active trip. The database RLS policy
   * verifies the authenticated driver's assignment and active booking status.
   */
  async recordLocation(location: TripLocation): Promise<void> {
    if (!isSupabaseConfigured) throw new Error('Trip tracking is unavailable.');
    const { error } = await supabase.from('trip_locations').insert(location);
    if (error) throw error;
  },

  /** Latest breadcrumb for the live tracking map. */
  async getLatestLocation(bookingId: string): Promise<TripLocation | null> {
    if (!isSupabaseConfigured) throw new Error('Trip tracking is unavailable.');
    const { data, error } = await supabase
      .from('trip_locations')
      .select('id, booking_id, driver_id, lat, lng, heading, speed_kmh, recorded_at')
      .eq('booking_id', bookingId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Full breadcrumb trail for route rendering. */
  async getTrail(bookingId: string, limit = 200): Promise<TripLocation[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('trip_locations')
      .select('*')
      .eq('booking_id', bookingId)
      .order('recorded_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  /** Immutable status-change audit trail for a booking. */
  async getStatusHistory(bookingId: string): Promise<BookingStatusHistory[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('booking_status_history')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },
};
