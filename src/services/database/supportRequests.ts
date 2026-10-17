import { supabase, isSupabaseConfigured } from './client';
import { SupportRequest } from '../../types';

/**
 * Support requests (account deactivation/deletion requests, help contacts).
 * Rows are insertable and readable by their owner only (RLS).
 */
export const supportRequestsService = {
  async create(input: Pick<SupportRequest, 'user_id' | 'subject' | 'message'>): Promise<SupportRequest> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase.from('support_requests').insert(input).select().single();
    if (error) throw error;
    return data;
  },

  async getByUser(userId: string): Promise<SupportRequest[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('support_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
};
