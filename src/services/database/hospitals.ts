import { supabase, isSupabaseConfigured } from './client';
import { Hospital } from '../../types';

/**
 * Hospital directory (public read-only table; writes are admin-only in the
 * database, so this service only reads).
 */
export const hospitalsService = {
  /** Search by name or address. An empty query returns the first `limit` rows. */
  async search(query: string, limit = 30): Promise<Hospital[]> {
    if (!isSupabaseConfigured) return [];
    // Strip PostgREST filter punctuation from user input before building the
    // `or` expression so a stray comma or bracket cannot change the query.
    const q = query.trim().replace(/[,()%]/g, ' ').trim();
    let request = supabase
      .from('hospitals')
      .select('*')
      .order('name', { ascending: true })
      .limit(limit);
    if (q) {
      request = request.or(`name.ilike.%${q}%,address.ilike.%${q}%`);
    }
    const { data, error } = await request;
    if (error) throw error;
    return (data as Hospital[]) || [];
  },

  async getById(id: string): Promise<Hospital | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase
      .from('hospitals')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Hospital) || null;
  },
};
