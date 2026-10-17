-- ============================================================================
-- RESQ Nepal — Destructive reset
-- ============================================================================
-- WARNING: this permanently deletes every object created by
-- supabase/schema.sql — including ALL RESQ Nepal data (profiles, drivers,
-- ambulances, bookings, ratings, ...). There is no undo.
--
-- Only run this when BOTH of these are true:
--   1. The project is dedicated to RESQ Nepal (no other application uses it).
--   2. You accept losing all data in the tables listed below.
--
-- Do NOT run it on a project that also hosts another application: tables such
-- as `drivers` and `ambulances` are common names and WILL be dropped even if
-- the other app created them.
--
-- Typical use: the project contains leftovers from an older RESQ Nepal
-- schema and re-running supabase/schema.sql aborts with a "RESQ Nepal schema
-- conflict" error. Run this file first, then re-run supabase/schema.sql.
-- ============================================================================

-- 1. Trigger on Supabase-managed auth schema
drop trigger if exists on_auth_user_created on auth.users;

-- 2. Tables created by schema.sql (child tables first; CASCADE for safety).
--    Dropping the tables also removes the triggers defined on them, which is
--    required before the trigger functions can be dropped below.
drop table if exists public.support_requests cascade;
drop table if exists public.saved_places cascade;
drop table if exists public.notifications cascade;
drop table if exists public.ratings cascade;
drop table if exists public.trip_locations cascade;
drop table if exists public.booking_status_history cascade;
drop table if exists public.bookings cascade;
drop table if exists public.ambulances cascade;
drop table if exists public.driver_verifications cascade;
drop table if exists public.drivers cascade;
drop table if exists public.hospitals cascade;
drop table if exists public.profiles cascade;

-- 3. Functions created by schema.sql (their triggers went with the tables;
--    `accept_booking` may already have been dropped by the CASCADE above).
drop function if exists public.accept_booking(uuid, uuid);
drop function if exists public.update_driver_rating();
drop function if exists public.log_booking_status();
drop function if exists public.protect_driver_fields();
drop function if exists public.handle_new_user();
drop function if exists public.set_updated_at();

-- The `uuid-ossp` extension is intentionally left in place.
