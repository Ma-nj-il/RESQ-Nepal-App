# RESQ Nepal — Backend Integration Readiness

**Date:** 2026-10-19 · **Scope:** what the mobile client needs from the backend to move from
demo/local to live, what is already deployed, what is verified vs blocked, and the exact
owner-approved steps to connect it.
**Companion documents:** `docs/resq-comprehensive-engineering-audit.md` (defects),
`docs/resq-qa-evidence.md` (test evidence), `docs/database-schema.md` (DDL),
`docs/identity-registration-status-implementation.md` (identity PASS/BLOCKED record),
`docs/future-api-contracts.md` (HTTP API shape for a later backend).

---

## 1. Architecture as built

```
Expo (React Native 0.88 / SDK 58)
  └─ @supabase/supabase-js (anon key only, AsyncStorage session)
       ├─ Auth        phone OTP (signInWithOtp / verifyOtp)          [provider DISABLED on hosted]
       ├─ Postgres    RLS-protected tables + 2 RPCs                  [base schema live]
       └─ Storage     private bucket identity-documents              [NOT deployed]
```

- There is **no custom backend** and **no service-role key anywhere in the app** (verified: no
  `service_role`/secret references in `src/`, `supabase/` or `.env.example`).
- `.env` is git-ignored; only `.env.example` is tracked. The client uses exactly three public
  variables: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and the optional
  `EXPO_PUBLIC_OSM_TILE_URL`, plus the non-secret `EXPO_PUBLIC_DEMO_MODE` flag.
- Demo mode (`EXPO_PUBLIC_DEMO_MODE=true`) intercepts auth (OTP `1234`), booking creation, driver
  requests/trips and identity uploads; it **never writes** to Supabase and labels every fabricated
  element in the UI. Live mode without credentials falls back to honest error states, never fake
  success.

## 2. Deployment state

| Asset | File | Hosted status | Verified how |
|---|---|---|---|
| Base schema + RLS + RPCs + hospital seed | `supabase/schema.sql` | **Applied** (real hospital row read in the live flow) | Live read through the app |
| `accept_booking` ownership hardening | `supabase/patches/accept_booking_ownership_guard.sql` | **NOT applied** | Local PostgreSQL 15.8 harness (pre/post reproduction), prior session |
| Assigned-crew visibility RPC | `supabase/patches/assigned_crew_visibility.sql` | **NOT applied** | Local harness `verify_assigned_crew_visibility.sql`, prior session |
| Identity registration migration | `supabase/migrations/20261019_identity_registration.sql` | **NOT applied** | Local PostgreSQL 16 stub harness PASS (prior session; Docker unavailable this session) |
| Identity storage migration + private bucket | `supabase/migrations/20261019_identity_storage.sql` | **NOT applied** | Same harness; **binary Storage transport never tested** |
| Phone OTP provider | Supabase Auth settings | **Disabled** | App shows honest “provider not enabled” on send |
| Booking state-machine guard (recommended) | *does not exist yet* — spec §5 | **NOT written/applied** | — |
| Push notifications / dispatch worker / Realtime | — | **Not implemented** | — |

## 3. Client ↔ backend surface (complete)

| Client service | Table / RPC | Operations used | Behaviour when unconfigured or in demo |
|---|---|---|---|
| `database/profiles.ts` | `profiles` | select/update own | demo keeps profile in memory only |
| `database/drivers.ts` | `drivers` | select own, insert `pending` application | demo never inserts |
| `database/ambulances.ts` | `ambulances` | select available/own, insert/update own vehicle | demo shows local draft |
| `database/hospitals.ts` | `hospitals` | reference read (seed) | local sample list when offline |
| `database/bookings.ts` | `bookings`, `booking_status_history` | insert own, select involved, `updateStatus` | demo never inserts; live polling while focused |
| `database/trips.ts` | `trip_locations` | insert (assigned driver), latest/trail read | **no callers wired yet** (limitation §12) |
| `database/ratings.ts` | `ratings` | insert once per booking, aggregates trigger | demo rating stays local |
| `database/notifications.ts` | `notifications` | select own, mark read, insert own | demo shows sample list |
| `database/savedPlaces.ts` | `saved_places` | CRUD own | demo shows honest “needs a real account” |
| `database/supportRequests.ts` | `support_requests` | insert own | demo shows notice |
| `database/assignedCrew.ts` | RPC `get_assigned_crew` | read crew for owned booking | **RPC not deployed** → neutral fallback, no invented data |
| `database/identity.ts` | `identity_documents`, `registration_applications`, RPC `submit_identity_application`, Storage bucket | metadata CRUD, private upload/signed URL, submission | **not deployed** → honest “not enabled” error; demo never uploads |
| `auth/authService.ts` | Supabase Auth | `signInWithOtp`, `verifyOtp`, `signOut`, `getSession`, `updatePassword`, `onAuthStateChange` | demo OTP `1234`, in-memory session |
| Local-only services | — | `savedHospitalsService`, `emergencyContactsService`, `sosService` (AsyncStorage); `walletStore`, driver demo store (memory) | labelled local/demo |
| `stats/tripCounts.ts` | derived from `bookings` | counts for world/account cards | sample counts labelled |

