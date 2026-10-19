# RESQ Nepal — Database Schema

Canonical base DDL: `supabase/schema.sql` (apply via Supabase SQL Editor).
Forward-only identity migrations:
`supabase/migrations/20261019_identity_registration.sql` and
`supabase/migrations/20261019_identity_storage.sql`.
TypeScript mirrors: `src/types/index.ts`. Client services: `src/services/database/`.

> The identity migrations are **not applied to the hosted project** in this workspace. They are
> verified locally by `qa/sql/verify_identity_registration.sh`; see
> `docs/identity-registration-status-implementation.md`.

## Entity map

```
auth.users ──1:1── profiles
                    │ 1:1
                    ▼
                 drivers ──1:N── driver_verifications
                    │
                    ├──1:N── ambulances
                    │            │
                    │            ▼
                    └──1:N──── bookings ──1:N── booking_status_history
                    │            │  │
                    │            │  ├──1:N── trip_locations
                    │            │  └──1:1── ratings
                    │            │
        profiles ───┴──1:N───────┘   (user_id)
                    │
                    ├──1:N── notifications
                    ├──1:N── saved_places
                    ├──1:N── support_requests
                    ├──1:N── identity_documents
                    ├──1:N── registration_applications
                    │
                    └──M:N── hospitals  (drivers.hospital_id / hospital_memberships)

drivers ──1:N── identity_documents (driver_id, nullable)
ambulances ──1:N── identity_documents (vehicle_id, nullable)
```

## Tables

### profiles
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `references auth.users(id)` |
| full_name | text | required |
| email / phone | text | contact info |
| avatar_url | text | optional |
| gender | text | optional |
| date_of_birth | date | optional |
| mode | text | `user` \| `driver`, default `user` |
| citizenship_number | text | identity migration; nullable for legacy rows, non-blank + unique when present |
| created_at / updated_at | timestamptz | trigger-maintained |

### hospitals
`id`, `name`, `address`, `lat`, `lng`, `phone`, `emergency_contact`, `created_at`.
Seeded with 6 Kathmandu Valley hospitals. Shared reference data (read-only for clients).

### drivers
`id`, `user_id (unique, → profiles)`, `license_number`, `license_expiry`,
`status (pending|verified|rejected)`, `rejection_reason`, `rating numeric(3,2)`,
`total_rides int`, `hospital_id (→ hospitals)`, `verified_at`, timestamps.
**Verification fields are trigger-protected** — clients cannot self-verify.

### driver_verifications
`id`, `driver_id`, `document_type (license|citizenship|vehicle_registration|insurance)`,
`document_url`, `status (pending|approved|rejected)`, `reviewed_by`, `reviewed_at`,
`created_at`. Clients may insert `pending` rows only.

### ambulances
`id`, `driver_id`, `category (basic|icu)`, `plate_number`, `model`, `color`,
`status (available|busy|offline)`, `equipment text[]`, `hospital_affiliation`, timestamps.
Capabilities (oxygen, ventilator, stretcher, wheelchair, defibrillator…) are stored in the
`equipment` array and are **independent of the two user-facing categories**.

### bookings
`id`, `user_id`, `driver_id`, `ambulance_id`, `category (basic|icu)`,
pickup (`pickup_address`, `pickup_lat`, `pickup_lng`),
destination (`destination_address`, `dest_lat`, `dest_lng`),
`status`, patient fields (`patient_name`, `patient_age`, `patient_condition`,
`patient_phone`),
`emergency_level (low|medium|high)`, `estimated_fare`, `final_fare`, `distance_km`,
`duration_min`, `payment_method (wallet|cash|card|esewa|khalti)`, `notes`, `cancel_reason`,
timestamps. Indexed on `(user_id, created_at)`, `(driver_id, created_at)`, `status`.

**Booking status machine**

```
draft → pending → assigned → arriving → arrived → started → completed
   └────────────┴──────────→ cancelled
   └────────────→ rejected
```

Every transition is auto-logged to `booking_status_history` by trigger.

### booking_status_history
`id`, `booking_id`, `status`, `note`, `created_by`, `created_at`. Immutable audit trail.

