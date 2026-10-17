import { supabase, isSupabaseConfigured } from '../database/client';
import { profilesService } from '../database/profiles';
import { User, UserMode } from '../../types';

export interface AuthResult {
  success: boolean;
  message?: string;
  userId?: string;
}

/**
 * Thin wrapper around Supabase Auth phone-OTP flows.
 *
 * When Supabase is not configured (no .env credentials), every function
 * reports `success: false` with a clear message. The UI then shows a
 * development notice instead of fabricating a verified session.
 */
export const authService = {
  isConfigured: () => isSupabaseConfigured,

  async signInWithOtp(phone: string): Promise<AuthResult> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        message: 'Database/auth provider not configured. Add Supabase credentials to .env.',
      };
    }
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) return { success: false, message: error.message };
    return { success: true };
  },

  async verifyOtp(phone: string, token: string): Promise<AuthResult> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        message: 'Database/auth provider not configured. Add Supabase credentials to .env.',
      };
    }
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });
    if (error) return { success: false, message: error.message };
    return { success: true, userId: data.user?.id };
  },

  /**
   * Sets or updates the password for the signed-in account. Phone-OTP
   * accounts start without a password; this attaches one that will be usable
   * once password sign-in is enabled.
   */
  async updatePassword(password: string): Promise<AuthResult> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        message: 'Database/auth provider not configured. Add Supabase credentials to .env.',
      };
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { success: false, message: error.message };
    return { success: true };
  },

  async signOut(): Promise<void> {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async getSession() {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session;
  },

  /**
   * Restores a persisted session on app start. Returns the signed-in user's
   * profile (or a minimal user built from the session) when a valid session
   * exists, and null when the user is signed out or Supabase is not
   * configured.
   */
  async restoreSession(): Promise<{ user: User; mode: UserMode } | null> {
    if (!isSupabaseConfigured) return null;
    const session = await this.getSession();
    if (!session) return null;
    const authUser = session.user;
    try {
      const profile = await profilesService.getById(authUser.id);
      if (profile) {
        return { user: profile, mode: profile.mode === 'driver' ? 'driver' : 'user' };
      }
    } catch {
      // Profile fetch failed (network/RLS) — fall back to a minimal user so
      // the session is still usable; screens will fetch their own data.
    }
    return {
      user: {
        id: authUser.id,
        full_name: '',
        email: authUser.email ?? '',
        phone: authUser.phone ?? '',
        mode: 'user',
        created_at: '',
        updated_at: '',
      },
      mode: 'user',
    };
  },

  onAuthStateChange(callback: (userId: string | null) => void) {
    if (!isSupabaseConfigured) return { unsubscribe: () => {} };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user?.id ?? null);
    });
    return data.subscription;
  },
};
