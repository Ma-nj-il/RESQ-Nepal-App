import { supabase, isSupabaseConfigured } from './client';
import { SavedPlace } from '../../types';

export const savedPlacesService = {
  async getByUser(userId: string): Promise<SavedPlace[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('saved_places')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async create(place: Omit<SavedPlace, 'id' | 'created_at'>): Promise<SavedPlace> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase
      .from('saved_places')
      .insert(place)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(
    id: string,
    updates: Partial<Pick<SavedPlace, 'name' | 'address' | 'lat' | 'lng' | 'type'>>,
  ): Promise<SavedPlace> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase
      .from('saved_places')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async remove(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from('saved_places').delete().eq('id', id);
    if (error) throw error;
  },
};
