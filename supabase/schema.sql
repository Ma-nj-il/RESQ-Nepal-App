-- ============================================================================
-- RESQ Nepal — Supabase Database Schema
-- ============================================================================
-- Run this file in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- It is idempotent: it can be re-run safely.
--
-- Security model:
--   * All tables have Row Level Security (RLS) enabled.
--   * Users can only read/write their own rows.
--   * Driver verification status can NOT be self-assigned. A trigger on
--     `drivers` rejects any client API attempt to change `status`, `rating`,
--     `total_rides`, `verified_at` or `rejection_reason`. An administrator
--     verifies drivers by updating the row directly in the SQL Editor
--     (see docs/database-setup.md §7). The mobile client can only insert a
--     driver profile with status 'pending'.
--   * Exclusive booking assignment cannot be guaranteed with client-only
--     code; see docs/known-limitations.md. The `accept_booking()` RPC
--     provides an atomic compare-and-set on the client-accessible path.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Preflight: refuse to run against a project that already contains tables
-- from another application. `create table if not exists` would silently skip
-- such tables and later statements (policies, indexes) would fail with
-- confusing errors such as `column "user_id" does not exist`.
-- ---------------------------------------------------------------------------
do $$
declare
  v_table_conflicts text;
  v_conflicts text[] := '{}';
