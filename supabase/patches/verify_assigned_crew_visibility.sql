-- ============================================================================
-- assigned-crew visibility — full behavioural verification (SAFE TO RUN)
-- ============================================================================
-- Run this AFTER applying supabase/patches/assigned_crew_visibility.sql.
--
-- Everything happens inside ONE transaction that is ROLLED BACK at the end.
-- Nothing is committed: the throwaway users/drivers/ambulances/bookings
-- vanish when the script finishes. There is no destructive statement.
--
-- Requires: Supabase SQL Editor (or psql) as the project owner (postgres).
--
-- Expected output: eight "CHECK n PASSED" notices, then one row
-- "ALL CHECKS PASSED". If a check fails, the script stops with an explicit
-- error and nothing can be committed; run `rollback;` once to clear the
-- session.
--
-- Note on `set local role authenticated` + the `request.jwt.claims` GUC:
-- this is the documented Supabase technique to simulate a signed-in user for
-- RLS/function testing without creating real accounts.
--
-- If `insert into auth.users` is rejected in your project, create the three
-- users via Dashboard -> Authentication -> Users -> "Add user", then replace
-- the `insert into auth.users` block below with comments and re-run.
--
-- Validation history: this exact script was executed on a LOCAL PostgreSQL
-- 15.8 instance (with the auth schema stubbed: auth.users table plus an
-- auth.uid() reading the same request.jwt.claims GUC) against the schema from
-- supabase/schema.sql and the patch; all checks passed and the transaction
-- rolled back cleanly.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Fixtures (as the postgres owner; RLS is bypassed by the owner role).
--  - Patient A owns an assigned, a pending, a completed and a cancelled
--    booking; Patient B owns an assigned booking.
--  - Driver A is verified, has a profile name/phone/avatar and a 'busy'
--    (i.e. assigned) ambulance.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('1a000000-0000-4000-8000-000000000001', 'verify-crew-patient-a@example.test', '{"full_name":"Verify Patient A"}'),
  ('1a000000-0000-4000-8000-000000000002', 'verify-crew-patient-b@example.test', '{"full_name":"Verify Patient B"}'),
  ('1a000000-0000-4000-8000-000000000003', 'verify-crew-driver-a@example.test', '{"full_name":"Verify Driver A"}');

update public.profiles
   set full_name = 'Verify Driver A',
       phone = '+9779812345678',
       avatar_url = 'https://example.test/verify-a.png'
 where id = '1a000000-0000-4000-8000-000000000003';

insert into public.drivers (id, user_id, license_number, status, verified_at) values
  ('1d000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000003',
   'VERIFY-CREW-A', 'verified', now());

insert into public.ambulances (id, driver_id, category, plate_number, model, status) values
  ('1e000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000001',
   'icu', 'VERIFY BA 2 KHA 4321', 'Verify Model', 'busy');

insert into public.bookings (id, user_id, driver_id, ambulance_id, category, pickup_address, destination_address, status) values
  ('1f000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
   '1d000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001',
   'icu', 'Verify pickup assigned', 'Verify dest assigned', 'assigned'),
  ('1f000000-0000-4000-8000-000000000002', '1a000000-0000-4000-8000-000000000001',
   '1d000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001',
   'icu', 'Verify pickup pending', 'Verify dest pending', 'pending'),
  ('1f000000-0000-4000-8000-000000000003', '1a000000-0000-4000-8000-000000000001',
   '1d000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001',
   'icu', 'Verify pickup completed', 'Verify dest completed', 'completed'),
  ('1f000000-0000-4000-8000-000000000004', '1a000000-0000-4000-8000-000000000002',
   '1d000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001',
   'icu', 'Verify pickup other patient', 'Verify dest other patient', 'assigned'),
  ('1f000000-0000-4000-8000-000000000005', '1a000000-0000-4000-8000-000000000001',
   '1d000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001',
   'icu', 'Verify pickup cancelled', 'Verify dest cancelled', 'cancelled');

