# Implementation Checklist — RESQ Nepal

Status of every major requirement: what is implemented, where it lives, and
what is honestly blocked or out of scope. "Implemented" means the code exists
in this repository and passes `npx tsc --noEmit` and `npx expo lint`.

Legend: ✅ implemented · 🟡 implemented with documented limits · ⛔ requires a
backend or external service by design (not built — see `docs/known-limitations.md`)

---

## 1. Platform & Architecture

| Item | Status | Notes |
| --- | --- | --- |
| React Native + Expo + TypeScript single app | ✅ | Expo SDK 58, RN 0.88, TS 6.0.3 |
| User Mode + Driver Mode in one app | ✅ | `authStore.mode`; Account → "Switch to Driver Mode", DriverSettings → "Switch to User Mode" |
| Navigation | ✅ | React Navigation native-stack: `src/navigation/{Auth,User,Driver}Navigator.tsx` |
| State management | ✅ | Zustand stores: `authStore`, `bookingStore`, `walletStore` |
| No custom backend | ✅ | The only server contact is the Supabase client SDK from the app |
| Database schema, RLS, triggers, RPC | ✅ | `supabase/schema.sql` (12 tables, policies, `accept_booking()` RPC) |
| No privileged credentials in the app | ✅ | Only `EXPO_PUBLIC_SUPABASE_URL` + anon key; service-role key never referenced |

## 2. Design Reference Fidelity

