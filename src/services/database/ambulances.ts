import { supabase, isSupabaseConfigured } from './client';
import { Ambulance, AmbulanceCategory } from '../../types';

export const ambulancesService = {
  async getAll(): Promise<Ambulance[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.from('ambulances').select('*');
    if (error) throw error;
    return data || [];
  },
  async getByCategory(category: AmbulanceCategory): Promise<Ambulance[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.from('ambulances').select('*').eq('category', category);
    if (error) throw error;
    return data || [];
  },
  async getById(id: string): Promise<Ambulance | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase.from('ambulances').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },
  async create(ambulance: Omit<Ambulance, 'id' | 'created_at' | 'updated_at'>): Promise<Ambulance> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase.from('ambulances').insert(ambulance).select().single();
    if (error) throw error;
    return data;
  },
  async update(
    id: string,
    updates: Partial<Pick<Ambulance, 'category' | 'plate_number' | 'model' | 'color' | 'status' | 'equipment' | 'hospital_affiliation'>>
  ): Promise<Ambulance> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase
      .from('ambulances')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async remove(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from('ambulances').delete().eq('id', id);
    if (error) throw error;
  },
};
