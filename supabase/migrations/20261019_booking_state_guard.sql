-- ============================================================================
-- RESQ Nepal — Forward-only Migration: Booking State-Machine & Authorization Guard
-- ============================================================================
-- Closes the P1 booking update authorization gap (O-1) documented in
-- docs/resq-comprehensive-engineering-audit.md and docs/known-limitations.md §16.
--
-- Rationale:
--   `public.bookings` policy `bookings_update_involved` previously allowed any
--   involved user (patient owner or assigned driver) to update *any* column on a
--   booking row. This migration adds a BEFORE INSERT OR UPDATE trigger that
--   enforces state transitions and field-level write protection at the database
--   layer.
--
-- Enforcement rules:
--   1. TRUSTED CONTEXTS (service-role, SQL editor, migrations, internal functions):
--      When `auth.uid()` is null, all updates/inserts are permitted (bypassed).
--   2. INSERT (authenticated client):
--      - Must belong to the caller (`user_id = auth.uid()`).
--      - Must start in the `'pending'` state.
--      - Driver and ambulance attribution must be NULL (assigned upon acceptance).
--      - Final fare must be NULL.
--   3. UPDATE — NO-OP (idempotent double taps):
--      - If `status`, `driver_id`, `ambulance_id`, and `cancel_reason` are unchanged
--        and no protected columns are modified, allowed for involved accounts.
--   4. UPDATE — REFERENTIAL DELETE CASCADE:
--      - If `ambulance_id` is cleared to NULL because the underlying ambulance was
--        deleted by its owner (`ambulances_delete_own`), allowed.
--   5. UPDATE — VERIFIED DRIVER TAKEOVER (RPC path `accept_booking`):
--      - `pending -> assigned` permitted only when the caller is a verified driver
--        attributing the booking to themselves (`driver_id = actor_driver_id`),
--        with ownership check on the ambulance.
--   6. UPDATE — PATIENT OWNER:
--      - May cancel active/pending trips (`pending`, `assigned`, `arriving`,
--        `arrived`, `started -> cancelled`).
--      - May set `cancel_reason` only during cancellation.
--      - Cannot modify protected fields, driver attribution, or fare.
--   7. UPDATE — ASSIGNED DRIVER TRIP PROGRESS:
--      - Permitted transitions:
--          `assigned -> arriving` OR `assigned -> arrived`
--          `arriving -> arrived`
--          `arrived  -> started`
--          `started  -> completed`
--      - Cannot modify driver attribution, ambulance, or protected fields.
--
-- Re-application safety:
--   `create or replace function` + `drop trigger if exists` makes this script
--   idempotent and safe to re-run (matches the identity migrations).
-- ============================================================================

create or replace function public.enforce_booking_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_actor_driver uuid;
  v_actor_verified boolean := false;
  v_owner boolean;
  v_assigned_driver boolean;
  v_protected_changed boolean;
