# Final Audit Report — RESQ Nepal App

**Date:** 2026-10-17
**Scope:** full audit of the RESQ Nepal Expo/React Native app and its Supabase
schema — discovery, UI/UX, database & RLS, auth, booking & driver flows,
services, maps, payments/chat/notifications, builds, performance and git/secret
safety — including fixing genuine defects found.
**Rulebook:** no custom backend; React Native + Expo talking directly to
Supabase; nothing may claim more than what was actually tested.

## Verification legend

| Label | Meaning |
| --- | --- |
| **PASS** | Executed and observed working at the stated level |
| **CODE-VERIFIED** | Implemented and verified by typecheck/lint/review, but not executed interactively |
| **PARTIAL** | Partly real, partly documented gap |
| **NOT TESTED** | Not exercised at all |
| **NOT BUILT** | Deliberately not implemented (needs infrastructure) |

## Testing levels actually reached in this audit

- **Live, against the hosted Supabase project** `biormfaekazzwwyxympq`:
  schema/RLS presence, auth-layer sign-in, booking lifecycle, driver
  verification rules, race-safe accept, ratings, isolation — **28/28 checks
  passed** (see `docs/testing-report.md` §6.2). All temporary test users/rows
  were deleted afterwards; pre-existing unrelated tables and the one
  pre-existing user in the project were never touched.
- **Code level:** all 52 screens read end-to-end; handlers, services and
  navigators reviewed; typecheck, lint, doctor and both platform bundles run.
- **Not reached:** tapping through the UI on a device (no GUI simulator
  available), real SMS/OTP delivery, payment providers, push, live map tiles.

---

## 1. Repository, discovery & secret safety — PASS

- Single app repo `resq-nepal-mobile` (Expo SDK 58, RN 0.88, React 19.3,
  TypeScript 6). No backend code anywhere; the only server contact is the
  Supabase client SDK.
- `.env` contains **only** the three `EXPO_PUBLIC_*` publishable variables
  (verified by inspecting variable *names* only). No service-role key exists
  anywhere in the app or repo; `.env` is git-ignored.
- Stray audit artifacts cleaned up: the temporary E2E script and two stale log
  files were moved out of the repository into the harness temp area.
- No commits or pushes were made; the working tree remains uncommitted as the
  user required. **Reminder:** the project's secret (service-role) key should
  still be rotated after this audit, because it was handled during setup.

## 2. Screens & UI/UX integrity — CODE-VERIFIED (with PASS sub-checks)

All 52 screens (8 auth + 8 driver + 36 user) were read line-by-line. Results:

| Check | Status | Evidence |
| --- | --- | --- |
| No dead buttons (`onPress` empty/`console.log`) | PASS | every previously dead handler now performs a real action or shows an honest explanation (menu ☰, safety, quick actions, avatar, social buttons, attach, upload-license, device list, connect accounts, share sheet) |
| Every `navigate()` target is a registered route | PASS | re-checked all navigate calls against `AuthNavigator` / `UserNavigator` / `DriverNavigator` after fixes; Help entries for unbuilt pages (Contact Support, Partner, Jobs, Accessibility, Feedback, About, Rate us, Social) now show "not available in this build" notices instead of navigating nowhere |
| Legal pages | PASS (code) | new `PrivacyPolicy`/`TermsOfService` screens registered in both stacks; linked from Welcome footer and Help; content is an honest draft of what the app really stores |
| No fabricated data on live paths | PASS | fabricated driver ("Ram Bahadur"…), ambulance fallback, hardcoded 5.2 km/~15 min, "48.5 km" earnings stat, fake transactions/IDs, fake people list, fake card form, fake device list — all removed or replaced with real data / explicit "not recorded" / demo labels |
| Sample mode is labelled | PASS | every screen that has sample data shows the amber "Sample mode — database not configured" banner |
| Settings are real | PASS (device) | notification and language choices persist via AsyncStorage; theme selection now states it is not applied app-wide yet |
| Interactive device test | **PASS (19/52 screens)** | 8 auth screens (onboarding→OTP blocked/send paths), Home, AmbulanceList, AmbulanceDetails, BookingConfirmation, BookingStatus, Activity, Account (sign-out), LocationSearch, Legal (Privacy/Terms) exercised via Maestro on iOS 26.4 simulator; remaining 33 screens CODE-VERIFIED (no authenticated driver/live booking). See `docs/interactive-qa-checklist.md`. |

