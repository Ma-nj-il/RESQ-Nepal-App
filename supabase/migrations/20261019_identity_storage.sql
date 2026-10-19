-- ============================================================================
-- RESQ Nepal — Private identity-document storage
-- ============================================================================
-- Forward-only migration. Apply AFTER:
--   1. supabase/schema.sql
--   2. supabase/migrations/20261019_identity_registration.sql
--
-- Creates a PRIVATE Supabase Storage bucket. There is deliberately no public
-- URL, no public read policy and no anonymous access.
--
-- Object layout (enforced by policy):
--   identity-documents/<auth.uid()>/<document_type>/<random-id>.<ext>
--
-- Only the owning account can read, upload, replace or delete its objects.
-- The service role / SQL editor can still be used by a future verification
-- workflow, but no verification UI or approval logic is added here.
-- ============================================================================

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'identity-documents',
  'identity-documents',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table storage.objects enable row level security;

drop policy if exists "identity_documents_storage_select_own" on storage.objects;
create policy "identity_documents_storage_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "identity_documents_storage_insert_own" on storage.objects;
create policy "identity_documents_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "identity_documents_storage_update_own" on storage.objects;
create policy "identity_documents_storage_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "identity_documents_storage_delete_own" on storage.objects;
create policy "identity_documents_storage_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Anonymous access is denied by the absence of an anon policy for this bucket
-- (do not revoke storage.objects globally — that table is shared by every
-- bucket in the project). The service role bypasses RLS for authorised admin
-- work; no admin/verification UI is added here.

commit;
