# RESQ Nepal — Booking Security Pre-Deployment Audit & O-1 Resolution

**Date:** 2026-10-19  
**Status:** **MIGRATION WRITTEN & TEST HARNESS PREPARED — SQL EXECUTION BLOCKED (INFRASTRUCTURE)**  
**Scope:** P1 booking update authorization security fix (O-1), threat analysis, deployment audit, and safe execution plan.  
**Safety Confirmation:** No hosted Supabase schema, RLS policy, storage bucket, or auth settings were modified. No commits, git resets, stashes, or destructive git operations were executed. All uncommitted work is preserved.

---

## 1. Confirmed Root Cause & Affected Operations

### Root Cause (O-1)
In `supabase/schema.sql`, the `public.bookings` row-level security policy `bookings_update_involved` enforces *who* may update a booking row (either the patient who created it (`user_id = auth.uid()`) or the assigned driver (`exists (select 1 from drivers d where d.id = driver_id and d.user_id = auth.uid())`)). However, RLS policies in PostgreSQL cannot inspect columns or compare `OLD` vs `NEW` state transitions. Consequently, any authenticated user permitted by `USING` could modify any column on their own or assigned booking row—including `status`, `driver_id`, `ambulance_id`, `final_fare`, and immutable pickup/destination or patient details.

### Affected Operations
- **Falsification of Trip Status:** A malicious client could directly update a `pending` booking to `completed` or `cancelled` without going through driver workflows or legitimate cancellation.
- **Driver / Ambulance Attribution Tampering:** A patient or third party could reassign `driver_id` or `ambulance_id` arbitrarily.
- **Fare Manipulation:** A client could attempt to overwrite `final_fare` or `estimated_fare`.

---

## 2. Implemented Migration Summary

- **Filename:** `supabase/migrations/20261019_booking_state_guard.sql`
- **Mechanism:** A `BEFORE INSERT OR UPDATE` trigger function (`enforce_booking_write_guard()`) operating with `security definer` (`set search_path = public, pg_temp`).
- **Idempotency:** Uses `create or replace function` and `drop trigger if exists` so it can be re-run safely.
- **Allowed Client Actions:**
  1. **INSERT:** Must belong to `auth.uid()`, start in `pending`, with NULL driver/ambulance/final_fare.
  2. **Patient Owner Cancellation:** May transition `pending`, `assigned`, `arriving`, `arrived`, or `started` to `cancelled`, setting `cancel_reason`.
  3. **Verified Driver Takeover (RPC path):** `pending -> assigned` permitted only when the caller is a verified driver (`drivers.status = 'verified'`) matching `NEW.driver_id`, with ambulance ownership validation.
  4. **Driver Trip Progress:** Permitted linear transitions:
     - `assigned -> arriving` or `assigned -> arrived`
     - `arriving -> arrived`
     - `arrived -> started`
     - `started -> completed`
  5. **Idempotent No-Ops:** Status-unchanged double taps with no protected field changes are allowed.
  6. **Referential Cleanup:** Allows `ambulance_id` to clear to NULL when the underlying vehicle is deleted by its owner via `ambulances_delete_own`.
- **Blocked:** Any unauthorized state jump, fare mutation, or attribute reassignment raises SQLSTATE `42501` (`insufficient_privilege` / custom error message).

---

## 3. Test Harness & Execution Status

- **TypeScript Gate (`npx tsc --noEmit`):** **PASS** (Exit 0)
- **Expo Lint (`npx expo lint`):** **PASS** (Exit 0)
- **Unit Tests (`npm run test:unit`):** **PASS** (18/18)
- **iOS App Bundle Export (`npx expo export --platform ios`):** **PASS** (`dist/index-e1a56ef71cc080d4f707b67f0f3f8200.hbc`, 3.7 MB)
- **SQL Regression Tests (`qa/sql/test_booking_state_guard.sql` & `qa/sql/verify_booking_state_guard.sh`):** **BLOCKED**
  - **Reason:** Local Docker verification container cannot start because the system writable Data volume (`/System/Volumes/Data`) is at **100% capacity** (1.8 GiB free of 228 GiB), triggering Docker daemon engine failures (`write init.log: no space left on device`).
  - **Safety Note:** In strict compliance with safety rules ("Do not run git reset, clean, stash... or destructive commands"), system cleanup was avoided. The test harness script and regression test file are fully written and ready to execute once disk space is freed and Docker restarts.

---

## 4. Remaining Blocked / Untested Items

1. **Database-layer SQL Execution:** Unverified locally due to host disk/Docker capacity.
2. **Hosted Supabase Deployment:** Unapplied (requires manual owner execution in the Supabase Dashboard SQL Editor).
3. **Live End-to-End Two-Account Smoke Test:** Requires hosted deployment + phone OTP + live credentials.

---

## 5. Deployment Prerequisites & Safe Execution Order

Before applying any migration to the hosted Supabase project, the owner must complete the following sequence:

1. **Free Host Disk Space:** Ensure sufficient free space on the target database / server environment.
2. **Back up Functions:** Export current function definitions for rollback:
   ```sql
   select pg_get_functiondef('public.accept_booking(uuid,uuid)'::regprocedure);
   ```
3. **Step 1 — Apply `accept_booking` Ownership Guard:**
   - Execute `supabase/patches/accept_booking_ownership_guard.sql`.
   - Verify with `supabase/patches/verify_accept_booking_ownership.sql` (transactional, rolled back).
4. **Step 2 — Apply Crew Visibility:**
   - Execute `supabase/patches/assigned_crew_visibility.sql`.
5. **Step 3 — Apply Booking State-Machine Guard:**
   - Execute `supabase/migrations/20261019_booking_state_guard.sql`.
   - Run `qa/sql/test_booking_state_guard.sql` to confirm all assertions pass.
6. **Step 4 — Apply Identity Registrations:**
   - Execute `20261019_identity_registration.sql` and `20261019_identity_storage.sql`.
   - Verify private bucket `identity-documents` configuration.
7. **Step 5 — Enable Phone OTP & Live Smoke Test:**
   - Configure SMS provider, test sign-up, driver acceptance, and trip progression.

---

## 6. Rollback Considerations

- **To rollback `accept_booking`:** Re-run the original definition saved in step 2.
- **To rollback the booking state guard:**
  ```sql
  drop trigger if exists bookings_guard_writes on public.bookings;
  drop function if exists public.enforce_booking_write_guard();
  ```

---

## 7. Explicit Confirmations

- **No Hosted Changes:** None.
- **No Git State Modification:** Repo HEAD (`0971e76`) remains unchanged; dirty tree preserved.
- **No Secrets Exposed:** Zero keys or tokens included in documentation or logs.
- **Mobile Integrity Maintained:** React Navigation stack, Expo SDK config, UI identity, and demo write-guards are untouched.
