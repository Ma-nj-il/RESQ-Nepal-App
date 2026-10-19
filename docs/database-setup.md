# RESQ Nepal — Database Setup (Supabase)

RESQ Nepal connects **directly from the mobile app to a managed Postgres database** using the
official `@supabase/supabase-js` client. There is no custom backend server anywhere in this
project.

## 1. Why Supabase

- Official React Native-compatible SDK (`@supabase/supabase-js`) — no custom server needed.
- Postgres + Row Level Security lets the client safely read/write its own data.
- Built-in phone/OTP & email auth so the auth flow needs no custom endpoints.
- Free tier is sufficient for development and small deployments.

## 2. Create the project

1. Go to <https://supabase.com> → **New project**.
2. Choose a region close to Nepal (e.g. `ap-south-1` Mumbai / `ap-southeast-1` Singapore).
3. Save the database password somewhere safe (it is **never** used by the app).
4. Wait for provisioning to finish.

## 3. Apply the schema

1. In the Supabase dashboard open **SQL Editor → New query**.
2. Paste the entire contents of `supabase/schema.sql`.
3. Click **Run**. The script is idempotent — safe to re-run.

This creates: `profiles`, `hospitals`, `drivers`, `driver_verifications`, `ambulances`,
`bookings`, `booking_status_history`, `trip_locations`, `ratings`, `notifications`,
`saved_places`, `support_requests`, plus RLS policies, triggers and the `accept_booking()` RPC.

