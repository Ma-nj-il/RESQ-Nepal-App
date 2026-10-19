# Identity Registration & Application Status — Implementation Report

**Date:** 19 October 2026  
**Scope:** citizenship/driver identity capture, private document upload, real persistence, application status  
**Overall result:** **IMPLEMENTED LOCALLY — HOSTED DEPLOYMENT BLOCKED**  
**Production readiness:** **NOT CLAIMED**

This report records what was built, what was actually executed, and what remains blocked. A PASS in
this document means the listed command/assertion was run in this workspace or a disposable local
PostgreSQL container. It does not mean the hosted Supabase project or a physical device was tested.

---

## 1. What was delivered

### User registration

- Full legal name, phone, citizenship number and a citizenship document are required for a real
  (non-demo) user signup.
- The phone remains the OTP-verified number; it is not a free-text field in the signup form.
- The citizenship image is uploaded to private Storage **before** the application is submitted.
- Profile fields are saved with Row Level Security; the application reference is created by an RPC.

### Driver registration

- Full name, phone, email, citizenship number and citizenship document.
- Driving licence number, expiry date and licence document.
- Vehicle category, plate number, model and vehicle Blue Book document linked to the vehicle.
- The driver row is created/updated, the vehicle is created/updated, pending document rows are
  associated with the driver/vehicle, and only then is the driver application submitted.
- Driver approval continues to use the existing `public.drivers.status` column. No second approval
  column was introduced.

### Application status

- Shared `ApplicationStatusScreen` for user and driver applications.
- Shows reference ID, submission date, application status, last update, masked citizenship number,
  driver status (driver mode), vehicle summary and document rows.
- Loading, error/retry, empty, refresh, upload-failure and expired-session presentations.
- A document is labelled only as an upload state. It is never labelled “verified” by this screen.
- New applications return `PENDING_VERIFICATION`; nothing is auto-approved.

### Entry points

- Account screen → **Identity Verification**
- Drawer → **Application Status**
- Driver Profile → **Application Status**
- Driver Settings → **Application Status**
- Driver Onboarding → **Before you apply** panel and **Open verified application** shortcut
- User signup success → **View status**; empty status → **Add citizenship details**
- Driver registration success → **View application status**; update action when not approved

---

## 2. Architecture

The app is a React Native/Expo client that talks **directly to Supabase**. There is no Go/Gin or
other custom backend in this repository. Identity persistence therefore consists of:

1. Supabase Postgres tables + Row Level Security (RLS).
2. A `SECURITY DEFINER` submission RPC that re-checks ownership and private Storage objects.
3. A private Supabase Storage bucket for image bytes.
4. Client services that upload bytes, insert metadata, remove failed objects and load status.

No public bucket, public URL, signed public URL or Base64 database column is used.

### Storage layout

```text
identity-documents/
  <auth.uid()>/
    citizenship/<random-id>.jpg
    driving-licence/<random-id>.jpg
    vehicle-blue-book/<random-id>.jpg
```

Only `storage_path` metadata is stored in Postgres. The bucket is private and the RLS policy only
allows an authenticated account to read/write objects under its own UID folder.

---

## 3. Database changes

Forward-only migration files:

| File | Purpose |
|---|---|
| `supabase/migrations/20261019_identity_registration.sql` | Profile citizenship column, `identity_documents`, `registration_applications`, constraints, indexes, RLS, triggers, `submit_identity_application()` |
| `supabase/migrations/20261019_identity_storage.sql` | Private `identity-documents` bucket + Storage RLS policies |

The base schema remains `supabase/schema.sql`. Applied migrations were not edited.

### `profiles`

- `citizenship_number text` (nullable for existing accounts; required by the application flow).
- Non-blank check, unique index when present.
- Existing profile RLS is unchanged for other fields.

### `identity_documents`

Important columns: `account_id`, `driver_id`, `vehicle_id`, `document_type`,
`original_filename`, `mime_type`, `file_size`, `storage_bucket`, `storage_path`,
`upload_status`, timestamps.

- Types: `CITIZENSHIP`, `DRIVING_LICENSE`, `VEHICLE_BLUE_BOOK`.
- Upload states: `PENDING_UPLOAD`, `UPLOADING`, `UPLOADED`, `UPLOAD_FAILED`, `REMOVED`.
- Owner trigger enforces account folder, allowed bucket, document type/scope, driver ownership and
  vehicle ownership.
- A replacement insert marks the previous uploaded document of the same scope `REMOVED`; the client
  deletes the old private object after the new row succeeds.
- RLS allows select/insert/update only for the owning account.

### `registration_applications`

Important columns: `reference_id`, `account_id`, `application_type` (`USER`/`DRIVER`), `status`,
`status_reason`, `submitted_at`, `last_status_update`.