-- ---------------------------------------------------------------------------
-- CHECKS 1-5 — as Patient A (owner of the assigned booking)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1a000000-0000-4000-8000-000000000001"}';

do $$
declare
  c int;
  r record;
begin
  -- CHECK 1 — exactly one row for the assigned booking
  select count(*) into c from public.get_assigned_crew('1f000000-0000-4000-8000-000000000001');
  if c <> 1 then raise exception 'CHECK 1 FAILED: expected 1 row, got %', c; end if;
  raise notice 'CHECK 1 PASSED: assigned booking returns exactly 1 row';

  -- CHECK 1b — the row carries the real details of the assigned crew
  select * into r from public.get_assigned_crew('1f000000-0000-4000-8000-000000000001');
  if r.driver_name is distinct from 'Verify Driver A'
     or r.driver_avatar_url is distinct from 'https://example.test/verify-a.png'
     or r.driver_verified is not true
     or r.driver_phone is distinct from '+9779812345678'
     or r.plate_number is distinct from 'VERIFY BA 2 KHA 4321'
     or r.ambulance_model is distinct from 'Verify Model'
     or r.ambulance_category is distinct from 'icu' then
    raise exception 'CHECK 1b FAILED: unexpected row %', row_to_json(r);
  end if;
  raise notice 'CHECK 1b PASSED: crew details match the assigned rows';

  -- CHECK 2 — a pending booking (even with a driver_id) returns nothing
  select count(*) into c from public.get_assigned_crew('1f000000-0000-4000-8000-000000000002');
  if c <> 0 then raise exception 'CHECK 2 FAILED: pending booking returned % rows', c; end if;
  raise notice 'CHECK 2 PASSED: pending booking returns 0 rows';

  -- CHECK 3 — a cancelled booking returns nothing
  select count(*) into c from public.get_assigned_crew('1f000000-0000-4000-8000-000000000005');
  if c <> 0 then raise exception 'CHECK 3 FAILED: cancelled booking returned % rows', c; end if;
  raise notice 'CHECK 3 PASSED: cancelled booking returns 0 rows';

  -- CHECK 4 — a completed booking keeps name/plate for history but never the phone
  select * into r from public.get_assigned_crew('1f000000-0000-4000-8000-000000000003');
  if r.driver_name is distinct from 'Verify Driver A'
     or r.plate_number is distinct from 'VERIFY BA 2 KHA 4321'
     or r.driver_phone is not null then
    raise exception 'CHECK 4 FAILED: completed booking row %', row_to_json(r);
  end if;
  raise notice 'CHECK 4 PASSED: completed booking has no contact number';

  -- CHECK 5 — another patient's booking is invisible
  select count(*) into c from public.get_assigned_crew('1f000000-0000-4000-8000-000000000004');
  if c <> 0 then raise exception 'CHECK 5 FAILED: other patient''s booking returned % rows', c; end if;
  raise notice 'CHECK 5 PASSED: another patient''s booking returns 0 rows';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- CHECK 6 — the driver side gets nothing for the patient's booking
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1a000000-0000-4000-8000-000000000003"}';

do $$
declare
  c int;
begin
  select count(*) into c from public.get_assigned_crew('1f000000-0000-4000-8000-000000000001');
  if c <> 0 then raise exception 'CHECK 6 FAILED: driver got % rows', c; end if;
  raise notice 'CHECK 6 PASSED: the function serves only the booking patient';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- CHECK 7 — anon has no EXECUTE privilege on the function
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '';

do $$
begin
  begin
    perform count(*) from public.get_assigned_crew('1f000000-0000-4000-8000-000000000001');
    raise exception 'CHECK 7 FAILED: anon could execute get_assigned_crew';
  exception
    when insufficient_privilege then
      raise notice 'CHECK 7 PASSED: anon cannot execute get_assigned_crew';
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Done — discard every fixture created above.
-- ---------------------------------------------------------------------------
select 'ALL CHECKS PASSED — rolling back throwaway fixtures (nothing kept)' as result;

rollback;
