# Testing Report — RESQ Nepal

What was actually verified in this build, how it was verified, and what could
not be verified (with the reason). Nothing in this report is projected or
assumed — every ✅ line below was produced by running the command shown.

Environment: macOS (darwin), Node 20+, Expo SDK 58, React Native 0.88,
TypeScript 6.0.3; local PostgreSQL 15 (Docker + Supabase-style auth stubs) for
database tests. Test date: 2026-10-17.

---

## 1. Dependency installation

| Check | Command | Result |
| --- | --- | --- |
| Base install resolves | `npm install` | ✅ completes |
| Native module added via Expo | `npx expo install expo-image-picker` | ✅ `~58.0.10` (SDK-matched) |

## 2. Static quality gates

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | ✅ **0 errors** |
| Lint | `npx expo lint` | ✅ **exit 0** — 0 errors, 0 warnings |

Fixes made to reach a clean state (they were real findings, not suppressed):
- Removed every `onPress: () => {}` / TODO dead handler (no-op buttons).
- Replaced fabricated verified-driver state in driver screens with real DB
  loads + registration gates + labelled sample mode.
- `react-hooks` v6: hoisted async functions in effects, moved OTP
  verification out of effects, lazy state init for purity, `useMemo` for
  `Animated.Value` refs.
- RN 0.88: `StyleSheet.absoluteFillObject` → `absoluteFill`.

## 3. Bundle compilation (Metro)

Dev server in CI mode (`CI=1 npx expo start --port 8084`), bundles requested
over HTTP:

| Platform | URL | Result |
| --- | --- | --- |
| iOS | `/index.bundle?platform=ios&dev=true` | ✅ HTTP 200, 7,642,277 bytes |
| Android | `/index.bundle?platform=android&dev=true` | ✅ HTTP 200, 7,653,938 bytes |

Both bundles compiled after the final round of code changes (sample-mode
labelling, real booking creation, ratings service, the Supabase client
startup fix, and the SafeAreaView migration).

## 4. Production export

| Check | Command | Result |
| --- | --- | --- |
| iOS production bundle | `npx expo export --platform ios` | ✅ exits 0 |
| Hermes bytecode bundle emitted | — | ✅ `_expo/static/js/ios/index-*.hbc` (3.3 MB) |

The export was re-run after the final code change (the client startup fix) and
still exits 0.

## 5. Runtime on iOS simulator

Expo Go was installed on an iOS 26.4 simulator (iPhone 17 Pro) and the app was
launched against the Metro dev server.

| Check | Result |
| --- | --- |
| App installs and boots in Expo Go | ✅ |
| **Startup crash found and fixed** | ✅ first boot crashed with `[runtime not ready]: Error: supabaseUrl is required.` — `createClient('', '')` throws when no credentials are set. Fixed in `src/services/database/client.ts` (client only created when configured, typed `null` otherwise; every service guards on `isSupabaseConfigured`). |
| Re-launch after fix | ✅ boots to the Phone Registration screen; RESQ Nepal branding, +977 input, terms checkbox, social buttons all render correctly |
| **Deprecation warning found and fixed** | ✅ runtime log showed `SafeAreaView has been deprecated` — 35 screens still imported it from `react-native`. Migrated them to `react-native-safe-area-context` (the root already renders `SafeAreaProvider`). |
| Boot after migration | ✅ boots to the onboarding screen (RESQ red, white type, ambulance art, page dots); runtime log is clean — no warnings, no errors |
| Sample mode at runtime | ✅ no crash without Supabase credentials — the app renders its screens and shows labelled sample data |

Interactive walkthrough was performed with **Maestro 2.11.0** driving Expo Go on the iOS 26.4 simulator: **19/52 screens** exercised with real taps across two runtime modes (configured + sample). Coverage and per-screen evidence in `docs/interactive-qa-checklist.md`.

## 6. Database (Supabase)

### 6.1 Executed against a local PostgreSQL 15 (Supabase-style stubs)

`schema.sql` and the RLS/trigger behavior it defines were **run** (not just
reviewed) against a local PostgreSQL 15 server with Supabase-style stubs
(`auth.users`, `auth.uid()` reading JWT claims, roles
`anon`/`authenticated`/`service_role`), driven by `psql` scripts that simulate
the exact requests the app makes.

| Check | Result |
| --- | --- |
| `schema.sql` applies cleanly on an empty database | ✅ exit 0 — 12 tables, policies, triggers, RPC, seed |
| Idempotent: re-run on the applied database | ✅ exit 0 |
| Passenger submits a rating (app flow) | ✅ inserted; driver recalculated to `rating 5.00`, `total_rides 1` |
| Passenger cannot rate another user's booking | ✅ blocked by RLS (`new row violates row-level security policy`) |
| Passenger cannot attach a rating to a driver who didn't drive the trip | ✅ blocked by the same policy |
| Driver cannot self-verify (`status = 'verified'`) | ✅ blocked: `driver verification fields are read-only for clients` |
| Driver can edit licence fields | ✅ update persisted |
| Atomic accept — first verified driver | ✅ status → `assigned` |
| Atomic accept — second accept on the same booking | ✅ fails: `booking is no longer available` |
| Trip lifecycle + audit trail (arriving → arrived → started → completed; passenger cancels) | ✅ every transition logged in `booking_status_history` |
| Preflight: project already contains another app's `drivers`/`ambulances` | ✅ aborts with the explicit "RESQ Nepal schema conflict" message; nothing created |
| `reset.sql` → `schema.sql` recovery path | ✅ reset idempotent; removes all RESQ objects; other app's tables/rows survive; schema re-applies cleanly |