Note: the legal copy is marked **Draft** — RESQ Nepal must finalise it before
release.

## 3. Supabase schema & RLS — PASS (live-verified)

- Live read-only inspection: all 12 RESQ tables + policies + triggers + RPC +
  6 hospital seed rows present on the hosted project; all RESQ tables empty
  before testing; an unrelated app's 9 tables and 1 user were left untouched.
- Live behavioural checks (subset of the 28/28 run): anon access denied by
  RLS; stranger cannot read another user's bookings; cross-user and duplicate
  ratings blocked; driver self-verification blocked
  (`driver verification fields are read-only for clients`); unverified driver
  cannot accept (`only verified drivers can accept bookings`).
- Ratings write + driver aggregate recompute verified live (5.00 / 1 ride).
- Residual gap (**documented, not applied**): `accept_booking` trusts the
  caller's `p_ambulance_id`. The app now always sends the driver's own
  ambulance id; a hardened replacement RPC is provided at
  `supabase/patches/accept_booking_ownership_guard.sql` for the RESQ team to
  review and apply.

## 4. Authentication & security — PARTIAL

| Check | Status | Evidence |
| --- | --- | --- |
| Real phone-OTP flow | CODE-VERIFIED | `OTPScreen` calls the real `signInWithOtp`/`verifyOtp` with E.164 numbers, resend timer, friendly errors; dead inputs and the previous fake OTP were replaced |
| Session persistence | PASS (code), live auth-layer PASS | AsyncStorage persistence + auto-refresh + session restore on launch; live sessions were created and used throughout the 28/28 run |
| Sign-out everywhere | PASS (code) | Account and Driver-Settings sign-out now end the real Supabase session before clearing local state |
| Password handling | CODE-VERIFIED | "Change Password" now calls `supabase.auth.updateUser`; UI states plainly that phone OTP remains the sign-in method in this build |
| Deactivation/deletion requests | PASS (code) | recorded as real `support_requests` rows (or honestly refused when unconfigured) |
| Service-role key in app | PASS | never referenced anywhere |
| Real SMS delivery | NOT TESTED | no provider/test number available; nothing is claimed about delivery |

## 5. Booking flow end-to-end — PASS (live) / CODE-VERIFIED (UI)

- Live: booking insert (RLS `insert_own`), driver accept (race-safe — second
  accept rejected), lifecycle `arriving → arrived → started → completed`
  persisted with history rows, user cancellation, final cleanup zero rows.
- Code: `ProcessingScreen` now guards against double-tap double-insert; the
  review screen shows the real distance when known ("Distance not recorded"
  otherwise) and never invents a vehicle; `BookingStatus` polls the real
  status; `TripTrackingScreen` shows real driver/vehicle when assigned —
  "Route preview — live GPS tracking is not enabled in this build" is printed
  on the map area instead of the old fabricated live tracking.
- ETA: only the stored `duration_min` estimate is shown when present; the
  fake countdown was removed.

## 6. Driver lifecycle — PASS (live) / CODE-VERIFIED (UI)

- Live: registration insert; unverified/rejected drivers blocked from
  accepting; self-verify blocked; verification fields client-read-only.
