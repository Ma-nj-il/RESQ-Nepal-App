import { supabase, isSupabaseConfigured } from './client';
import { Driver, Ambulance } from '../../types';

export const driversService = {
  async getByUserId(userId: string): Promise<Driver | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('drivers')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getById(id: string): Promise<Driver | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('drivers')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Creates a driver application. The insert is only accepted by the
   * database when status = 'pending' and rating/total_rides are 0
   * (enforced by RLS policy "drivers_insert_own").
   */
  async register(input: {
    user_id: string;
    license_number: string;
    license_expiry?: string;
  }): Promise<Driver> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase
      .from('drivers')
      .insert({
        user_id: input.user_id,
        license_number: input.license_number,
        license_expiry: input.license_expiry ?? null,
        status: 'pending',
        rating: 0,
        total_rides: 0,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Updates client-editable driver fields only. Verification fields
   * (status, rating, total_rides, verified_at, rejection_reason) are
   * protected by a database trigger and will be rejected if sent.
   */
  async updateEditable(
    id: string,
    updates: Pick<Partial<Driver>, 'license_number' | 'license_expiry'>,
  ): Promise<Driver> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase
      .from('drivers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Verified drivers only — used when a driver goes online. */
  async getVerifiedDrivers(): Promise<Driver[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('drivers')
      .select('*')
      .eq('status', 'verified');
    if (error) throw error;
    return data || [];
  },

  async getAmbulances(driverId: string): Promise<Ambulance[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('ambulances')
      .select('*')
      .eq('driver_id', driverId);
    if (error) throw error;
    return data || [];
  },
};
