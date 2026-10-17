-- ============================================================================
-- accept_booking ownership — full behavioural verification (SAFE TO RUN)
-- ============================================================================
-- Run this AFTER applying supabase/patches/accept_booking_ownership_guard.sql.
--
-- Everything happens inside ONE transaction that is ROLLED BACK at the end.
-- Nothing is committed: the throwaway users/drivers/ambulances/bookings
-- vanish when the script finishes. There is no destructive statement.
--
-- Requires: Supabase SQL Editor (or psql) as the project owner (postgres).
--
-- Expected output: three "CHECK n PASSED" notices, then one row
-- "ALL CHECKS PASSED". If a check fails, the script stops with an explicit
-- error and nothing can be committed; run `rollback;` once to clear the
-- session.
--
-- Note on `set local role authenticated` + the `request.jwt.claims` GUC:
-- this is the documented Supabase technique to simulate a signed-in user for
-- RLS/function testing without creating real accounts.
--
-- If `insert into auth.users` is rejected in your project, create the three
-- users via Dashboard -> Authentication -> Users -> "Add user" (choose the
-- same emails, confirm them), then replace their UUIDs below with the real
-- ids and run again.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Throwaway fixtures (all rolled back at the end)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('0a000000-0000-4000-8000-000000000001', 'verify-driver-a@resq-verify.invalid',  '{"full_name":"Verify Driver A"}'),
  ('0a000000-0000-4000-8000-000000000002', 'verify-driver-b@resq-verify.invalid',  '{"full_name":"Verify Driver B"}'),
  ('0b000000-0000-4000-8000-000000000001', 'verify-passenger@resq-verify.invalid', '{"full_name":"Verify Passenger"}');

insert into public.drivers (id, user_id, license_number, status, verified_at) values
  ('0d000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'VERIFY-A', 'verified', now()),
  ('0d000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000002', 'VERIFY-B', 'verified', now());

insert into public.ambulances (id, driver_id, category, plate_number) values
  ('0e000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000001', 'basic', 'VERIFY-A-1'),
  ('0e000000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-000000000002', 'basic', 'VERIFY-B-1');

insert into public.bookings (id, user_id, category, pickup_address, destination_address, status) values
  ('0f000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 'basic', 'Verify pickup 1', 'Verify dest 1', 'pending'),
  ('0f000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000001', 'basic', 'Verify pickup 2', 'Verify dest 2', 'pending');

-- ---------------------------------------------------------------------------
-- CHECK 1 — Driver A must NOT be able to accept with Driver B's ambulance
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"0a000000-0000-4000-8000-000000000001"}';

do $$
begin
  begin
    perform public.accept_booking('0f000000-0000-4000-8000-000000000001',
                                  '0e000000-0000-4000-8000-000000000002');
    raise exception 'CHECK 1 FAILED: cross-driver acceptance was NOT blocked';
  exception
    when others then
      if sqlerrm like 'CHECK 1 FAILED%' then
        raise;
      elsif sqlerrm like '%ambulance does not belong to this driver%' then
        raise notice 'CHECK 1 PASSED: cross-driver ambulance rejected -> %', sqlerrm;
      else
        raise;  -- unexpected failure must surface loudly
      end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- CHECK 2 — Driver A CAN accept with their OWN ambulance
-- ---------------------------------------------------------------------------
do $$
declare
  r public.bookings;
begin
  select * into r
  from public.accept_booking('0f000000-0000-4000-8000-000000000001',
                             '0e000000-0000-4000-8000-000000000001');
  if r.status = 'assigned'
     and r.driver_id = '0d000000-0000-4000-8000-000000000001'
     and r.ambulance_id = '0e000000-0000-4000-8000-000000000001' then
    raise notice 'CHECK 2 PASSED: legitimate acceptance works (status=%, driver=%, ambulance=%)',
      r.status, r.driver_id, r.ambulance_id;
  else
    raise exception 'CHECK 2 FAILED: unexpected result status=% driver=% ambulance=%',
      r.status, r.driver_id, r.ambulance_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CHECK 3 — a second verified driver must NOT be able to take the same booking
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"0a000000-0000-4000-8000-000000000002"}';

do $$
begin
  begin
    perform public.accept_booking('0f000000-0000-4000-8000-000000000001',
                                  '0e000000-0000-4000-8000-000000000002');
    raise exception 'CHECK 3 FAILED: double acceptance was NOT blocked';
  exception
    when others then
      if sqlerrm like 'CHECK 3 FAILED%' then
        raise;
      elsif sqlerrm like '%booking is no longer available%' then
        raise notice 'CHECK 3 PASSED: double acceptance blocked -> %', sqlerrm;
      else
        raise;
      end if;
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Done — discard every fixture created above.
-- ---------------------------------------------------------------------------
select 'ALL CHECKS PASSED — rolling back throwaway fixtures (nothing kept)' as result;

rollback;
