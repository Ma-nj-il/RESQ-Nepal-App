-- ============================================================================
-- Booking State Machine & Authorization Guard — Regression Tests
-- ============================================================================
-- Tests positive (authorized) and negative (unauthorized / invalid state) cases
-- for the booking write authorization trigger (`enforce_booking_write_guard`).
--
-- Executed inside a single transaction that is ROLLED BACK at the end so it
-- leaves zero persistent changes in the local verification database.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- Create test accounts in auth.users
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'patient@resq.test', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'driver_verified@resq.test', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'driver_unverified@resq.test', '{}'),
  ('44444444-4444-4444-4444-444444444444', 'unrelated@resq.test', '{}');

-- Create profiles
insert into public.profiles (id, full_name, phone) values
  ('11111111-1111-1111-1111-111111111111', 'Test Patient', '+9779800000001'),
  ('22222222-2222-2222-2222-222222222222', 'Test Verified Driver', '+9779800000002'),
  ('33333333-3333-3333-3333-333333333333', 'Test Unverified Driver', '+9779800000003'),
  ('44444444-4444-4444-4444-444444444444', 'Test Unrelated', '+9779800000004');

-- Create driver profiles
insert into public.drivers (id, user_id, license_number, status) values
  ('aaaaaaa1-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'LIC-V-01', 'verified'),
  ('bbbbbbb2-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'LIC-U-02', 'pending');

-- Create an ambulance owned by the verified driver
insert into public.ambulances (id, driver_id, category, plate_number, model, status) values
  ('cccccccc-3333-3333-3333-333333333333', 'aaaaaaa1-1111-1111-1111-111111111111', 'basic', 'BA-1-CH-1234', 'Toyota HiAce', 'available');

-- Grant permissions for authenticated role
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ============================================================================
-- TEST 1: Patient creates a booking (positive)
-- ============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

insert into public.bookings (id, user_id, category, pickup_address, destination_address)
values ('dddddddd-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'basic', 'Thamel', 'Patan')
returning id;

\echo 'PASS: Patient created valid pending booking'

-- ============================================================================
-- TEST 2: Patient attempts to forge completed state on insert (negative)
-- ============================================================================
do $$
begin
  insert into public.bookings (user_id, category, pickup_address, destination_address, status)
  values ('11111111-1111-1111-1111-111111111111', 'basic', 'A', 'B', 'completed');
  raise exception 'Expected insertion with completed status to fail';
exception when others then
  if sqlerrm like '%pending state%' then
    -- expected
    null;
  else
    raise exception 'Unexpected error for forged insert: %', sqlerrm;
  end if;
end;
$$;
\echo 'PASS: Patient forged insert rejected'

-- ============================================================================
-- TEST 3: Verified driver accepts booking via RPC (positive)
-- ============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

select public.accept_booking('dddddddd-4444-4444-4444-444444444444', 'cccccccc-3333-3333-3333-333333333333');

\echo 'PASS: Verified driver accepted booking successfully'

-- ============================================================================
-- TEST 4: Patient attempts to alter assigned driver (negative)
-- ============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

do $$
begin
  update public.bookings
  set driver_id = null
  where id = 'dddddddd-4444-4444-4444-444444444444';
  raise exception 'Expected patient clearing driver_id to fail';
exception when others then
  if sqlerrm like '%protected booking fields%' or sqlerrm like '%not allowed%' then
    null;
  else
    raise exception 'Unexpected error for patient altering driver: %', sqlerrm;
  end if;
end;
$$;
\echo 'PASS: Patient altering driver rejected'

-- ============================================================================
-- TEST 5: Assigned driver progresses trip: assigned -> arrived -> started -> completed (positive)
-- ============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

update public.bookings set status = 'arrived' where id = 'dddddddd-4444-4444-4444-444444444444';
update public.bookings set status = 'started' where id = 'dddddddd-4444-4444-4444-444444444444';
update public.bookings set status = 'completed' where id = 'dddddddd-4444-4444-4444-444444444444';

\echo 'PASS: Driver successfully progressed trip through all phases to completion'

-- ============================================================================
-- TEST 6: Patient cancels a pending booking (positive test via a new booking)
-- ============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

insert into public.bookings (id, user_id, category, pickup_address, destination_address)
values ('eeeeeeee-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'icu', 'Airport', 'Hospital');

update public.bookings
set status = 'cancelled', cancel_reason = 'Patient changed mind'
where id = 'eeeeeeee-5555-5555-5555-555555555555';

\echo 'PASS: Patient successfully cancelled pending booking with reason'

rollback;
\echo 'ALL BOOKING STATE GUARD CHECKS PASSED'
