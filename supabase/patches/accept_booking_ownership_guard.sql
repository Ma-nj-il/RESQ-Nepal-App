-- ============================================================================
-- HARDENING PATCH — REVIEWED, NOT YET APPLIED TO THE HOSTED PROJECT
-- ============================================================================
-- The audit found that `accept_booking(p_booking_id, p_ambulance_id)` stored
-- whatever ambulance id the caller sent. The mobile app always sends the
-- driver's own ambulance id, but a modified client could pass somebody
-- else's ambulance id and mis-attribute the booking.
--
-- This patch adds a guard that verifies the supplied ambulance belongs to the
-- accepting (verified) driver, using only the authenticated identity
-- (`auth.uid()`) and the drivers -> ambulances relationship. The
-- client-supplied ambulance id is never trusted for authorization.
--
-- Validation status (2026-10-17) — reviewed and executed on a LOCAL
-- PostgreSQL 15.8 instance with the exact schema from supabase/schema.sql:
--   * pre-patch reproduction: a verified driver accepting with another
--     driver's ambulance succeeded (the gap being fixed);
--   * post-patch: the same attempt raises
--     'ambulance does not belong to this driver' and leaves the booking
--     untouched (status still 'pending', no history row);
--   * legitimate acceptance with the driver's own ambulance still succeeds;
--   * double acceptance still raises 'booking is no longer available';
--   * unverified drivers still raise 'only verified drivers can accept bookings';
--   * ambulance_id = NULL still works (unchanged back-compat behaviour);
--   * `security definer` and `set search_path = public` are preserved;
--   * EXECUTE grants (authenticated/anon) are preserved — CREATE OR REPLACE
--     keeps the existing ACL on an unchanged signature;
--   * only this one function changed — every other function, table, policy
--     and trigger was byte-identical before/after, and an unrelated table's
--     data was untouched.
-- The hosted project was NOT modified: deployment requires the SQL Editor
-- (manual step) or an owner/service-role connection with DDL rights.
--
-- How to deploy (manual, ~1 minute):
--   1. Supabase Dashboard -> SQL Editor -> New query.
--   2. First save the CURRENT definition for rollback:
--        select pg_get_functiondef('public.accept_booking(uuid,uuid)'::regprocedure);
--   3. Paste the entire `create or replace function` statement below
--      (everything after this header) and click Run.
--      Expected: "Success. No rows returned".
--   4. Verify (same query window):
--        select md5(pg_get_functiondef('public.accept_booking(uuid,uuid)'::regprocedure));
--      On PostgreSQL 15 this returns 623c511c1b7e9f30678e326f1d5c352f.
--      If your value differs (different PG major pretty-printing), confirm the
--      body contains the guard: 'ambulance does not belong to this driver'.
--   5. Optional full behavioural check with ZERO side effects (everything is
--      rolled back): run supabase/patches/verify_accept_booking_ownership.sql
--      in the same SQL Editor.
--
-- Rollback: re-run the `accept_booking` section of supabase/schema.sql
-- (identical to the definition saved in step 2).
-- ============================================================================
create or replace function public.accept_booking(p_booking_id uuid, p_ambulance_id uuid)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_driver_id uuid;
  v_booking public.bookings;
begin
  select d.id into v_driver_id
  from public.drivers d
  where d.user_id = auth.uid() and d.status = 'verified';

  if v_driver_id is null then
    raise exception 'only verified drivers can accept bookings';
  end if;

  -- New guard: the ambulance (when provided) must belong to this driver.
  if p_ambulance_id is not null then
    if not exists (
      select 1
      from public.ambulances a
      where a.id = p_ambulance_id
        and a.driver_id = v_driver_id
    ) then
      raise exception 'ambulance does not belong to this driver';
    end if;
  end if;

  update public.bookings
  set status = 'assigned',
      driver_id = v_driver_id,
      ambulance_id = p_ambulance_id
  where id = p_booking_id and status = 'pending'
  returning * into v_booking;

  if v_booking.id is null then
    raise exception 'booking is no longer available';
  end if;

  return v_booking;
end;
$$;