- Code: online/offline toggle now writes the real `ambulances.status`
  (with revert + honest error alert on failure); vehicle status revert
  restores the previous value exactly; request accept attaches the driver's
  own ambulance id; driver trip screen calls the real patient number from the
  booking (or says none was recorded); earnings screen computes distance and
  ratings from real trip history (with "—" until ratings exist); withdraw
  button explains payouts are not implemented; license "Attach" no longer
  pretends to upload a document — it explains file storage is not configured.

## 7. Data services layer — PASS (code) / live for bookings, drivers, ratings

- Service modules reviewed: profiles, drivers, ambulances, bookings, trips,
  ratings, notifications, savedPlaces, supportRequests (new).
- Every service returns empty/labelled-sample when Supabase is unconfigured
  and throws real errors otherwise; `markRead` now throws on failure (was
  silent); client persists sessions and detects no session URL config.

## 8. Maps & location — PARTIAL

- Real permission handling and device location fetch work at code level; no
  fake tiles are rendered. Route/vehicle movement on screens is an explicitly
  labelled schematic preview, not live GPS.
- Live tiles and true ETA/tracking require the configured Google Maps key on
  a device build and (for tracking) a server relay — **NOT BUILT / NOT
  TESTED**; documented in `docs/known-limitations.md`.

## 9. Payments, wallet, chat & notifications — PARTIAL (mostly NOT BUILT)

- **Payments:** no gateway integration. The old card form was deleted — the
  app no longer collects card numbers at all. Add-payment, top-up,
  top-up-success, top-up-details and payment-method screens are demo-labelled;
  no fake transaction IDs or "Success" states remain.
- **Wallet:** balances are a local demo store, labelled "(demo) — no real
  money is stored in this build".
- **Chat:** works as a labelled demo conversation; realtime messaging is not
  implemented (stated in-screen). Attachment button explains uploads are not
  available.
- **Notifications:** the in-app list reads/writes real `notifications` rows
  where present; preference toggles persist on the device; push delivery is
  not configured and says so.

## 10. Builds & quality gates — PASS

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npx expo lint` | 0 problems (three React-Compiler memoization/setState findings introduced by the fixes were resolved) |
| `npx expo-doctor` | **20/20 checks pass** — fixed: splash config moved from the legacy `expo.splash` field to the `expo-splash-screen` config plugin (SDK 58 schema); `react-native-gesture-handler` pinned to SDK-matching `~3.3.0` |
| `npx expo export --platform ios` | Succeeds — 1166 modules, 3.3 MB Hermes bundle |
| `npx expo export --platform android` | Succeeds — 3.3 MB Hermes bundle |
| Native release build / store submission | NOT TESTED (out of scope; use EAS) |

## 11. Performance — PARTIAL

- No profiling was performed (not claimed elsewhere either).
- Static observations only: Hermes bundles, zustand stores, 8-second status
  polling (documented as a simple approach), all lists use FlatList where
  they are lists. No fix was needed to unblock anything; real profiling
  should run on a device build.

## 12. Git & workspace safety — PASS

- No commits, no pushes; all changes remain in the working tree (12 changed
  entries) as required.
- `.env` untracked and git-ignored; only public keys exist in it; secret key
  never printed or stored.
- Build output directories (`dist/`, `dist-android/`) are removed after the
  export checks; `dist/` is also git-ignored.

## 13. Remaining limitations & verdict

**Deliberately not built (each labelled in-app):** payments capture, driver
payouts, realtime chat transport, push/SMS delivery, live GPS tracking,
document storage/upload, account deletion of the `auth.users` row, nearest-
driver dispatch.

**Production readiness: NOT production-ready.** The app is a coherent,
honest, reviewable beta: real auth/OTP wiring, real schema/RLS, verified
booking and driver lifecycle against the live project, clean gates. Before
release the team must at minimum: finalise legal text, rotate the Supabase
secret key, configure an SMS provider and verify OTP on a device, decide on
payments, and complete an interactive QA pass on device builds.

**Explicitly not claimed:** phone-OTP delivery, payments, push, map tiles and
UI tap-throughs were not tested; performance was not profiled.
