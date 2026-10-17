import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * The Supabase client is only created when credentials are present —
 * `createClient('', '')` throws ("supabaseUrl is required") and would crash
 * the app at startup in sample mode.
 *
 * Without credentials this is `null`. Every service method checks
 * `isSupabaseConfigured` before touching the client, so it is never
 * dereferenced in sample mode.
 *
 * Sessions persist through AsyncStorage so a signed-in user survives app
 * restarts; refresh tokens are rotated automatically. `detectSessionInUrl`
 * is disabled because that flow is web-only and misbehaves in React Native.
 */
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : (null as unknown as SupabaseClient);
