import { supabase, isSupabaseConfigured } from './client';
import { Booking, BookingStatus } from '../../types';

export const bookingsService = {
  async create(booking: Partial<Booking>): Promise<Booking> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase.from('bookings').insert(booking).select().single();
    if (error) throw error;
    return data;
  },
  async getById(id: string): Promise<Booking | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase.from('bookings').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },
  async getByUser(userId: string): Promise<Booking[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.from('bookings').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async getByDriver(driverId: string): Promise<Booking[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.from('bookings').select('*').eq('driver_id', driverId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async getPending(): Promise<Booking[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.from('bookings').select('*').eq('status', 'pending').order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },
  async updateStatus(id: string, status: BookingStatus): Promise<Booking> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase.from('bookings').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async cancel(id: string): Promise<Booking> {
    return this.updateStatus(id, 'cancelled');
  },
};