- Unique `(account_id, application_type)`.
- New submissions become `PENDING_VERIFICATION`.
- `drivers` status sync trigger mirrors `verified` → `APPROVED` and `rejected` → `REJECTED`.
  `drivers.status` remains the sole driver approval source.
- RLS allows the owner to read their application; writes are limited to the RPC/service role path.

### Submission RPC

`public.submit_identity_application(p_application_type text)`:

- Requires an authenticated account and a matching `profiles` row.
- Requires full name, phone and citizenship number.
- For users: requires an uploaded citizenship document whose private Storage object exists.
- For drivers: requires an uploaded licence, an expiry date and a Blue Book for the driver's newest
  vehicle, with all private Storage objects present.
- Rejects missing/removed/foreign documents and incomplete driver/vehicle data.
- Uses a transaction and returns the application row. A repeat call returns the existing application
  rather than duplicating or auto-approving it.

---

## 4. Client implementation

| File | Responsibility |
|---|---|
| `src/utils/identity.ts` | MIME/signature detection, 8 MB limit, base64 decoding, filename sanitisation, paths/IDs, masking, date/size formatting, status presentation, current-document selection |
| `src/constants/identity.ts` | Bucket name, allowed types, labels, required-document lists |
| `src/services/database/identity.ts` | Private upload/cleanup, association, status load, submission, error mapping |
| `src/components/identity/DocumentUploadCard.tsx` | Camera-only selection, local uploading/failed/uploaded/removed states, retry, replace, remove |
| `src/screens/auth/PersonalInfoScreen.tsx` | User signup citizenship capture + profile save + submission |
| `src/screens/driver/DriverRegistrationScreen.tsx` | Driver/vehicle/citizenship/licence/Blue Book application flow |
| `src/screens/user/ApplicationStatusScreen.tsx` | Shared status screen with all requested states |
| `src/screens/user/CitizenshipRegistrationScreen.tsx` | Existing-user citizenship update flow |

Image capture uses the existing `expo-image-picker` dependency. No new file-system or picker
dependency was added. Capture is image-only (camera); gallery selection is deliberately not offered
in this phase.

### Upload state handling

- **Not uploaded:** no current `UPLOADED` row.
- **Uploading:** local state while bytes/metadata are in flight.
- **Uploaded:** only after Storage upload and metadata insert both succeed.
- **Failed:** signature/size/type/network/Storage/DB failure; error is visible and submission is
  blocked because the required document is absent or not current.
- **Removed/replaced:** old row marked `REMOVED`; old private object deletion is attempted; the UI
  returns to not-uploaded.

If a replacement fails, the previous uploaded document remains attached, but the card shows the
failure state instead of a green success state.

### Application-status states

- Loading indicator.
- Error card with Retry.
- Expired session: explicit **Sign in again** action (signs out locally and returns to the auth flow).
- Empty application: explains that nothing was fabricated, with action to add citizenship details or
  start driver registration.
- Populated application: reference, dates, statuses and document upload rows.
- Pull-to-refresh.
- Demo mode: local-only notice; no Supabase reads/writes.

---

## 5. Security and privacy controls

- Bucket is private (`public = false`), 8 MB limit, image-only MIME allow-list.
- Storage policies scope object access to `<auth.uid()>/…`; no anonymous policy.
- Database trigger re-checks account folder, bucket, document scope, driver ownership and vehicle
  ownership server-side.
- The RPC re-checks storage objects before submission; uploaded metadata alone is insufficient.
- Object names are random 32-hex IDs; original filenames are sanitised and stored only as metadata.
- Detected file signature determines MIME/extension. Declared picker MIME is not trusted.
- No document bytes are stored in Postgres and no Base64 is logged.
- No sensitive values are logged by the client paths; errors are reduced to user-safe messages.
- RLS prevents reading another account's application, documents, driver, vehicles or profile.
- Demo mode never uploads or submits.
- Approval is not implemented in the client; a future reviewer/admin path is required.

---

## 6. Verification results

### PASS — executed in this workspace

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | PASS |
| Lint | `npx expo lint` | PASS |
| Unit tests | `npm run test:unit` | PASS, 18/18 |
| iOS bundle/export | `npx expo export --platform ios` | PASS |
| Local SQL migrations/RLS/RPC/constraints/idempotency | `./qa/sql/verify_identity_registration.sh` | PASS |
| Demo identity/status navigation | `maestro test … qa/maestro/maestro-verify-identity-demo.yaml` | PASS (run `2026-10-19_180958`) |
| Demo end-to-end journey/logout | `maestro test … qa/maestro/maestro-d1-demo-journey.yaml` | PASS (run `2026-10-19_173102`) |
| Booking regression | `maestro test … qa/maestro/maestro-verify-booking.yaml` | PASS (run `2026-10-19_175713`) |
| History/rating/SOS regression | `maestro test … qa/maestro/maestro-verify-history-rating-sos.yaml` | PASS (run `2026-10-19_175957`) |
| Drawer/account/settings regression | `maestro test … qa/maestro/maestro-verify-menu-account.yaml` | PASS (run `2026-10-19_174634`) |
| Driver demo walkthrough regression | `maestro test … qa/maestro/maestro-verify-driver-demo.yaml` | PASS (run `2026-10-19_180432`) |

