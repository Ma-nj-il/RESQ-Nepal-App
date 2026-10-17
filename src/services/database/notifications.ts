import { supabase, isSupabaseConfigured } from './client';
import { Notification } from '../../types';

export const notificationsService = {
  async getByUser(userId: string): Promise<Notification[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async markRead(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
    if (error) throw error;
  },
  async create(notification: Partial<Notification>): Promise<Notification> {
    if (!isSupabaseConfigured) throw new Error('Database not configured');
    const { data, error } = await supabase.from('notifications').insert(notification).select().single();
    if (error) throw error;
    return data;
  },
};