RPCs in the codebase: `accept_booking(p_booking_id, p_ambulance_id)` (live in base schema,
ownership guard pending) and `submit_identity_application(p_application_type)` (not deployed).

## 4. Live booking lifecycle — what actually happens today

1. **Create** — the patient app inserts a `bookings` row (`status='pending'`, category
   `basic|icu`, real coordinates when available). Only the signed-in user's own name/phone are
   sent; `estimated_fare` only when a rate-card estimate exists; `ambulance_id` only when a real
   UUID exists.
2. **Search** — there is **no server-side search**. The pending row waits for a verified driver
   to see it. The app’s radar is a labelled client-side animation, not a query.
3. **Assign** — a verified driver accepts through the atomic `accept_booking` RPC (compare-and-set
   on `status='pending'`, guarded by the pending patch when deployed).
4. **Progress** — the driver app writes `arriving → arrived → started → completed` via
   `bookingsService.updateStatus`; the patient app polls the row every 8 s while the status screen
   is focused. `booking_status_history` records each status change.
5. **Crew display** — without the `get_assigned_crew` patch the patient sees “crew assigned” but
   no name/plate/phone; the Call Driver action reports contact unavailable instead of inventing one.
6. **Location** — never streamed: the driver app has no recording loop and the patient map never
   reads `trip_locations`; maps are labelled straight-line previews.
7. **Close** — rating writes to `ratings` (aggregate trigger updates the driver); tips are stored
   on the rating row. No payment capture exists.

## 5. Security finding & required migration (O-1, P1)

**Finding.** `public.bookings` policy `bookings_update_involved` checks only *who* may update a
row (owner or assigned driver), not *what* may change:

```sql
for update using (auth.uid() = user_id
  or exists (select 1 from public.drivers d
             where d.id = driver_id and d.user_id = auth.uid()));
```

A modified client can therefore set `status`, `driver_id`, `ambulance_id`, `final_fare`, or
patient/route fields on its own booking outside any legitimate transition. The shipped app only
sends valid transitions, but the database does not enforce that.

**Required change (written as `supabase/migrations/20261019_booking_state_guard.sql`, tested via local SQL harness script `qa/sql/verify_booking_state_guard.sh`):** A forward migration adding a `BEFORE INSERT OR UPDATE` trigger on `public.bookings` that:

- returns `NEW` unchanged when `auth.uid()` is null (service-role/maintenance context);
- identifies the actor: owner (`OLD.user_id = auth.uid()`) or currently assigned driver (`OLD.driver_id = actor_driver_id`), or a verified driver taking a pending booking;
- enforces the transition allow-list:
  - owner: `pending`, `assigned`, `arriving`, `arrived`, `started -> cancelled`;
  - verified driver taking over a pending booking (the RPC path): `pending→assigned` **only** when
     `NEW.driver_id` equals that driver’s id and the ambulance (if provided) belongs to them;
  - assigned driver: `assigned→arriving`, `assigned→arrived`, `arriving→arrived`, `arrived→started`, `started→completed`;
- rejects any change to immutable columns (`user_id`, pickup/destination fields, `category`,
  `patient_*`, `estimated_fare`, `final_fare`, etc.);
- raises a human-readable exception (SQLSTATE `42501`), which the client surfaces as an error rather than a fake success.