The SQL harness starts a disposable `postgres:16-alpine` container on port 55432, installs minimal
Supabase auth/storage stubs, applies `schema.sql` plus both migrations twice, then runs assertions.
It does not touch the hosted project.

The unit suite covers:

- JPEG/PNG/HEIC signature detection, including a picker MIME/extension mismatch.
- Rejection of empty, PDF/GIF, oversized and unsupported files.
- Base64/data-URL decoding.
- Path account scoping, random IDs, extension sanitisation and filename traversal.
- Identifier masking and status copy (no automatic approval wording).
- Every upload label, including failed and removed.
- Current-document selection (uploaded only, newest, vehicle-scoped).
- Date/size formatting.

The SQL suite covers:

- Both migrations apply cleanly and are idempotent.
- Required columns, tables, constraints and unique indexes.
- Cross-account read/write denial under RLS.
- Storage-path/owner trigger rejection.
- Missing/cross-account document rejection in the RPC.
- Application submission remains `PENDING_VERIFICATION`.
- Driver approval mirrors from `drivers.status`.
- Bucket is private, size-limited and MIME-limited.

### BLOCKED — not executable without hosted changes/approval

| Item | Why blocked |
|---|---|
| Apply migrations to hosted Supabase | Requires explicit deployment approval; not applied |
| Create/verify hosted private bucket and policies | Depends on storage migration deployment |
| Live document upload from the app | Requires deployed tables/bucket and an authenticated session |
| Live registration/application persistence | Same as above |
| Live phone OTP signup test | Hosted phone OTP/provider remains disabled/unverified |
| End-to-end reviewer approval | No admin verification UI exists in this phase; approval is out of scope |

### UNTESTED

- Physical iOS/Android camera capture and HEIC upload to hosted Storage.
- Actual Supabase Storage binary upload/delete behaviour against the hosted project.
- Live expired-session recovery after a real token expiry.
- Multi-vehicle driver edge cases beyond the newest-vehicle Blue Book rule.
- Accessibility/device-matrix review of the new screens.
- Production load, backup/restore and retention/deletion procedures.

### FAIL

None known for the executed local checks. No failing check is being waived.

---

## 7. Deployment procedure (requires explicit approval)

Do **not** run these against production or the hosted project until the owner explicitly approves.

1. Take a database backup / confirm the project's recovery point.
2. Open Supabase SQL Editor on the target project.
3. Apply `supabase/migrations/20261019_identity_registration.sql`.
4. Apply `supabase/migrations/20261019_identity_storage.sql`.
5. Confirm:
   - `profiles.citizenship_number` exists,
   - `identity_documents` and `registration_applications` exist with RLS enabled,
   - `identity-documents` bucket exists and `public = false`,
   - `submit_identity_application` exists.
6. Re-run the verification queries/health checks.
7. Only then test a real signup with an approved test phone number.
8. Record evidence; do not approve a driver or user identity as part of deployment testing unless the
   owner authorizes that state change.

### Post-deployment smoke test

- Sign up with a test account; capture citizenship; verify upload succeeds; submit; reload status.
- Repeat with a driver account: citizenship, licence, Blue Book, vehicle; submit; confirm pending.
- Confirm a second account cannot read the first account's documents/application/status.
- Confirm no public object URL works.
- Confirm demo mode still performs no network uploads.
- Confirm `drivers.status` remains pending until an authorized reviewer updates it.

---

## 8. Known limitations

- No reviewer/admin UI or automated authenticity/OCR check. “Pending verification” is real, not a
  simulated success.
- Capture is camera-only images; PDFs are rejected.
- Image signature validation detects obvious MIME spoofing but is not malware scanning.
- One driver application per account. The driver Blue Book is evaluated against the newest vehicle;
  per-vehicle application records are not implemented.
- Deleting a profile cascades metadata but does not automatically delete private Storage objects;
  a service-role cleanup job is still required.
- Citizenship numbers and documents are sensitive PII; database access is RLS-protected but not
  application-layer encrypted.
- Hosted migrations and live Storage upload remain undeployed/unverified as of this report.
- No production or physical-device readiness is claimed.