begin
  select string_agg(
           format('public.%I is missing column "%s"', c.table_name, c.column_name),
           ', ' order by c.table_name)
    into v_table_conflicts
  from (values
    ('profiles', 'mode'),
    ('hospitals', 'name'),
    ('drivers', 'user_id'),
    ('driver_verifications', 'document_type'),
    ('ambulances', 'driver_id'),
    ('bookings', 'user_id'),
    ('booking_status_history', 'booking_id'),
    ('trip_locations', 'lat'),
    ('ratings', 'booking_id'),
    ('notifications', 'user_id'),
    ('saved_places', 'user_id'),
    ('support_requests', 'subject')
  ) as c(table_name, column_name)
  where to_regclass('public.' || c.table_name) is not null
    and not exists (
      select 1
      from information_schema.columns ic
      where ic.table_schema = 'public'
        and ic.table_name = c.table_name
        and ic.column_name = c.column_name
    );

  if v_table_conflicts is not null then
    v_conflicts := array_append(v_conflicts, v_table_conflicts);
  end if;

  -- The standard trigger name below is also used by many other apps to
  -- provision their own user rows; taking it over would break their signup.
  if to_regclass('public.profiles') is null and exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth'
        and c.relname = 'users'
        and t.tgname = 'on_auth_user_created'
        and not t.tgisinternal
    ) then
    v_conflicts := array_append(v_conflicts,
      'auth.users already has an "on_auth_user_created" trigger (another app provisions its users there)');
  end if;

  if array_length(v_conflicts, 1) > 0 then
    raise exception
      'RESQ Nepal schema conflict — this project already contains objects from another application: %. If those objects belong to a different app, create a dedicated Supabase project for RESQ Nepal and run this file there (recommended). If this project is only used for RESQ Nepal and its data is disposable, run supabase/reset.sql first, then re-run this file.',
      array_to_string(v_conflicts, '; ');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper: updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. profiles — one row per authenticated user
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text default '',
  phone text default '',
  avatar_url text,
  gender text,
  date_of_birth date,
  mode text not null default 'user' check (mode in ('user', 'driver')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile row on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.phone, new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 2. hospitals
-- ============================================================================
create table if not exists public.hospitals (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text not null default '',
  lat double precision,
  lng double precision,
  phone text,
  emergency_contact text,
  created_at timestamptz not null default now()
);

alter table public.hospitals enable row level security;

drop policy if exists "hospitals_read_all" on public.hospitals;
create policy "hospitals_read_all" on public.hospitals
  for select using (true);
-- Writes to hospitals are admin-only (no client write policy).

-- ============================================================================
-- 3. drivers — driver profile, verification gated
-- ============================================================================
create table if not exists public.drivers (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  license_number text not null default '',
  license_expiry date,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected')),
  rejection_reason text,
  rating numeric(3,2) not null default 0,
  total_rides integer not null default 0,
  hospital_id uuid references public.hospitals(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists drivers_updated_at on public.drivers;
create trigger drivers_updated_at
  before update on public.drivers
  for each row execute function public.set_updated_at();

alter table public.drivers enable row level security;

-- A driver can read and update their own row, but the WITH CHECK clause below
-- prevents them from changing `status`, `rating`, `total_rides` or
-- `verified_at` themselves. Those fields are protected with a trigger.
drop policy if exists "drivers_select_own" on public.drivers;
create policy "drivers_select_own" on public.drivers
  for select using (auth.uid() = user_id);

drop policy if exists "drivers_insert_own" on public.drivers;
create policy "drivers_insert_own" on public.drivers
  for insert with check (
    auth.uid() = user_id
    and status = 'pending'
    and rating = 0
    and total_rides = 0
    and verified_at is null
  );

drop policy if exists "drivers_update_own" on public.drivers;
create policy "drivers_update_own" on public.drivers
  for update using (auth.uid() = user_id);

-- Trigger: clients may NOT self-modify protected verification fields.
create or replace function public.protect_driver_fields()
returns trigger language plpgsql as $$
begin
  -- A trusted internal refresh (update_driver_rating) marks itself with a
  -- transaction-local flag: it runs inside a SECURITY DEFINER function that
  -- still carries the caller's JWT claims, so auth.uid() alone cannot tell
  -- internal updates apart from client API requests.
  if current_setting('resq.internal_update', true) = 'on' then
    return new;
  end if;

  -- Otherwise: allow the change only when the caller is the service role /
  -- admin (auth.uid() is null inside the SQL editor or service-role calls).
  if auth.uid() is not null then
    if new.status is distinct from old.status
       or new.rating is distinct from old.rating
       or new.total_rides is distinct from old.total_rides
       or new.verified_at is distinct from old.verified_at
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'driver verification fields are read-only for clients';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists drivers_protect_fields on public.drivers;
create trigger drivers_protect_fields
  before update on public.drivers
  for each row execute function public.protect_driver_fields();

-- ============================================================================
-- 4. driver_verifications — documents submitted for review
-- ============================================================================
create table if not exists public.driver_verifications (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  document_type text not null check (document_type in ('license', 'citizenship', 'vehicle_registration', 'insurance')),
  document_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.driver_verifications enable row level security;

drop policy if exists "driver_verifications_select_own" on public.driver_verifications;
create policy "driver_verifications_select_own" on public.driver_verifications
  for select using (
    exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.user_id = auth.uid()
    )
  );

drop policy if exists "driver_verifications_insert_own" on public.driver_verifications;
create policy "driver_verifications_insert_own" on public.driver_verifications
  for insert with check (
    status = 'pending'
    and exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.user_id = auth.uid()
    )
  );
-- Approvals happen server-side / via dashboard only.

-- ============================================================================
-- 5. ambulances
-- ============================================================================
create table if not exists public.ambulances (
  id uuid primary key default uuid_generate_v4(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  category text not null check (category in ('basic', 'icu')),
  plate_number text not null,
  model text not null default '',
  color text not null default 'White',
  status text not null default 'offline'
    check (status in ('available', 'busy', 'offline')),
  equipment text[] not null default '{}',
  hospital_affiliation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists ambulances_updated_at on public.ambulances;
create trigger ambulances_updated_at
  before update on public.ambulances
  for each row execute function public.set_updated_at();

alter table public.ambulances enable row level security;

-- Anyone authenticated can *see* available ambulances (needed to book),
-- but only the owning driver can modify their own.
drop policy if exists "ambulances_select_available" on public.ambulances;
create policy "ambulances_select_available" on public.ambulances
  for select using (
    status = 'available'
    or exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.user_id = auth.uid()
    )
  );

drop policy if exists "ambulances_insert_own" on public.ambulances;
create policy "ambulances_insert_own" on public.ambulances
  for insert with check (
    exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.user_id = auth.uid()
    )
  );

drop policy if exists "ambulances_update_own" on public.ambulances;
create policy "ambulances_update_own" on public.ambulances
  for update using (
    exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.user_id = auth.uid()
    )
  );

drop policy if exists "ambulances_delete_own" on public.ambulances;
create policy "ambulances_delete_own" on public.ambulances
  for delete using (
    exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 6. bookings
-- ============================================================================
create table if not exists public.bookings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  ambulance_id uuid references public.ambulances(id) on delete set null,
  category text not null check (category in ('basic', 'icu')),
  pickup_address text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  destination_address text not null,
  dest_lat double precision,
  dest_lng double precision,
  status text not null default 'pending' check (status in
    ('draft', 'pending', 'assigned', 'arriving', 'arrived', 'started',
     'completed', 'cancelled', 'rejected')),
  patient_name text,
  patient_age text,
  patient_condition text,
  patient_phone text,
  emergency_level text not null default 'medium'
    check (emergency_level in ('low', 'medium', 'high')),
  estimated_fare numeric(10,2),
  final_fare numeric(10,2),
  distance_km numeric(6,2),
  duration_min integer,
  payment_method text not null default 'cash'
    check (payment_method in ('wallet', 'cash', 'card', 'esewa', 'khalti')),
  notes text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bookings_user_idx on public.bookings(user_id, created_at desc);
create index if not exists bookings_driver_idx on public.bookings(driver_id, created_at desc);
create index if not exists bookings_status_idx on public.bookings(status);

drop trigger if exists bookings_updated_at on public.bookings;
create trigger bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

alter table public.bookings enable row level security;

-- A booking is visible to the patient who created it and to the assigned
-- driver. Unassigned pending bookings are visible to verified drivers
-- (so they can accept them).
drop policy if exists "bookings_select_involved" on public.bookings;
create policy "bookings_select_involved" on public.bookings
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.user_id = auth.uid()
    )
    or (
      status = 'pending'
      and exists (
        select 1 from public.drivers d
        where d.user_id = auth.uid() and d.status = 'verified'
      )
    )
  );

