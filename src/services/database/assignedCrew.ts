import { supabase, isSupabaseConfigured } from './client';
import { bookingsService } from './bookings';
import { driversService } from './drivers';

/**
 * Assigned-crew lookup for the patient's own booking.
 *
 * Privacy rules applied here (see `docs/known-limitations.md` §13):
 * - Only the currently authenticated patient's booking is ever queried.
 * - Crew details (name, avatar, verification, contact number, plate) are
 *   resolved through the reviewed `get_assigned_crew` backend function
 *   (`supabase/patches/assigned_crew_visibility.sql`), which re-checks
 *   `bookings.user_id = auth.uid()` server-side.
 * - Until that function is deployed, the table policies do not expose other
 *   users' `profiles` / `drivers` / `ambulances` rows to a patient. The
 *   lookup then reports `source: 'restricted'` instead of inventing details —
 *   the UI shows neutral fallbacks and keeps the contact button honest.
 * - The contact number is returned for the native dialer only. It is never
 *   rendered as text in the patient UI and never logged.
 */
export type AssignedCrewSource = 'backend' | 'restricted' | 'none';

export interface AssignedCrew {
  /** True when the booking row itself records an assignment. */
  assigned: boolean;
  driverName: string | null;
  driverAvatarUrl: string | null;
  /** Only `true` when the database confirms the driver is verified. */
  driverVerified: boolean | null;
  /** Authorized contact number for the native dialer (never displayed). */
  driverPhone: string | null;
  plateNumber: string | null;
  model: string | null;
  /** Where the visible details came from. */
  source: AssignedCrewSource;
}

const EMPTY: AssignedCrew = {
  assigned: false,
  driverName: null,
  driverAvatarUrl: null,
  driverVerified: null,
  driverPhone: null,
  plateNumber: null,
  model: null,
  source: 'none',
};

interface AssignedCrewRow {
  driver_name: string | null;
  driver_avatar_url: string | null;
  driver_verified: boolean | null;
  driver_phone: string | null;
  plate_number: string | null;
  ambulance_model: string | null;
}

export const assignedCrewService = {
  async getForBooking(bookingId: string): Promise<AssignedCrew> {
    if (!isSupabaseConfigured || !bookingId) return EMPTY;

    // 1. Preferred path — the reviewed backend function. It returns rows only
    //    for the caller's own booking and only while a crew is assigned.
    try {
      const { data, error } = await supabase.rpc('get_assigned_crew', {
        p_booking_id: bookingId,
      });
      if (!error && Array.isArray(data) && data.length > 0) {
        const row = data[0] as AssignedCrewRow;
        return {
          assigned: true,
          driverName: row.driver_name?.trim() || null,
          driverAvatarUrl: row.driver_avatar_url || null,
          driverVerified: row.driver_verified === true ? true : null,
          driverPhone: row.driver_phone?.trim() || null,
          plateNumber: row.plate_number?.trim() || null,
          model: row.ambulance_model?.trim() || null,
          source: 'backend',
        };
      }
    } catch {
      // The function is optional until the patch is deployed — fall through.
    }

    // 2. Fallback — the booking row itself is readable by its owner, so we can
    //    at least confirm whether a driver/ambulance is attached.
    let booking;
    try {
      booking = await bookingsService.getById(bookingId);
    } catch {
      return EMPTY;
    }
    if (!booking || (!booking.driver_id && !booking.ambulance_id)) return EMPTY;

    const result: AssignedCrew = { ...EMPTY, assigned: true, source: 'restricted' };
    let hasDetails = false;

    if (booking.driver_id) {
      try {
        // `drivers_select_own` policy: usually readable only by the driver
        // themselves; when it is not, `maybeSingle` returns null quietly.
        const driver = await driversService.getById(booking.driver_id);
        if (driver) {
          result.driverVerified = driver.status === 'verified' ? true : null;
          try {
            const { data: profile } = await supabase
              .from('profiles')
              .select('full_name, avatar_url, phone')
              .eq('id', driver.user_id)
              .maybeSingle();
            if (profile) {
              result.driverName = profile.full_name?.trim() || null;
              result.driverAvatarUrl = profile.avatar_url || null;
              result.driverPhone = profile.phone?.trim() || null;
              hasDetails = hasDetails || Boolean(result.driverName || result.driverPhone);
            }
          } catch {
            // Profile not readable under current policies — stay restricted.
          }
        }
      } catch {
        // Driver row not readable under current policies — stay restricted.
      }
    }

    if (booking.ambulance_id) {
      try {
        const { data: ambulance } = await supabase
          .from('ambulances')
          .select('plate_number, model, category')
          .eq('id', booking.ambulance_id)
          .maybeSingle();
        if (ambulance) {
          result.plateNumber = ambulance.plate_number?.trim() || null;
          result.model = ambulance.model?.trim() || null;
          hasDetails = hasDetails || Boolean(result.plateNumber);
        }
      } catch {
        // Ambulance row not readable under current policies — stay restricted.
      }
    }

    if (hasDetails) result.source = 'backend';
    return result;
  },
};