begin
  -- 1. Trusted / maintenance / service-role context (no JWT sub)
  if v_uid is null then
    return new;
  end if;

  -- 2. INSERT validation
  if tg_op = 'INSERT' then
    if new.user_id is distinct from v_uid then
      raise exception 'booking must belong to the authenticated account' using errcode = '42501';
    end if;
    if new.status is distinct from 'pending' then
      raise exception 'new bookings must start in pending state' using errcode = '42501';
    end if;
    if new.driver_id is not null or new.ambulance_id is not null then
      raise exception 'driver and ambulance attribution is set by the accepting driver' using errcode = '42501';
    end if;
    if new.final_fare is not null then
      raise exception 'final fare is recorded by the server when the trip completes' using errcode = '42501';
    end if;
    return new;
  end if;

  -- 3. UPDATE context: identify actor and relationship
  select d.id, (d.status = 'verified')
    into v_actor_driver, v_actor_verified
  from public.drivers d
  where d.user_id = v_uid
  limit 1;

  v_owner := (old.user_id = v_uid);
  v_assigned_driver := (v_actor_driver is not null and old.driver_id = v_actor_driver);

  if not (v_owner or v_assigned_driver
          or (v_actor_driver is not null and new.driver_id = v_actor_driver)) then
    raise exception 'booking update not allowed for this account' using errcode = '42501';
  end if;

  -- Protected columns that no client may modify after initial creation
  v_protected_changed :=
       new.user_id is distinct from old.user_id
    or new.category is distinct from old.category
    or new.pickup_address is distinct from old.pickup_address
    or new.pickup_lat is distinct from old.pickup_lat
    or new.pickup_lng is distinct from old.pickup_lng
    or new.destination_address is distinct from old.destination_address
    or new.dest_lat is distinct from old.dest_lat
    or new.dest_lng is distinct from old.dest_lng
    or new.patient_name is distinct from old.patient_name
    or new.patient_age is distinct from old.patient_age
    or new.patient_condition is distinct from old.patient_condition
    or new.patient_phone is distinct from old.patient_phone
    or new.emergency_level is distinct from old.emergency_level
    or new.estimated_fare is distinct from old.estimated_fare
    or new.final_fare is distinct from old.final_fare
    or new.distance_km is distinct from old.distance_km
    or new.duration_min is distinct from old.duration_min
    or new.payment_method is distinct from old.payment_method
    or new.notes is distinct from old.notes
    or new.id is distinct from old.id
    or new.created_at is distinct from old.created_at;

  -- Idempotent no-op check (e.g. double-tap requests with unchanged values)
  if new.status is not distinct from old.status
     and new.driver_id is not distinct from old.driver_id
     and new.ambulance_id is not distinct from old.ambulance_id
     and new.cancel_reason is not distinct from old.cancel_reason
     and not v_protected_changed then
    return new;
  end if;

  -- Referential cascade cleanup: vehicle deleted by owner clears ambulance_id reference
  if new.ambulance_id is null
     and old.ambulance_id is not null
     and new.driver_id is not distinct from old.driver_id
     and new.status is not distinct from old.status
     and not v_protected_changed
     and not exists (select 1 from public.ambulances a where a.id = old.ambulance_id) then
    return new;
  end if;

  -- Verified driver taking a pending booking (RPC path: accept_booking)
  if v_actor_driver is not null
     and v_actor_verified
     and old.status = 'pending'
     and old.driver_id is null
     and new.status = 'assigned'
     and new.driver_id = v_actor_driver then
    if new.ambulance_id is not null
       and not exists (
         select 1 from public.ambulances a
         where a.id = new.ambulance_id and a.driver_id = v_actor_driver
       ) then
      raise exception 'ambulance does not belong to this driver' using errcode = '42501';
    end if;
    if v_protected_changed then
      raise exception 'protected booking fields cannot change on acceptance' using errcode = '42501';
    end if;
    if new.cancel_reason is distinct from old.cancel_reason then
      raise exception 'cancel reason is not set by the driver' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Patient owner actions (cancellation)
  if v_owner then
    if new.status = 'cancelled'
       and old.status in ('pending', 'assigned', 'arriving', 'arrived', 'started') then
      if new.driver_id is distinct from old.driver_id
         or new.ambulance_id is distinct from old.ambulance_id
         or v_protected_changed then
        raise exception 'protected booking fields cannot change on cancellation' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'booking status transition from % to % is not allowed for the booking owner',
      old.status, new.status using errcode = '42501';
  end if;

  -- Assigned driver trip progress actions
  if v_assigned_driver then
    if (old.status = 'assigned' and new.status in ('arriving', 'arrived'))
       or (old.status = 'arriving' and new.status = 'arrived')
       or (old.status = 'arrived' and new.status = 'started')
       or (old.status = 'started' and new.status = 'completed') then
      if new.driver_id is distinct from old.driver_id
         or new.ambulance_id is distinct from old.ambulance_id
         or v_protected_changed then
        raise exception 'protected booking fields cannot change during trip progress' using errcode = '42501';
      end if;
      if new.cancel_reason is distinct from old.cancel_reason then
        raise exception 'cancel reason is not set by the driver' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'booking status transition from % to % is not allowed for the assigned driver',
      old.status, new.status using errcode = '42501';
  end if;

  raise exception 'booking update not allowed for this account and state' using errcode = '42501';
end;
$$;

drop trigger if exists bookings_guard_writes on public.bookings;
create trigger bookings_guard_writes
  before insert or update on public.bookings
  for each row execute function public.enforce_booking_write_guard();

revoke all on function public.enforce_booking_write_guard() from public, anon, authenticated;