drop policy if exists "bookings_insert_own" on public.bookings;
create policy "bookings_insert_own" on public.bookings
  for insert with check (auth.uid() = user_id);

drop policy if exists "bookings_update_involved" on public.bookings;
create policy "bookings_update_involved" on public.bookings
  for update using (
    auth.uid() = user_id
    or exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 7. booking_status_history — immutable audit trail
-- ============================================================================
create table if not exists public.booking_status_history (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status text not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists booking_history_booking_idx
  on public.booking_status_history(booking_id, created_at);

alter table public.booking_status_history enable row level security;

drop policy if exists "history_select_involved" on public.booking_status_history;
create policy "history_select_involved" on public.booking_status_history
  for select using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and (
          b.user_id = auth.uid()
          or exists (
            select 1 from public.drivers d
            where d.id = b.driver_id and d.user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "history_insert_involved" on public.booking_status_history;
create policy "history_insert_involved" on public.booking_status_history
  for insert with check (
    exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and (
          b.user_id = auth.uid()
          or exists (
            select 1 from public.drivers d
            where d.id = b.driver_id and d.user_id = auth.uid()
          )
        )
    )
  );

-- Auto-log status changes
create or replace function public.log_booking_status()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into public.booking_status_history (booking_id, status, created_by)
    values (new.id, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_log_status on public.bookings;
create trigger bookings_log_status
  after update on public.bookings
  for each row execute function public.log_booking_status();

-- ============================================================================
-- 8. trip_locations — live tracking breadcrumbs
-- ============================================================================
create table if not exists public.trip_locations (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  heading numeric(5,2),
  speed_kmh numeric(5,2),
  recorded_at timestamptz not null default now()
);

create index if not exists trip_locations_booking_idx
  on public.trip_locations(booking_id, recorded_at desc);

alter table public.trip_locations enable row level security;

drop policy if exists "trip_locations_select_involved" on public.trip_locations;
create policy "trip_locations_select_involved" on public.trip_locations
  for select using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and (
          b.user_id = auth.uid()
          or exists (
            select 1 from public.drivers d
            where d.id = b.driver_id and d.user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "trip_locations_insert_driver" on public.trip_locations;
create policy "trip_locations_insert_driver" on public.trip_locations
  for insert with check (
    exists (
      select 1 from public.bookings b
      join public.drivers d on d.id = b.driver_id
      where b.id = booking_id and d.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 9. ratings
-- ============================================================================
create table if not exists public.ratings (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  feedback text,
  tip_amount numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.ratings enable row level security;

drop policy if exists "ratings_select_involved" on public.ratings;
create policy "ratings_select_involved" on public.ratings
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.user_id = auth.uid()
    )
  );

-- A passenger may rate only their own booking, and only the driver who
-- actually drove it (blocks rating another user's trip or an unrelated
-- driver id).
drop policy if exists "ratings_insert_own" on public.ratings;
create policy "ratings_insert_own" on public.ratings
  for insert with check (
    auth.uid() = user_id
    and driver_id = (
      select b.driver_id
      from public.bookings b
      where b.id = booking_id and b.user_id = auth.uid()
    )
  );

-- Aggregate rating back onto the driver after each new rating
create or replace function public.update_driver_rating()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Flag this internal refresh so protect_driver_fields() lets it through:
  -- this SECURITY DEFINER function runs with the caller's JWT claims, so
  -- auth.uid() inside the drivers trigger is the passenger, not null.
  perform set_config('resq.internal_update', 'on', true);

  update public.drivers
  set rating = (
        select round(avg(r.rating)::numeric, 2)
        from public.ratings r
        where r.driver_id = new.driver_id
      ),
      total_rides = (
        select count(*)
        from public.bookings b
        where b.driver_id = new.driver_id and b.status = 'completed'
      )
  where id = new.driver_id;

  perform set_config('resq.internal_update', 'off', true);
  return new;
end;
$$;

drop trigger if exists ratings_update_driver on public.ratings;
create trigger ratings_update_driver
  after insert on public.ratings
  for each row execute function public.update_driver_rating();

-- ============================================================================
-- 10. notifications
-- ============================================================================
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null default '',
  type text not null default 'system'
    check (type in ('booking', 'trip', 'promo', 'system')),
  booking_id uuid references public.bookings(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notifications_insert_own" on public.notifications;
create policy "notifications_insert_own" on public.notifications
  for insert with check (auth.uid() = user_id);

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- 11. saved_places
-- ============================================================================
create table if not exists public.saved_places (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  address text not null default '',
  lat double precision,
  lng double precision,
  type text not null default 'other' check (type in ('home', 'work', 'other')),
  created_at timestamptz not null default now()
);

create index if not exists saved_places_user_idx on public.saved_places(user_id);

alter table public.saved_places enable row level security;

drop policy if exists "saved_places_all_own" on public.saved_places;
create policy "saved_places_all_own" on public.saved_places
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- 12. support_requests
-- ============================================================================
create table if not exists public.support_requests (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null,
  message text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.support_requests enable row level security;

drop policy if exists "support_select_own" on public.support_requests;
create policy "support_select_own" on public.support_requests
  for select using (auth.uid() = user_id);

drop policy if exists "support_insert_own" on public.support_requests;
create policy "support_insert_own" on public.support_requests
  for insert with check (auth.uid() = user_id);

-- ============================================================================
-- RPC: atomic booking acceptance
-- ============================================================================
-- Prevents two drivers from both claiming the same pending booking:
-- the UPDATE only matches while status = 'pending', and the row lock
-- serializes concurrent callers.
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

-- ============================================================================
-- Seed data: hospitals in Kathmandu Valley (safe to re-run)
-- ============================================================================
insert into public.hospitals (name, address, lat, lng, phone)
select * from (values
  ('Norvic International Hospital', 'Thapathali, Kathmandu', 27.6930, 85.3206, '+977-1-4258554'),
  ('Tribhuvan University Teaching Hospital', 'Maharajgunj, Kathmandu', 27.7369, 85.3296, '+977-1-4412505'),
  ('Patan Hospital', 'Lagankhel, Lalitpur', 27.6678, 85.3193, '+977-1-5522266'),
  ('Grande International Hospital', 'Dhapasi, Kathmandu', 27.7445, 85.2994, '+977-1-5159266'),
  ('Bir Hospital', 'Kanti Path, Kathmandu', 27.7050, 85.3147, '+977-1-4221119'),
  ('Nepal Mediciti Hospital', 'Bhaisepati, Lalitpur', 27.6405, 85.3004, '+977-1-4217766')
) as v(name, address, lat, lng, phone)
where not exists (select 1 from public.hospitals h where h.name = v.name);
