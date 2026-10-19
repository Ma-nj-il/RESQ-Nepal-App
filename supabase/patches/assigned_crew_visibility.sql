-- ============================================================================
-- ASSIGNED-CREW VISIBILITY — REVIEWED, NOT YET APPLIED TO THE HOSTED PROJECT
-- ============================================================================
-- Why this exists
-- ---------------
-- The patient's booking screen should show the assigned driver (display name,
-- avatar, confirmed verification) and the assigned ambulance's registration
-- number, and the "Call Driver" button needs the crew's contact number to
-- open the device dialer. With the CURRENT policies this is impossible for a
-- patient client, by design:
--
--   * profiles : "profiles_select_own"  — only the signed-in user's own row;
--   * drivers  : "drivers_select_own"   — only the driver's own row;
--   * ambulances: "ambulances_select_available" — only status = 'available'
--     (an assigned ambulance is normally 'busy') or the owning driver.
--
-- The patient CAN see their own booking row (bookings_select_involved), which
-- is what tells the app that driver_id / ambulance_id were assigned — so the
-- UI can be fully honest today. What is missing is a safe, minimal, targeted
-- read path for the three related rows, scoped to the patient's own booking.
--
-- This patch adds exactly that, as a read-only SECURITY DEFINER function. It
-- does NOT widen any table policy and exposes nothing to listing:
--
--   * returns rows only when bookings.user_id = auth.uid() (the caller owns
--     the booking);
--   * returns rows only while a driver is actually assigned
--     (status in assigned/arriving/arrived/started/completed — never for
--     pending/cancelled/rejected bookings);
--   * the contact phone is returned ONLY while the trip is operationally
--     active (assigned..started), because that is the only window in which
--     the patient legitimately needs to call the crew. Completed trips keep
--     name/plate for the patient's own history but not the phone number;
--   * the function is STABLE and read-only — it cannot write anything.
--
-- What the app does until this is deployed (documented in
-- docs/known-limitations.md §13): the crew card shows neutral fallbacks and
-- "Call Driver" answers with "Driver contact is currently unavailable".
-- Nothing is faked and no policy is bypassed client-side.
--
-- Validation status (2026-10-19) — reviewed and executed on a LOCAL
-- PostgreSQL 15.8 instance with the exact schema from supabase/schema.sql
-- (auth schema stubbed per the notes in verify_assigned_crew_visibility.sql):
--   * booking owner + assigned crew -> exactly the assigned driver's name,
--     avatar, verification flag and plate are returned (1 row);
--   * the same patient cannot read ANY row for another patient's booking;
--   * a booking still pending, cancelled or rejected returns 0 rows even
--     with a driver_id attached;
--   * the contact phone is returned while the trip is active and NULL once
--     it is completed;
--   * a driver calling the function for their own booking gets 0 rows
--     (the function serves the patient side only);
--   * anon (no JWT) gets 0 rows and, with the revoke below, no EXECUTE;
--   * no table, policy, trigger or existing function was changed.
-- Deployment of this patch was NOT performed against the hosted project:
-- it requires the SQL Editor (manual step) or an owner/service-role
-- connection with DDL rights.
--
-- How to deploy (manual, ~1 minute):
--   1. Supabase Dashboard -> SQL Editor -> New query.
--   2. Paste everything after this header and click Run.
--      Expected: "Success. No rows returned".
--   3. Verify (same query window; replace the booking id with one of your
--      own assigned bookings, as the patient):
--        select * from public.get_assigned_crew('<booking-uuid>');
--      Expected: one row for your assigned booking, zero rows for anything
--      else. Optionally run
--      supabase/patches/verify_assigned_crew_visibility.sql for a full,
--      zero-side-effect behavioural check.
--
-- Rollback:  drop function if exists public.get_assigned_crew(uuid);
-- ============================================================================
create or replace function public.get_assigned_crew(p_booking_id uuid)
returns table (
  driver_name text,
  driver_avatar_url text,
  driver_verified boolean,
  driver_phone text,
  plate_number text,
  ambulance_model text,
  ambulance_category text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.full_name,
    p.avatar_url,
    (d.status = 'verified') as driver_verified,
    case
      when b.status in ('assigned', 'arriving', 'arrived', 'started')
        then nullif(p.phone, '')
      else null
    end as driver_phone,
    a.plate_number,
    a.model,
    a.category
  from public.bookings b
  join public.drivers d on d.id = b.driver_id
  join public.profiles p on p.id = d.user_id
  left join public.ambulances a on a.id = b.ambulance_id
  where b.id = p_booking_id
    and b.user_id = auth.uid()
    and b.driver_id is not null
    and b.status in ('assigned', 'arriving', 'arrived', 'started', 'completed');
$$;

-- Minimal surface: authenticated users call it; anon has no reason to.
revoke all on function public.get_assigned_crew(uuid) from public, anon;
grant execute on function public.get_assigned_crew(uuid) to authenticated;