> **Use a dedicated project.** `schema.sql` starts with a preflight check. If the
> project already contains tables from another application that collide with the
> ones above (for example another app's `drivers`/`ambulances`), the script stops
> immediately with an explicit **"RESQ Nepal schema conflict"** message instead of
> failing halfway with a confusing column error. Fix options: see §10.

### 3.1 Identity-registration migrations (required for signup documents)

The base schema above does **not** include the identity tables or private Storage bucket. Apply the
forward-only migrations in this order:

1. `supabase/migrations/20261019_identity_registration.sql`
2. `supabase/migrations/20261019_identity_storage.sql`

Paste each file into **SQL Editor → New query → Run**. Do not edit an applied migration; add a new
forward migration instead.

These create:

- `profiles.citizenship_number`
- `identity_documents` (private metadata only — no image bytes or Base64)
- `registration_applications`
- owner/approval triggers, constraints, indexes and RLS
- the `submit_identity_application(text)` RPC
- the private `identity-documents` bucket with Storage RLS policies

> **Deployment gate:** these migrations have been verified only in a disposable local PostgreSQL
> container. They are **not applied to the hosted project** in this workspace. Apply them to a
> hosted project only with explicit owner approval; see
> `docs/identity-registration-status-implementation.md` §7.

## 4. Configure authentication

Dashboard → **Authentication → Providers**:

- **Phone**: enable. For development without an SMS provider, enable
  *Auth → Providers → Phone → Test OTP* — for example test number `+977 9800000000` with a
  fixed code. Production requires connecting Twilio/MessageBird (paid).
- **Email**: enabled by default (optional for OTP-less testing).

Dashboard → **Authentication → URL Configuration**: no action needed for a pure mobile client.
If you use email magic links later, add your deep-link redirect.

## 5. Configure the app

1. Copy the example file:

   ```bash
   cp .env.example .env
   ```

2. Dashboard → **Project Settings → API**:
   - Copy **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
   - Copy **anon / publishable key** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`

3. Fill `.env`:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=
   ```

4. Restart Metro (env changes need a restart):

   ```bash
   npx expo start --clear
   ```

### What is safe in the app

| Credential | In app? | Why |
|---|---|---|
| Project URL | ✅ Yes | Public endpoint |
| Anon / publishable key | ✅ Yes | Designed for client use; access gated by RLS |
| Service-role key | ❌ **Never** | Bypasses RLS — admin/server only |
| Database password | ❌ **Never** | Direct Postgres connection only |

The app checks `isSupabaseConfigured` (in `src/services/database/client.ts`) and clearly
surfaces a "database not configured" state instead of pretending to be connected.

## 6. Verify connectivity

1. Run the app (`npm run ios` / `npm run android`).
2. Sign up with a phone number (or the test OTP).
3. Complete personal info → a row appears in **Table Editor → profiles**.
4. Create a booking → a row appears in **bookings**, and the status change is logged in
   **booking_status_history**.
5. If the identity migrations are applied, complete citizenship capture → the private image exists
   under `identity-documents/<account-uuid>/…`, an `identity_documents` row is `UPLOADED`, and a
   `registration_applications` row is `PENDING_VERIFICATION` after submission.
6. Query your own application from the app's **Application Status** screen. A query from another
   account must return nothing (RLS).

### Verify the identity migration locally (no hosted project)

Docker is required:

```bash
./qa/sql/verify_identity_registration.sh
```

This starts a disposable PostgreSQL 16 container on port 55432, applies the schema and both
migrations twice (idempotency), then executes RLS/RPC/constraint assertions. It never reads the
hosted project credentials.

## 7. Promoting a driver (admin-only operation)

Driver verification cannot be self-granted from the app (protected by trigger + RLS). To verify
a driver during testing, run this in the SQL Editor as the project owner:

```sql
update public.drivers
set status = 'verified', verified_at = now()
where user_id = 'THE-USER-UUID';
```

Optionally insert a matching `ambulances` row for that driver.

The identity trigger mirrors this existing approval source into
`registration_applications`: `drivers.status = 'verified'` → application `APPROVED`;
`drivers.status = 'rejected'` → application `REJECTED`. Do not create a second driver-approval
column or update the application status independently of `drivers.status`.

## 8. Row Level Security summary

| Table | Read | Write |
|---|---|---|
| `profiles` | Own row only | Own row only |
| `drivers` | Own row | Insert as `pending` only; verification fields trigger-protected |
| `driver_verifications` | Own submissions | Insert `pending` only |
| `ambulances` | Available ones + own | Owner driver only |
| `bookings` | Patient, assigned driver, or any verified driver while `pending` | Patient creates; involved parties update |
| `booking_status_history` | Involved parties | Involved parties (auto-logged on status change) |
| `trip_locations` | Involved parties | Assigned driver only |
| `ratings` | Involved parties | Passenger's own booking, matched to its recorded driver |
| `notifications` / `saved_places` / `support_requests` | Own rows | Own rows |
| `identity_documents` | Own rows only | Own rows only (`UPLOADED`/`REMOVED` metadata; owner trigger enforced) |
| `registration_applications` | Own rows only | Submitted via RPC only; status mirrored from `drivers.status` |
| `storage.objects` (`identity-documents`) | Own UID folder only | Own UID folder only; bucket is private |
| `hospitals` | Everyone | Admin only (no client policy) |

## 9. Limitations of the client-only model

See `known-limitations.md`. In short: without trusted server-side code you cannot guarantee
*atomic* exclusive driver assignment across every edge case, cannot approve drivers securely from
the client (deliberately blocked), and cannot run payment capture. The `accept_booking()` RPC
provides a safe compare-and-set for the common concurrent-accept race.

## 10. Troubleshooting

### `ERROR: 42703: column "user_id" does not exist` — or a "RESQ Nepal schema conflict" message

The project already contains tables created by something else — often a Supabase project that was
previously used by another application, or leftovers from an older version of this schema.
`create table if not exists` silently skips a pre-existing table with the same name, and a later
statement that references a column the old table does not have then fails (a real example: another
app's `drivers` table has no `user_id` column).

Diagnose — run this in the SQL Editor to list what already exists:

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by 1;
```

Fix — choose one:

1. **New project (recommended when the tables belong to another app):** create a fresh Supabase
   project and apply `supabase/schema.sql` there. Your existing project is not modified or deleted
   in any way.
2. **Reset a dedicated development project:** if you are certain the project is not used by any
   other application and the RESQ Nepal data in it is disposable, run `supabase/reset.sql` in the
   SQL Editor (destructive: it deletes all RESQ Nepal tables, data and functions), then run
   `supabase/schema.sql` again.

After either fix, `schema.sql` completes without errors.

### `ERROR: driver verification fields are read-only for clients`

Expected when a client tries to change `status`, `rating`, `total_rides`, `verified_at` or
`rejection_reason` on `drivers` — including a driver trying to verify themselves. Admins verify
drivers with the SQL in §7.

### `Identity registration is not enabled on this database yet`

The identity migrations (§3.1) have not been applied to the connected Supabase project. The app shows
this error rather than pretending the data was saved. Apply the migrations with owner approval and
retry; do not work around it with public Storage or client-side approval.

### `Your session has expired. Please sign in again.`

The Supabase session is no longer valid. Use **Sign in again** on the Application Status screen and
re-authenticate. This is the expected auth-isolation path, not a reason to bypass RLS.

### Other expected errors

- `only verified drivers can accept bookings` — the account has no verified `drivers` row yet (§7).
- `booking is no longer available` — another driver accepted the same request first; this is the
  `accept_booking()` race guard working as intended.
- `citizenship number is already registered` / duplicate licence/plate — a unique identity constraint
  rejected a duplicate. Use the correct existing record; do not delete other accounts' rows.
