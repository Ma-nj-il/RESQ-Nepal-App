-- ============================================================================
-- RESQ Nepal — Identity registration and application status
-- ============================================================================
-- Forward-only migration. Apply AFTER supabase/schema.sql:
--
--   1. supabase/schema.sql                 (base schema)
--   2. supabase/migrations/20261019_identity_registration.sql
--   3. supabase/migrations/20261019_identity_storage.sql
--
-- This migration is additive only. It does not delete accounts, bookings,
-- vehicles or documents. Safe to re-run (idempotent).
--
-- What it adds
--   * profiles.citizenship_number (nullable, unique when non-empty)
--   * unique licence-number and vehicle-plate-number indexes (preflight
--     duplicate checks refuse to proceed instead of changing data)
--   * identity_documents — private document metadata (never bytes)
--   * registration_applications — one USER / DRIVER application per account
--   * submit_identity_application() — atomic submission that verifies the
--     required profile fields, uploaded document metadata and private
--     Storage objects before moving the application to PENDING_VERIFICATION
--   * drivers status sync — the existing drivers.status remains the sole
--     approval source; the application mirrors it (APPROVED / REJECTED)
--
-- It does NOT implement verification, approval, rejection, an admin UI or
-- citizenship authenticity checks. New applications stay PENDING.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Identity fields on existing tables
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists citizenship_number text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_citizenship_number_not_blank'
  ) then
    alter table public.profiles
      add constraint profiles_citizenship_number_not_blank
      check (citizenship_number is null or btrim(citizenship_number) <> '');
  end if;
end;
$$;

-- Never silently change existing data. If historical rows contain duplicate
-- identifiers, stop and let an administrator resolve them first.
do $$
declare
  v_groups integer;
begin
  select count(*) into v_groups
  from (
    select upper(btrim(citizenship_number)) as value
    from public.profiles
    where citizenship_number is not null and btrim(citizenship_number) <> ''
    group by 1
    having count(*) > 1
  ) duplicates;
  if v_groups > 0 then
    raise exception
      'RESQ identity migration: % duplicate citizenship-number group(s) exist. Resolve duplicates before applying this migration. No data was changed.',
      v_groups;
  end if;

  select count(*) into v_groups
  from (
    select upper(btrim(license_number)) as value
    from public.drivers
    where btrim(license_number) <> ''
    group by 1
    having count(*) > 1
  ) duplicates;
  if v_groups > 0 then
    raise exception
      'RESQ identity migration: % duplicate driving-licence-number group(s) exist. Resolve duplicates before applying this migration. No data was changed.',
      v_groups;
  end if;

  select count(*) into v_groups
  from (
    select upper(btrim(plate_number)) as value
    from public.ambulances
    where btrim(plate_number) <> ''
    group by 1
    having count(*) > 1
  ) duplicates;
  if v_groups > 0 then
    raise exception
      'RESQ identity migration: % duplicate vehicle-plate-number group(s) exist. Resolve duplicates before applying this migration. No data was changed.',
      v_groups;
  end if;
end;
$$;

create unique index if not exists profiles_citizenship_number_uidx
  on public.profiles (upper(btrim(citizenship_number)))
  where citizenship_number is not null and btrim(citizenship_number) <> '';

create unique index if not exists drivers_license_number_uidx
  on public.drivers (upper(btrim(license_number)))
  where btrim(license_number) <> '';

create unique index if not exists ambulances_plate_number_uidx
  on public.ambulances (upper(btrim(plate_number)))
  where btrim(plate_number) <> '';