### trip_locations
`id bigint identity`, `booking_id`, `driver_id`, `lat`, `lng`, `heading`, `speed_kmh`,
`recorded_at`. GPS breadcrumbs for live tracking; insert restricted to the assigned driver.

### ratings
`id`, `booking_id (unique)`, `user_id`, `driver_id`, `rating 1–5`, `feedback`,
`tip_amount`, `created_at`. Insert upserts the driver's aggregate `rating` + `total_rides`.

### notifications
`id`, `user_id`, `title`, `body`, `type (booking|trip|promo|system)`, `booking_id`, `read`,
`created_at`.

### saved_places
`id`, `user_id`, `name`, `address`, `lat`, `lng`, `type (home|work|other)`, `created_at`.

### support_requests
`id`, `user_id`, `subject`, `message`, `status (open|closed)`, `created_at`.

### identity_documents
Private document **metadata only**; image bytes live in the private `identity-documents` bucket.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | random identity |
| account_id | uuid → profiles | owner; must match `auth.uid()` |
| driver_id | uuid → drivers, nullable | required scope for licence; must belong to the account |
| vehicle_id | uuid → ambulances, nullable | Blue Book scope; must belong to the account |
| document_type | text | `CITIZENSHIP` \| `DRIVING_LICENSE` \| `VEHICLE_BLUE_BOOK` |
| original_filename | text | sanitised display name only |
| mime_type | text | detected `image/jpeg` \| `image/png` \| `image/heic` \| `image/heif` |
| file_size | bigint | 1–8388608 bytes |
| storage_bucket | text | always `identity-documents` |
| storage_path | text | `<account-uuid>/<type>/<random-id>.<ext>` |
| upload_status | text | `PENDING_UPLOAD` \| `UPLOADING` \| `UPLOADED` \| `UPLOAD_FAILED` \| `REMOVED` |
| created_at / updated_at | timestamptz | trigger-maintained |

Owner triggers reject foreign accounts, wrong buckets/paths, cross-account drivers/vehicles and
out-of-scope citizenship rows. A replacement marks the previous same-scope document `REMOVED`.

### registration_applications

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| reference_id | text unique | displayed to the applicant |
| account_id | uuid → profiles | owner |
| application_type | text | `USER` \| `DRIVER` |
| status | text | `DRAFT`, `SUBMITTED`, `PENDING_VERIFICATION`, `APPROVED`, `REJECTED`, `ADDITIONAL_INFORMATION_REQUIRED` |
| status_reason | text | reviewer note; not set by the client |
| submitted_at | timestamptz | set by the submission RPC |
| last_status_update | timestamptz | mirrored/tracked update time |
| created_at / updated_at | timestamptz | trigger-maintained |

Unique `(account_id, application_type)`. New submissions become `PENDING_VERIFICATION`. The
existing `drivers.status` remains the driver approval source: `verified` mirrors to `APPROVED`,
`rejected` mirrors to `REJECTED`. There is no client approval path and no auto-approval.

### Private Storage bucket

`storage.buckets.id = 'identity-documents'` with `public = false`, 8 MB limit and image-only
MIME allow-list. Storage RLS permits an authenticated account to access only objects under
`<auth.uid()>/…`. There is no public read policy and no public URL is exposed to the app.

## RPC

### `accept_booking(p_booking_id uuid, p_ambulance_id uuid) → bookings`
Atomic compare-and-set: verifies the caller is a **verified** driver, then updates the booking
only while `status = 'pending'`. Concurrent double-accept attempts fail with
*"booking is no longer available"*. This is the safest assignment path available without a
custom backend.

### `submit_identity_application(p_application_type text) → registration_applications`
Requires an authenticated account. Re-checks the profile fields, required uploaded metadata and the
actual private Storage objects before inserting/returning the application. New applications are
`PENDING_VERIFICATION`; repeated calls return the existing row rather than duplicating or approving
it. Driver submissions require licence expiry plus a Blue Book linked to the driver's newest vehicle.

## Currency & data-minimisation notes

- Default currency **NPR**; fares stored as `numeric(10,2)`.
- Only minimal patient transport details are collected (name/age/condition are optional).
  No diagnosis, prescription, or clinical history fields exist.
- Identity documents are images held in private Storage; Postgres stores metadata only.
  Citizenship numbers are sensitive PII stored in `profiles`, protected by RLS.
