import { supabase, isSupabaseConfigured } from './client';

export interface RatingInput {
  booking_id: string;
  user_id: string;
  driver_id: string;
  rating: number;
  feedback?: string;
  tip_amount?: number;
}

export interface Rating extends RatingInput {
  id: string;
  created_at: string;
}

export const ratingsService = {
  /**
   * Creates a rating for a completed booking. The ratings table has a
   * unique constraint on booking_id, so a booking can only be rated once.
   */
  async create(input: RatingInput): Promise<Rating> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase.from('ratings').insert(input).select().single();
    if (error) throw error;
    return data;
  },

  async getByBooking(bookingId: string): Promise<Rating | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('ratings')
      .select('*')
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
};