**Validation status:** Migration file and local regression test suite (`qa/sql/test_booking_state_guard.sql`) are fully created. Local execution is currently **BLOCKED** due to host volume capacity limits (`/System/Volumes/Data` at 100% capacity preventing Docker container startup); see `docs/booking-security-predeployment-audit.md` for full threat model and deployment instructions.

## 6. Missing capabilities the backend must provide to claim “live”

| Capability | Minimum contract |
|---|---|
| Dispatch / matching | Server-side fan-out of new pending bookings to eligible verified drivers (Realtime channel or push), ordering/timeout/reassign policy, unassign on decline |
| Push delivery | `expo-notifications` token registration + a sender (Edge Function/cron or backend) for booking events |
| Live vehicle location | Driver-side foreground recording loop → `trip_locations`; patient subscription via Realtime (enable replication) or adaptive polling; retention policy |
| Crew visibility | Deploy `get_assigned_crew` (already written/verified) |
| Booking integrity | State-machine trigger (§5) |
| Identity activation | Deploy both identity migrations + private bucket; add an operator review surface for `registration_applications` / `drivers.status` |
| Auth | Enable phone OTP with an SMS provider, or add email/other sign-in; verify one real end-to-end signup |
| Chat / call | Realtime `messages` table or a calling SDK; the current UI is local-only and unreachable from the live path |
| Payments | Merchant credentials + server-side signature verification; **out of current product scope** |
| Storage lifecycle | Service-role cleanup/retention for `identity-documents` objects on account deletion |

## 7. Connection plan (owner-approved, in order)

1. **Back up function definitions** for rollback:
   `select pg_get_functiondef('public.accept_booking(uuid,uuid)'::regprocedure);`
2. **Apply `accept_booking` ownership guard** (`supabase/patches/accept_booking_ownership_guard.sql`)
   in the SQL Editor; verify with `verify_accept_booking_ownership.sql` (transactional, rolled back).
3. **Apply `assigned_crew_visibility.sql`**; verify with `verify_assigned_crew_visibility.sql`.
4. **Write + locally verify the state-machine migration** (§5), then apply it; negative tests must
   fail with the new exception and leave rows untouched.
5. **Apply identity migrations** (`20261019_identity_registration.sql`,
   `20261019_identity_storage.sql`) and confirm the private `identity-documents` bucket exists with
   the image MIME allow-list and size cap; re-run `qa/sql/verify_identity_registration.sh`.
6. **Enable phone OTP** with the SMS provider; complete one real signup → upload two documents →
   submit → read Application Status on a staging account. Delete the test documents afterwards.
7. **Smoke the live booking path** with two accounts (patient + verified driver): create booking →
   driver accepts → patient sees crew → status transitions → rating. Confirm `booking_status_history`
   rows and that an invalid transition is rejected.
8. **Then** wire dispatch/push (capability table above); re-run `docs/resq-qa-evidence.md` §6.

Every step above is **manual owner action**; the app makes no schema, RLS or bucket changes at
runtime, and this workspace has not modified the hosted project.

## 8. Build/release readiness

- Expo Continuous Native Generation: no `ios/`/`android/` directories are checked in; app config
  lives in `app.json` (image-picker plugin, camera-only, microphone disabled).
- Map tiles render from OpenStreetMap through `react-native-webview` with no API key. Set
  `EXPO_PUBLIC_OSM_TILE_URL` to a production tile provider before store traffic
  (`docs/maps-setup.md`); Expo Go’s bundled WebView is the current test surface.
- Required build profile env: Supabase URL + anon key, optional OSM tile URL, and
  `EXPO_PUBLIC_DEMO_MODE` **unset/`false`** for any real build. A production build with demo mode
  on would still write nothing, but must not ship as the real experience.
- No push entitlements, no background location modes and no payment SDK are configured — intentional
  until the corresponding backend capability exists.

## 9. Handoff checklist

- [ ] Decide on O-1 migration (owner) and apply in the §7 order
- [ ] Deploy the two hardening patches and record verification output
- [ ] Deploy identity migrations + bucket; complete a staging upload/status cycle
- [ ] Enable OTP; verify one real signup
- [ ] Provide dispatch/push and location contracts; then update `docs/known-limitations.md` §2/§12/§14
- [ ] Add operator review surface for identity/driver approvals
- [ ] Re-run gates + flows after each deployment and update `docs/resq-qa-evidence.md`
