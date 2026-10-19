-- Local verification for the identity-registration migrations.
-- Runs against a disposable PostgreSQL container with the Supabase stubs in
-- 00_stub_supabase.sql. It is NOT a production migration.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, phone, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@resq.test', '+9779800000001',
   '{"full_name":"User A"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'b@resq.test', '+9779800000002',
   '{"full_name":"User B"}'::jsonb);

update public.profiles
set citizenship_number = 'CIT-A', phone = '+9779800000001'
where id = '11111111-1111-1111-1111-111111111111';

-- The test database is not Supabase, so grant the API-role privileges that
-- Supabase normally provides. RLS policies still decide row access.
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema storage to authenticated;

-- ---------------------------------------------------------------------------
-- Patient account A: private object, metadata, submission
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

do $$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'RLS: account A should see exactly its own profile';
  end if;
end;
$$;

insert into public.identity_documents (
  account_id, document_type, storage_bucket, storage_path,
  original_filename, mime_type, file_size, upload_status
) values (
  '11111111-1111-1111-1111-111111111111',
  'CITIZENSHIP',
  'identity-documents',
  '11111111-1111-1111-1111-111111111111/citizenship/citizenship.jpg',
  'citizenship.jpg',
  'image/jpeg',
  4096,
  'UPLOADED'
);

