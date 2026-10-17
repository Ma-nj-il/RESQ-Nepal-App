import { supabase, isSupabaseConfigured } from './client';
import { User } from '../../types';

export const profilesService = {
  async getById(id: string): Promise<User | null> {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },
  async create(profile: Partial<User>): Promise<User> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase.from('profiles').insert(profile).select().single();
    if (error) throw error;
    return data;
  },
  async update(id: string, updates: Partial<User>): Promise<User> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase.from('profiles').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
};