| Item | Status | Notes |
| --- | --- | --- |
| All 11 reference screenshots inspected | ✅ | `docs/reference-audit.md` |
| ~79 reference panels mapped to screens | ✅ | `docs/screen-mapping.md`, `docs/screen-register.md` |
| Original references preserved | ✅ | `reference-assets/` untouched |
| Brand: RESQ red (#E53935) / white, emergency aesthetic | ✅ | `src/constants/theme.ts`, `docs/design-system.md` |
| Two booking categories only (Basic, ICU/Emergency) | ✅ | `AmbulanceCategory = 'basic' | 'icu'`; UI uses only these |
| Capabilities (oxygen, ventilator…) separate from categories | ✅ | `equipment: string[]` on ambulances |

## 3. Screens & Flows

| Item | Status | Notes |
| --- | --- | --- |
| Auth: splash → onboarding → phone → OTP → registration → permission | ✅ | `src/screens/auth/` (8 screens) |
| User screens | ✅ | 36 screens in `src/screens/user/` |
| Driver screens | ✅ | 8 screens in `src/screens/driver/` |
| Every route registered & reachable | ✅ | routes verified against navigators; no dead `navigation.navigate` targets |
| No dead buttons / `onPress: () => {}` | ✅ | removed; remaining alerts all perform or honestly explain |
| Booking flow: pickup → destination → category → patient → review → confirm | ✅ | Home → LocationSearch → AmbulanceList → AmbulanceDetails → BookingConfirmation |
| Confirm → real DB status | ✅ | `ProcessingScreen` creates the booking row; `BookingStatusScreen` polls status every 8 s |
| Assigned ambulance → driver info | 🟡 | Driver card shows real assignment state; driver *name/rating* only available when the operator exposes them — the app never fabricates them |
| Trip progress → cancellation → completion | ✅ | `TripTrackingScreen` (live), `CancelRideScreen` (writes `cancelled`), `ArrivalScreen` → `RatingScreen` |
| Completion → rating | ✅ | `RatingScreen` inserts into `ratings` (one per booking) |
| History | ✅ | `ActivityScreen` reads the signed-in user's bookings |
| Required screen states (loading/empty/error/permission/no-results/success/validation/network) | ✅ | each data screen implements loading, error+retry, and empty states; screens that fetch mark network failure distinctly |
| **Interactive QA (Maestro on iOS 26.4)** | 🟡 **19/52 screens** | Auth stack fully exercised (onboarding→OTP); Home, AmbulanceList, AmbulanceDetails, BookingConfirmation, BookingStatus, Activity, Account (sign-out), LocationSearch, Legal (Privacy/Terms) — see `docs/interactive-qa-checklist.md` |

## 4. Database Connectivity (Supabase)

| Item | Status | Notes |
| --- | --- | --- |
| Client SDK connection (no custom server) | ✅ | `src/services/database/client.ts` |
| Auth service | ✅ | `src/services/auth/authService.ts` |
| Services: profiles, drivers, ambulances, bookings, trips, ratings, notifications, savedPlaces | ✅ | `src/services/database/` |
| Atomic single-driver assignment | ✅ | `accept_booking()` RPC (compare-and-set), documented in `docs/database-setup.md` |
| Driver verification cannot be self-approved | ✅ | DB trigger + RLS; admin SQL flow documented |
| Booking created from the app | ✅ | `bookingsService.create()` from Processing |
| Status updates persisted | ✅ | driver accept/arrive/start/complete, user cancel, rating |
| Realtime subscriptions | 🟡 | status uses 8 s polling; realtime publication documented as an enhancement |

## 5. Maps & Location

| Item | Status | Notes |
| --- | --- | --- |
| Location permission handling | ✅ | `LocationPermissionScreen`, `expo-location` |
| Real map rendering | ⛔ | requires a Google Maps API key per platform; labelled config state shown instead — never fake tiles |
| Route/driver preview | 🟡 | schematic preview with a "requires API key" note; live positions come from `trip_locations` breadcrumbs when a driver streams them |

## 6. Payments & Wallet

| Item | Status | Notes |
| --- | --- | --- |
| Wallet balance + Top Up flow (amount → method → success → receipt) | ✅ | `walletStore` (client-side ledger), TopUp screens |
| Payment methods (wallet, cash, eSewa, Khalti, card) | 🟡 | selectable; money is not captured |
| Actual payment capture / payouts | ⛔ | needs a payment provider + server-side verification |

## 7. Communication

| Item | Status | Notes |
| --- | --- | --- |
| Chat UI | 🟡 | demo conversation is labelled as such; messages are never delivered |
| Voice/video call UI | 🟡 | `CallScreen` UI only; no telephony provider |
| Real messaging | ⛔ | requires a realtime provider |

## 8. Security & Access Control

| Item | Status | Notes |
| --- | --- | --- |
| Driver privileges cannot be gained from the frontend | ✅ | driver home/requests gate on a DB driver record; verification is DB-enforced |
| RLS on all tables | ✅ | `supabase/schema.sql` |
| Deactivate/delete account | 🟡 | in-app request recorded, admin processing documented (a client cannot delete auth users) |
| No privileged keys in the bundle | ✅ | only public `EXPO_PUBLIC_*` values are referenced |

## 9. Quality Gates

| Item | Status | Notes |
| --- | --- | --- |
| TypeScript | ✅ | `npx tsc --noEmit` → 0 errors |
| Lint | ✅ | `npx expo lint` → exit 0 |
| Bundles | ✅ | Metro iOS + Android bundles HTTP 200; `expo export --platform ios` succeeds |
| Documentation set (13 files) | ✅ | see README "Documentation" table |
| Honest boundaries documented | ✅ | `docs/known-limitations.md` |

## 10. Deliberately NOT Built (needs a real backend)

- Atomic dispatch with GPS-ranked nearest-vehicle offers (the `accept_booking`
  RPC makes assignment race-safe, but *choosing* the nearest driver needs a
  server job or PostGIS ordering).
- Automatic driver-arrival detection and ETA computation.
- Push notifications (local notification records exist; FCM/APNs delivery
  needs server credentials).
- SMS/OTP delivery for phone auth (needs a provider).
- Payment capture, refunds, driver payouts.
- Account deletion of the underlying `auth.users` row.
- Driver document upload/storage verification pipeline.

Each of these is stated in-app where a user could otherwise be misled, and in
`docs/known-limitations.md` with the specific reason.

## 11. Final Audit Remediation (2026-10-17)

Fixes applied during the final audit. All were verified by `tsc` (0 errors),
`expo lint` (0 problems), `expo-doctor` (20/20) and iOS + Android
`expo export`; database-level behaviour was validated in the live 28/28 E2E
run (see `docs/final-audit-report.md`); **interactive QA via Maestro on
iOS 26.4 (19/52 screens tapped)** — see `docs/interactive-qa-checklist.md`.

| Area | Fix | Status |
| --- | --- | --- |
| Session | Sessions persist via AsyncStorage and restore on launch; sign-out ends the real Supabase session from every path | ✅ |
| Auth | Phone OTP wired to real `signInWithOtp`/`verifyOtp`; validated phone inputs; social buttons honestly unavailable; Change Password now real | ✅ |
| Booking | `accept_booking` receives the driver's own ambulance id; double-insert and double-accept guards | ✅ |
| Honesty | Fabricated data removed everywhere on live paths; card form deleted (no card data ever collected); wallet/top-up/payment screens demo-labelled; trip tracking labelled as route preview; fake receipts/people/transactions/devices removed | ✅ |
| Settings | Notification + language preferences persist on-device; deactivation requests recorded in `support_requests`; theme/English-only limits stated | ✅ |
| Legal | Draft Privacy Policy + Terms of Service screens added and linked from Welcome and Help | ✅ |
| Routes | Help entries for unbuilt pages show honest notices; every navigate target registered | ✅ |
| Config | Splash migrated to `expo-splash-screen` plugin; `react-native-gesture-handler` pinned to SDK version | ✅ |
| **Interactive QA** | **Maestro flows for 19/52 screens (auth + core user flows in configured & sample modes); screenshots captured** | ✅ |

Known residual gap (provided, **not applied**):
`supabase/patches/accept_booking_ownership_guard.sql` — hardens the accept RPC
so a modified client cannot claim another driver's ambulance id.