-- Submission must refuse metadata that has no real Storage object.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    perform public.submit_identity_application('USER');
  exception when others then
    if position('identity application incomplete' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'RPC: a document without a Storage object was accepted';
  end if;
end;
$$;

insert into storage.objects (bucket_id, name)
values (
  'identity-documents',
  '11111111-1111-1111-1111-111111111111/citizenship/citizenship.jpg'
);

do $$
declare
  v_app public.registration_applications;
begin
  select * into v_app from public.submit_identity_application('USER');
  if v_app.status <> 'PENDING_VERIFICATION' then
    raise exception 'USER submission status was %, expected PENDING_VERIFICATION', v_app.status;
  end if;
  if v_app.submitted_at is null then
    raise exception 'USER submission did not record submitted_at';
  end if;
  if v_app.reference_id !~ '^RESQ-U-[0-9]{4}-[A-F0-9]{10}$' then
    raise exception 'USER reference id has an unexpected shape: %', v_app.reference_id;
  end if;
end;
$$;

-- Repeating submission must not create a second application.
do $$
declare
  v_count integer;
begin
  perform public.submit_identity_application('USER');
  select count(*) into v_count
  from public.registration_applications
  where account_id = '11111111-1111-1111-1111-111111111111'
    and application_type = 'USER';
  if v_count <> 1 then
    raise exception 'duplicate submission created % USER applications', v_count;
  end if;
end;
$$;

-- Direct application writes are not available to the client.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into public.registration_applications (
      reference_id, account_id, application_type, status
    ) values (
      'RESQ-DIRECT-TEST',
      '11111111-1111-1111-1111-111111111111',
      'USER',
      'PENDING_VERIFICATION'
    );
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'RLS: client inserted an application directly';
  end if;
end;
$$;

do $$
declare
  v_rows integer;
begin
  update public.registration_applications
  set status = 'APPROVED'
  where account_id = '11111111-1111-1111-1111-111111111111';

  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS: client changed application status directly';
  end if;
end;
$$;

-- Cross-account document writes are refused by the owner trigger.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into public.identity_documents (
      account_id, document_type, storage_bucket, storage_path,
      mime_type, file_size, upload_status
    ) values (
      '22222222-2222-2222-2222-222222222222',
      'CITIZENSHIP',
      'identity-documents',
      '22222222-2222-2222-2222-222222222222/citizenship/forged.jpg',
      'image/jpeg',
      2048,
      'UPLOADED'
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'cross-account document insert was allowed';
  end if;
end;
$$;

-- Storage path policy: account A cannot write into account B's folder.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name)
    values (
      'identity-documents',
      '22222222-2222-2222-2222-222222222222/citizenship/forged.jpg'
    );
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'storage: cross-account object insert was allowed';
  end if;
end;
$$;

-- Database checks: MIME, size and ownership shape.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into public.identity_documents (
      account_id, document_type, storage_bucket, storage_path,
      mime_type, file_size, upload_status
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'CITIZENSHIP',
      'identity-documents',
      '11111111-1111-1111-1111-111111111111/citizenship/bad-mime.jpg',
      'application/pdf',
      1024,
      'UPLOADED'
    );
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'database accepted a disallowed MIME type';
  end if;

  v_blocked := false;
  begin
    insert into public.identity_documents (
      account_id, document_type, storage_bucket, storage_path,
      mime_type, file_size, upload_status
    ) values (
      '11111111-1111-1111-1111-111111111111',
      'CITIZENSHIP',
      'identity-documents',
      '11111111-1111-1111-1111-111111111111/citizenship/too-large.jpg',
      'image/jpeg',
      99999999,
      'UPLOADED'
    );
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'database accepted an oversized document';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Driver account A: draft rows, document association, submission
-- ---------------------------------------------------------------------------
insert into public.drivers (user_id, license_number, license_expiry)
values (
  '11111111-1111-1111-1111-111111111111',
  'LIC-A',
  '2030-01-01'
);

insert into public.ambulances (driver_id, category, plate_number, model)
select id, 'basic', 'BA 1 PA 1234', 'Test ambulance'
from public.drivers
where user_id = '11111111-1111-1111-1111-111111111111';

insert into public.identity_documents (
  account_id, document_type, storage_bucket, storage_path,
  mime_type, file_size, upload_status
) values
  (
    '11111111-1111-1111-1111-111111111111',
    'DRIVING_LICENSE',
    'identity-documents',
    '11111111-1111-1111-1111-111111111111/driving-licence/licence.jpg',
    'image/jpeg',
    4096,
    'UPLOADED'
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'VEHICLE_BLUE_BOOK',
    'identity-documents',
    '11111111-1111-1111-1111-111111111111/vehicle-blue-book/bluebook.jpg',
    'image/jpeg',
    4096,
    'UPLOADED'
  );

insert into storage.objects (bucket_id, name) values
  ('identity-documents', '11111111-1111-1111-1111-111111111111/driving-licence/licence.jpg'),
  ('identity-documents', '11111111-1111-1111-1111-111111111111/vehicle-blue-book/bluebook.jpg');

-- Before association, the driver submission must fail.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    perform public.submit_identity_application('DRIVER');
  exception when others then
    if position('identity application incomplete' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'RPC accepted unassociated driver documents';
  end if;
end;
$$;

update public.identity_documents
set driver_id = (
  select id from public.drivers
  where user_id = '11111111-1111-1111-1111-111111111111'
)
where account_id = '11111111-1111-1111-1111-111111111111'
  and document_type = 'DRIVING_LICENSE';

update public.identity_documents
set driver_id = (
  select id from public.drivers
  where user_id = '11111111-1111-1111-1111-111111111111'
),
vehicle_id = (
  select a.id
  from public.ambulances a
  join public.drivers d on d.id = a.driver_id
  where d.user_id = '11111111-1111-1111-1111-111111111111'
  limit 1
)
where account_id = '11111111-1111-1111-1111-111111111111'
  and document_type = 'VEHICLE_BLUE_BOOK';

do $$
declare
  v_app public.registration_applications;
begin
  select * into v_app from public.submit_identity_application('DRIVER');
  if v_app.status <> 'PENDING_VERIFICATION' then
    raise exception 'DRIVER submission status was %, expected PENDING_VERIFICATION', v_app.status;
  end if;
  if v_app.reference_id !~ '^RESQ-D-[0-9]{4}-[A-F0-9]{10}$' then
    raise exception 'DRIVER reference id has an unexpected shape: %', v_app.reference_id;
  end if;
  if (select status from public.drivers where user_id = '11111111-1111-1111-1111-111111111111') <> 'pending' then
    raise exception 'driver was automatically verified by submission';
  end if;
end;
$$;

-- A client cannot self-verify.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    update public.drivers
    set status = 'verified', verified_at = now()
    where user_id = '11111111-1111-1111-1111-111111111111';
  exception when others then
    if position('verification fields are read-only' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'client self-verification was allowed';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Account B isolation
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

do $$
begin
  if (select count(*) from public.identity_documents) <> 0 then
    raise exception 'RLS: account B can read account A documents';
  end if;
  if (select count(*) from public.registration_applications) <> 0 then
    raise exception 'RLS: account B can read account A applications';
  end if;
end;
$$;

do $$
declare
  v_blocked boolean := false;
begin
  begin
    perform public.submit_identity_application('USER');
  exception when others then
    if position('identity application incomplete' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'account B submitted without citizenship details';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trusted review mirrors drivers.status into the application (postgres)
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claim.sub', '', false);

update public.drivers
set status = 'verified', verified_at = now()
where user_id = '11111111-1111-1111-1111-111111111111';

do $$
begin
  if (
    select status from public.registration_applications
    where account_id = '11111111-1111-1111-1111-111111111111'
      and application_type = 'DRIVER'
  ) <> 'APPROVED' then
    raise exception 'driver approval did not mirror into the application';
  end if;
end;
$$;

-- Unique indexes protect against duplicate identity/vehicle identifiers.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    update public.profiles
    set citizenship_number = 'CIT-A'
    where id = '22222222-2222-2222-2222-222222222222';
  exception when unique_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'duplicate citizenship number was allowed';
  end if;

  v_blocked := false;
  begin
    insert into public.drivers (user_id, license_number)
    values ('22222222-2222-2222-2222-222222222222', 'LIC-A');
  exception when unique_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'duplicate driving licence number was allowed';
  end if;

  v_blocked := false;
  begin
    insert into public.ambulances (driver_id, category, plate_number, model)
    select id, 'basic', 'BA 1 PA 1234', 'Duplicate'
    from public.drivers
    where user_id = '11111111-1111-1111-1111-111111111111';
  exception when unique_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'duplicate vehicle plate was allowed';
  end if;
end;
$$;

-- Bucket is private, size-limited and MIME-limited.
do $$
begin
  if (select public from storage.buckets where id = 'identity-documents') then
    raise exception 'identity-documents bucket is public';
  end if;
  if (select file_size_limit from storage.buckets where id = 'identity-documents') <> 8388608 then
    raise exception 'identity-documents bucket has the wrong size limit';
  end if;
  if not (
    select 'image/jpeg' = any(allowed_mime_types)
    from storage.buckets where id = 'identity-documents'
  ) then
    raise exception 'identity-documents bucket does not allow JPEG';
  end if;
end;
$$;

-- RLS is enabled on every new table.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.identity_documents'::regclass) then
    raise exception 'identity_documents RLS is disabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.registration_applications'::regclass) then
    raise exception 'registration_applications RLS is disabled';
  end if;
end;
$$;

select 'identity registration SQL verification passed' as result;