-- ---------------------------------------------------------------------------
-- 2. Private document metadata
-- ---------------------------------------------------------------------------
-- Bytes live only in the private Supabase Storage bucket created by
-- 20261019_identity_storage.sql. This table stores safe metadata and the
-- private object key. It is never exposed through public profile APIs.
create table if not exists public.identity_documents (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete cascade,
  vehicle_id uuid references public.ambulances(id) on delete cascade,
  document_type text not null,
  storage_bucket text not null default 'identity-documents',
  storage_path text not null,
  original_filename text,
  mime_type text not null,
  file_size bigint not null,
  upload_status text not null default 'PENDING_UPLOAD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_documents_type_check
    check (document_type in ('CITIZENSHIP', 'DRIVING_LICENSE', 'VEHICLE_BLUE_BOOK')),
  constraint identity_documents_bucket_check
    check (storage_bucket = 'identity-documents'),
  constraint identity_documents_mime_check
    check (mime_type in ('image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  constraint identity_documents_size_check
    check (file_size between 1 and 8388608),
  constraint identity_documents_status_check
    check (upload_status in ('PENDING_UPLOAD', 'UPLOADING', 'UPLOADED', 'UPLOAD_FAILED', 'REMOVED')),
  constraint identity_documents_owner_shape_check
    check (
      (document_type = 'CITIZENSHIP' and driver_id is null and vehicle_id is null)
      or (document_type = 'DRIVING_LICENSE' and vehicle_id is null)
      or document_type = 'VEHICLE_BLUE_BOOK'
    )
);

create unique index if not exists identity_documents_storage_path_uidx
  on public.identity_documents (storage_path);
create index if not exists identity_documents_account_idx
  on public.identity_documents (account_id, document_type, created_at desc);
create index if not exists identity_documents_driver_idx
  on public.identity_documents (driver_id, document_type, created_at desc);
create index if not exists identity_documents_vehicle_idx
  on public.identity_documents (vehicle_id, document_type, created_at desc);

drop trigger if exists identity_documents_updated_at on public.identity_documents;
create trigger identity_documents_updated_at
  before update on public.identity_documents
  for each row execute function public.set_updated_at();

-- Server-side ownership/shape validation. The storage path must start with the
-- account id; driver and vehicle associations must belong to the same account.
create or replace function public.validate_identity_document_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null and new.account_id <> v_uid then
    raise exception 'identity document account mismatch';
  end if;

  if new.storage_bucket <> 'identity-documents' then
    raise exception 'identity document storage bucket is not allowed';
  end if;

  if split_part(new.storage_path, '/', 1) <> new.account_id::text then
    raise exception 'identity document storage path is outside the account folder';
  end if;

  if new.document_type = 'CITIZENSHIP' and (new.driver_id is not null or new.vehicle_id is not null) then
    raise exception 'citizenship documents belong to the account only';
  end if;

  if new.driver_id is not null and not exists (
    select 1 from public.drivers d
    where d.id = new.driver_id and d.user_id = new.account_id
  ) then
    raise exception 'identity document driver does not belong to the account';
  end if;

  if new.vehicle_id is not null and not exists (
    select 1
    from public.ambulances a
    join public.drivers d on d.id = a.driver_id
    where a.id = new.vehicle_id
      and d.user_id = new.account_id
      and (new.driver_id is null or a.driver_id = new.driver_id)
  ) then
    raise exception 'identity document vehicle does not belong to the account';
  end if;

  return new;
end;
$$;

drop trigger if exists identity_documents_validate_owner on public.identity_documents;
create trigger identity_documents_validate_owner
  before insert or update on public.identity_documents
  for each row execute function public.validate_identity_document_owner();

-- Keep only the newest uploaded document of each kind "current". Older rows
-- remain as audit metadata but are marked REMOVED. Bytes are deleted by the
-- client only after the replacement row is safely stored.
create or replace function public.mark_previous_identity_documents_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.upload_status = 'UPLOADED' then
    update public.identity_documents
    set upload_status = 'REMOVED',
        updated_at = now()
    where account_id = new.account_id
      and document_type = new.document_type
      and id <> new.id
      and upload_status = 'UPLOADED'
      and (
        new.vehicle_id is null
        or vehicle_id is null
        or vehicle_id = new.vehicle_id
      );
  end if;
  return new;
end;
$$;

drop trigger if exists identity_documents_mark_previous on public.identity_documents;
create trigger identity_documents_mark_previous
  after insert on public.identity_documents
  for each row execute function public.mark_previous_identity_documents_removed();

alter table public.identity_documents enable row level security;

drop policy if exists "identity_documents_select_own" on public.identity_documents;
create policy "identity_documents_select_own" on public.identity_documents
  for select using (account_id = auth.uid());

drop policy if exists "identity_documents_insert_own" on public.identity_documents;
create policy "identity_documents_insert_own" on public.identity_documents
  for insert with check (
    account_id = auth.uid()
    and (
      document_type = 'CITIZENSHIP'
      or (
        document_type = 'DRIVING_LICENSE'
        and (
          driver_id is null
          or exists (
            select 1 from public.drivers d
            where d.id = driver_id and d.user_id = auth.uid()
          )
        )
      )
      or (
        document_type = 'VEHICLE_BLUE_BOOK'
        and (
          vehicle_id is null
          or exists (
            select 1
            from public.ambulances a
            join public.drivers d on d.id = a.driver_id
            where a.id = vehicle_id and d.user_id = auth.uid()
          )
        )
      )
    )
  );

drop policy if exists "identity_documents_update_own" on public.identity_documents;
create policy "identity_documents_update_own" on public.identity_documents
  for update using (account_id = auth.uid())
  with check (account_id = auth.uid());

-- No DELETE policy. Uploaded documents are marked REMOVED so the application
-- keeps an audit trail; the storage object itself is deleted by the owner.

-- ---------------------------------------------------------------------------
-- 3. Registration applications
-- ---------------------------------------------------------------------------
create table if not exists public.registration_applications (
  id uuid primary key default uuid_generate_v4(),
  reference_id text not null unique,
  account_id uuid not null references public.profiles(id) on delete cascade,
  application_type text not null,
  status text not null default 'DRAFT',
  status_reason text,
  submitted_at timestamptz,
  last_status_update timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_applications_type_check
    check (application_type in ('USER', 'DRIVER')),
  constraint registration_applications_status_check
    check (status in (
      'DRAFT',
      'SUBMITTED',
      'PENDING_VERIFICATION',
      'APPROVED',
      'REJECTED',
      'ADDITIONAL_INFORMATION_REQUIRED'
    )),
  constraint registration_applications_account_type_key
    unique (account_id, application_type)
);

create index if not exists registration_applications_account_idx
  on public.registration_applications (account_id, application_type);

drop trigger if exists registration_applications_updated_at on public.registration_applications;
create trigger registration_applications_updated_at
  before update on public.registration_applications
  for each row execute function public.set_updated_at();

alter table public.registration_applications enable row level security;

-- Read-only to the account owner. Submission goes through the SECURITY
-- DEFINER RPC below; approval/rejection happens only through a trusted
-- administrator (SQL editor / service role).
drop policy if exists "registration_applications_select_own" on public.registration_applications;
create policy "registration_applications_select_own" on public.registration_applications
  for select using (account_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Mirror the existing driver approval status
-- ---------------------------------------------------------------------------
-- drivers.status remains the single approval source. The application row only
-- mirrors it so the status screen has one place to read from.
create or replace function public.sync_driver_application_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_status := case new.status
    when 'verified' then 'APPROVED'
    when 'rejected' then 'REJECTED'
    else 'PENDING_VERIFICATION'
  end;

  update public.registration_applications
  set status = v_status,
      status_reason = new.rejection_reason,
      last_status_update = now(),
      updated_at = now()
  where account_id = new.user_id
    and application_type = 'DRIVER';

  return new;
end;
$$;

drop trigger if exists drivers_sync_application_status on public.drivers;
create trigger drivers_sync_application_status
  after update of status on public.drivers
  for each row execute function public.sync_driver_application_status();

-- ---------------------------------------------------------------------------
-- 5. Atomic submission RPC
-- ---------------------------------------------------------------------------
-- Verifies:
--   * caller is authenticated (auth.uid(), never a client-supplied id)
--   * citizenship number is present
--   * the required uploaded document metadata exists
--   * the corresponding private Storage object actually exists
--   * driver applications have a pending driver profile, a licence number and
--     an ambulance, with licence + Blue Book documents attached
-- Then upserts exactly one application per (account, type).
--
-- The Storage check is dynamic so this migration can be validated on a plain
-- PostgreSQL instance with a storage stub. Supabase always has storage.objects.
create or replace function public.submit_identity_application(p_application_type text)
returns public.registration_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_type text := upper(coalesce(p_application_type, ''));
  v_app public.registration_applications;
  v_driver public.drivers;
  v_vehicle public.ambulances;
  v_missing text[] := array[]::text[];
  v_has_object boolean := false;
  v_reference text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_type not in ('USER', 'DRIVER') then
    raise exception 'invalid application type';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and nullif(btrim(p.citizenship_number), '') is not null
  ) then
    v_missing := array_append(v_missing, 'citizenship number');
  end if;

  execute $q$
    select exists (
      select 1
      from public.identity_documents d
      join storage.objects o
        on o.bucket_id = d.storage_bucket
       and o.name = d.storage_path
      where d.account_id = $1
        and d.document_type = 'CITIZENSHIP'
        and d.upload_status = 'UPLOADED'
    )
  $q$ into v_has_object using v_uid;
  if not v_has_object then
    v_missing := array_append(v_missing, 'citizenship document');
  end if;

  if v_type = 'DRIVER' then
    select * into v_driver
    from public.drivers d
    where d.user_id = v_uid;

    if v_driver.id is null then
      v_missing := array_append(v_missing, 'driver profile');
    else
      if nullif(btrim(v_driver.license_number), '') is null then
        v_missing := array_append(v_missing, 'driving licence number');
      end if;

      execute $q$
        select exists (
          select 1
          from public.identity_documents d
          join storage.objects o
            on o.bucket_id = d.storage_bucket
           and o.name = d.storage_path
          where d.account_id = $1
            and d.document_type = 'DRIVING_LICENSE'
            and d.upload_status = 'UPLOADED'
            and d.driver_id = $2
        )
      $q$ into v_has_object using v_uid, v_driver.id;
      if not v_has_object then
        v_missing := array_append(v_missing, 'driving licence document');
      end if;
    end if;

    select * into v_vehicle
    from public.ambulances a
    where a.driver_id = v_driver.id
    order by a.created_at desc
    limit 1;

    if v_vehicle.id is null then
      v_missing := array_append(v_missing, 'ambulance');
    else
      execute $q$
        select exists (
          select 1
          from public.identity_documents d
          join storage.objects o
            on o.bucket_id = d.storage_bucket
           and o.name = d.storage_path
          where d.account_id = $1
            and d.document_type = 'VEHICLE_BLUE_BOOK'
            and d.upload_status = 'UPLOADED'
            and d.vehicle_id = $2
        )
      $q$ into v_has_object using v_uid, v_vehicle.id;
      if not v_has_object then
        v_missing := array_append(v_missing, 'blue book document');
      end if;
    end if;
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'identity application incomplete: %', array_to_string(v_missing, ', ');
  end if;

  -- Existing approved applications are not reopened by a client call.
  select * into v_app
  from public.registration_applications a
  where a.account_id = v_uid and a.application_type = v_type;

  if v_app.id is not null and v_app.status = 'APPROVED' then
    return v_app;
  end if;

  v_reference := 'RESQ-'
    || case v_type when 'USER' then 'U' else 'D' end
    || '-'
    || to_char(now(), 'YYYY')
    || '-'
    || upper(substr(replace(uuid_generate_v4()::text, '-', ''), 1, 10));

  insert into public.registration_applications (
    reference_id,
    account_id,
    application_type,
    status,
    status_reason,
    submitted_at,
    last_status_update
  )
  values (
    v_reference,
    v_uid,
    v_type,
    case
      when v_type = 'DRIVER' and v_driver.status = 'verified' then 'APPROVED'
      else 'PENDING_VERIFICATION'
    end,
    null,
    now(),
    now()
  )
  on conflict (account_id, application_type) do update
  set status = case
        when excluded.application_type = 'DRIVER' and v_driver.status = 'verified' then 'APPROVED'
        else 'PENDING_VERIFICATION'
      end,
      status_reason = null,
      submitted_at = now(),
      last_status_update = now(),
      updated_at = now()
  returning * into v_app;

  return v_app;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------
revoke all on public.identity_documents from anon;
revoke all on public.registration_applications from anon;
revoke execute on function public.submit_identity_application(text) from public;
revoke execute on function public.submit_identity_application(text) from anon;

grant select, insert, update on public.identity_documents to authenticated;
grant select on public.registration_applications to authenticated;
grant execute on function public.submit_identity_application(text) to authenticated;

commit;