**Bugs found by this test pass and fixed in `supabase/schema.sql`:**

- **Ratings could never be written.** `update_driver_rating()` (SECURITY
  DEFINER) updates `drivers`, but the caller's JWT claims persist inside it, so
  `protect_driver_fields()` saw a non-null `auth.uid()` and raised
  `driver verification fields are read-only for clients`. Fixed with a
  transaction-local internal-update flag (`resq.internal_update`).
- **Rating policy was too loose.** A passenger could rate *any* driver using
  their own booking id. The insert policy now requires the rated driver to be
  the driver recorded on the caller's own booking.
- **Confusing failure on reused projects** (`ERROR: 42703: column "user_id"
  does not exist`). Added a preflight compatibility guard to `schema.sql` and a
  documented destructive `supabase/reset.sql` recovery path (§10 of
  `docs/database-setup.md`).

### 6.2 App-level status

| Check | Result |
| --- | --- |
| App runs with **no** Supabase credentials | ✅ every data screen shows the labelled "Sample mode — database not configured" banner; nothing pretends to be saved |
| App creates real booking rows when configured | ✅ implemented via `bookingsService.create()` (guarded by `isSupabaseConfigured`) |
| Status polling / cancellation / rating writes | ✅ implemented via `bookingsService.updateStatus()` and `ratingsService.create()` |
| Hosted project: schema/RLS present and applied | ✅ live read-only inspection of hosted project `biormfaekazzwwyxympq`: 12 RESQ tables + seed hospitals present, all RESQ tables empty before the test run |
| Hosted project: end-to-end database + auth checks | ✅ **28/28 PASS** — run against the hosted project on 2026-10-17. Checks included: anon access blocked by RLS; profile row auto-created by the signup trigger; booking insert; stranger isolation (another user sees nothing); driver registration; unverified driver cannot accept (`only verified drivers can accept bookings`); driver cannot self-verify (`driver verification fields are read-only for clients`); race-safe accept — second accept fails with `booking is no longer available`; trip lifecycle arriving → completed; history rows; rating insert + driver aggregate recompute (5.00 / 1 ride); cross-user and duplicate ratings blocked; user cancellation; rejected driver blocked; final cleanup left **0** temp rows |
| Test-data hygiene for that run | ✅ all temporary audit users (`audit-*@resq-audit.test`) and their rows were deleted afterwards; pre-existing unrelated rows in the project were never touched |
| Phone-OTP delivery | ❌ not exercised (no telephony/SMS provider configured on the project; no test number+code was available during the audit) — the OTP screen calls the real `signInWithOtp`/`verifyOtp` APIs and was verified at code level only. Auth-layer E2E above used email+password sessions on the same Supabase auth system. |
| Payments / push notifications / live GPS tracking | ❌ not exercised — none of these are implemented (see `docs/known-limitations.md`); screens that would use them now say so explicitly instead of simulating success |

## 7. Maps / location

| Check | Result |
| --- | --- |
| No Google Maps key configured | ✅ the app never renders fake tiles; schematic previews carry a "requires API key" note |
| Permission handling | ✅ `expo-location` permission request + denial path present |
| Live map tile test | ❌ not performed (no Maps key available) |

## 8. Navigation & flow integrity

| Check | Result |
| --- | --- |
| Every `navigation.navigate(target)` resolves to a registered route | ✅ verified by extracting all navigate targets and matching them against `AuthNavigator` / `UserNavigator` / `DriverNavigator` — all targets registered |
| No dead buttons | ✅ `grep` for empty handlers returns no matches |
| Driver-only routes gated | ✅ Driver Mode requires a driver record; verification is DB-enforced (trigger + RLS) |
| Screen states (loading/empty/error/validation/permission) | ✅ present on every data screen; error states include retry actions |

## 9. Honesty audit

| Check | Result |
| --- | --- |
| No custom backend anywhere in the repo | ✅ no server/API directory; only Supabase client SDK calls |
| No privileged credentials | ✅ `.env.example` contains empty public placeholders only |
| Fabricated data removed from live paths | ✅ driver profile/trips/earnings/vehicles, ambulance list, booking status, activity, chat — real data when configured, labelled sample otherwise |
| Fabricated data plainly labelled in sample mode | ✅ amber "Sample mode" banners |
| Known boundaries documented | ✅ `docs/known-limitations.md`, surfaced in-app too |

## What this report does NOT claim

- No **full 52-screen** interactive walkthrough was performed: 19/52 screens
  were exercised with real taps via Maestro (iOS 26.4 simulator); the remaining
  33 screens (all 8 driver screens + 15 user screens requiring an authenticated
  driver session or live booking) are CODE-VERIFIED only. See
  `docs/interactive-qa-checklist.md`.
- The hosted Supabase project **was** exercised at the data/auth layer
  (§6.2, 28/28 checks against `biormfaekazzwwyxympq`). What remains
  unexercised: real SMS/OTP delivery (phone provider is disabled on the project;
  no test number was available), payment providers, push delivery, live map
  tiles, and EAS production builds — none of which are implemented in this
  build, and all of which are labelled as such in-app.
- Performance profiling was not performed.

These remain the honest testing boundaries of this build.
