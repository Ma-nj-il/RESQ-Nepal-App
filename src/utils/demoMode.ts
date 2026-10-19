/**
 * Demo mode utilities.
 *
 * Demo mode is explicitly enabled via EXPO_PUBLIC_DEMO_MODE=true.
 * When enabled, it allows demo OTP and sample data regardless of Supabase config.
 * This allows running a full demo without sending real SMS.
 *
 * In demo mode:
 * - OTP "1234" is accepted for testing
 * - No real Supabase calls are made for auth
 * - Sample/demo states carry a compact, honest footnote where it matters
 *   (booking status, saved places, ratings) — no banners across the UI
 */

const DEMO_MODE_ENABLED = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';

/**
 * Returns true when the app should run in demo mode.
 * Demo mode activates when EXPO_PUBLIC_DEMO_MODE is explicitly set to "true",
 * regardless of Supabase configuration. This allows running a full demo
 * with real Supabase credentials present but without sending real SMS.
 */
export const isDemoMode = (): boolean => {
  return DEMO_MODE_ENABLED;
};

/**
 * Returns the demo OTP code that should be accepted in demo mode.
 */
export const DEMO_OTP_CODE = '1234';

/**
 * Checks if the provided OTP code is the valid demo code.
 */
export const isValidDemoOtp = (code: string): boolean => {
  return code === DEMO_OTP_CODE;
};