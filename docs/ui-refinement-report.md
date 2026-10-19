# RESQ Nepal — UI/UX Refinement & Feature Integration Report (2026-10-18)

This report covers the refinement round that audited the app against the five reference
screenshots in `iloveimg-compressed (1).zip`, rebuilt the booking experience around the existing
Supabase data layer, and added the requested family/caregiver, notification, SOS-contact and
sharing features. Everything below was actually implemented and verified in this workspace; the
reference ZIP and its contents were never modified.

**Round 2 (same day) — A–Z master-prompt delta.** A follow-up master prompt requested a full
feature audit plus specific additions (top-left menu drawer, real trip counters, Saved Places,
Saved Hospitals, Settings hub, About, driver onboarding, legal/privacy access, notification
preferences, future-API readiness). The audit found most account/legal/notification areas already
existed and verified; the genuinely missing pieces were built and verified the same way as round 1.
See **section 10** for the round-2 record — sections 1–9 below describe round 1 and remain accurate.

---

## 1. What was inspected before implementation

- **Project structure** — Expo SDK 58 / React Native app (`resq-nepal-mobile`), React Navigation
  (native stack) + Zustand stores, a single Supabase client in `src/services/database/`, service
  modules per entity, TypeScript types in `src/types/index.ts`.
- **Reference screenshots** — 5 images (10 panels) extracted read-only to a temp directory and
  reviewed at full resolution (map-first home, pickup/drop-off sheets, vehicle/service selection,
  payment, "finding your raider", driver on the way, rating, ride history, driver ongoing trip).
- **Database (read-only)** — `hospitals` (6 real rows: Norvic, Grande International, Nepal
  Mediciti, Patan Hospital, TUTH, Bir), `bookings`/`ambulances` empty at audit time, `notifications`
  and `saved_places` tables present with RLS, no `emergency_contacts` table, no `booking_for`
  flag, no caregiver columns.
- **Git status** — all work left uncommitted; nothing committed, pushed, or reset.

## 2. Screens and features improved

| Area | Change |
| --- | --- |
| Home | Map-first layout with real Apple Map (via bundled `react-native-maps`), brand card, demo banner, pickup/destination card with edit, straight-line distance meta, Find Ambulance CTA, SOS row, shared bottom tabs |
| Location search | Real hospital search from the `hospitals` table + saved places + recent destinations + "use my current location" + typed-address row; loading/error/no-results states |
| Ambulance selection | Map + sheet with the two categories first (Basic Patient Delivery, ICU / Emergency Ambulance), then real vehicle rows; no invented ETAs, availability or crew |
| Service details | Category description, equipment list, honest "assigned from the verified fleet after confirmation" copy, Continue to Booking |
| Booking confirmation | Cash-only payment card, rate-card fare estimate or "fare confirmed after the trip", **For myself / For someone else** selector with caregiver fields, duplicate-submit guard, patient-name validation |
| Processing | Demo walkthrough (clearly labelled) or real booking creation; only real distances produce fare estimates |
| Booking status | Matching timeline (request submitted → assigned → on the way → arrived → started → completed) with demo-labelled auto-advance and honest "nothing was sent to a dispatch server" |
| Active trip | Map, status timeline, fare (final or pending), **Share trip summary** (native share sheet), **Book again** (prefills route), cancel only when allowed |
| Receipt | Completed trips open a real receipt built from the stored record (booking ref, requested time, route, service, status, payment: cash, recorded final fare or an honest "confirmed by the crew" state) with a native share summary; no document file is claimed |
| Trip history | Real bookings for the signed-in user; labelled sample trips in demo; pickup + destination cards, cash tag, open-details, empty/loading/error states |
| Rating | Star rating with accessible labels, positive/issue chips, optional comment, skip, thank-you state; demo ratings stay on-device |
| Notifications | In-app inbox (real `notifications` table in real mode, labelled samples in demo) with read/unread, empty/error/retry states; taps open the related trip |
| SOS | Dedicated screen: three deliberate taps (5 s window, progress dots, auto-reset), GPS capture, device-local queue, trusted contacts, per-contact SMS composer, honest "cannot confirm delivery" copy |
| Account | Tidy menu (profile, driver-mode switch, notifications, payment methods with honest "not part of this build" alert, security, appearance, help, SOS); wallet card is informational only |

## 3. Files and components changed (major)

- **New** — `src/components/map/MapCanvas.tsx`, `src/components/ui/BottomTabBar.tsx`,
  `src/components/booking/{RouteSummary,ServiceCategoryCard,TripTimeline}.tsx`,
  `src/constants/{serviceCategories,bookingTimeline,fares,sos}.ts`, `src/utils/{geo,demoMode}.ts`,
  `src/services/database/hospitals.ts`, `src/services/sos/sosService.ts`,
  `src/services/contacts/emergencyContactsService.ts`, `src/screens/user/SOSScreen.tsx`.
- **Rebuilt / heavily edited** — `HomeScreen`, `LocationSearchScreen`, `AmbulanceListScreen`,
  `AmbulanceDetailsScreen`, `BookingConfirmationScreen`, `BookingStatusScreen`,
  `ProcessingScreen`, `TripTrackingScreen`, `ArrivalScreen`, `ActivityScreen`, `RatingScreen`,
  `AccountScreen`, `NotificationsScreen`, `ShareReceiptScreen`, `UserNavigator`.
- **Small fixes** — `StarRating` (per-star accessibility labels), `locationService`
  (last-known-position fast path + balanced accuracy), `bookingStore` (typed `RoutePoint`,
  setter use), `fares` (no invented default distance), `storage` (emergency contacts key),
  `.env.example` (SOS number documented).
- **Removed** — temporary `console.warn` map diagnostics, unreferenced `DemoMapView.tsx`
  (superseded by `MapCanvas`'s built-in schematic fallback).

## 4. Database operations genuinely connected

- **Hospitals** — read from `public.hospitals` (`hospitalsService.search`) for search and
  destination selection (real rows only).
- **Bookings** — real creation path unchanged except it now also persists `notes` (used for
  caregiver name/phone and pickup instructions when booking for someone else) and the existing
  patient fields; history reads via `bookingsService.getByUser`.
- **Ambulances / drivers / profiles** — read-only lookups where already present; nothing
  fabricated when rows are missing.
- **Notifications** — `notificationsService.getByUser` + `markRead` for the inbox; RLS unchanged.
- **Ratings** — `ratingsService.create` only for real completed bookings.
- **No DB writes were made during this verification round** (demo mode is fully local). No schema
  changes, migrations or resets were applied.

## 5. Demo-only behaviour (clearly labelled in the UI)

- OTP `1234`, personal-info, location-permission skip, and the entire booking walkthrough are
  demo-mode only; the demo user id is not a UUID so DB paths are guarded.
- Booking status auto-advance every 10 s during the demo walkthrough; the screen states that
  nothing was sent to a dispatch server and no real ambulance is attached.
- Sample ambulances show "Sample vehicle — availability not confirmed"; sample trips/ratings/
  notifications are labelled sample/demo.
- Real mode never falls back to fake success: booking creation, history, notifications and
  ratings all surface real errors with retry.

## 6. Future backend capabilities needed (documented, not faked)

1. **Dispatch/matching engine** — accept/reject, nearest-eligible-ambulance selection, assignment
   events and status history (`booking_status_history` table exists for real status events).
2. **Live ambulance positions + availability freshness** (`trip_locations` exists; needs
   driver-side periodic updates and an availability endpoint).
3. **Push notification delivery** — the `notifications` table stores rows; delivery requires a
   push provider + server trigger. In-app inbox works today.
4. **Hospital/clinic directory extensions** — clinics, verified phone/hours, services, and any
   future "accepting patients" signal (must stay unclaimed until verified).
5. **SMS/emergency-service integration** — the SOS screen opens the native SMS composer; a real
   monitored service needs an explicit provider and number, never invented by the app.
6. **Secure trip sharing** — live tracking links require server-side tokens and access rules;
   only the native share sheet summary exists today.
7. **Online payments** — deliberately absent; the wallet/top-up flow is inactive (cash only).
8. **`supabase/patches/accept_booking_ownership_guard.sql`** — locally validated patch that
   restricts booking acceptance to the assigned driver; still needs manual deployment in the
   Supabase SQL editor (not applied here).

## 7. Tests executed and actual results

All commands run from `resq-nepal-mobile/`; verification on iPhone 17 Pro simulator (iOS 26.4,
Expo Go) against the demo dev server on port 8081.

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean (exit 0) |
| `npx expo lint` | clean (0 problems) |
| `npx expo export --platform ios` | Exported `dist` — iOS Hermes bundle built (3.5 MB) |
| `maestro test --udid <sim> qa/maestro/maestro-verify-booking.yaml` | **Passed end-to-end** (run `2026-10-18_213439`): sign-up + profile, Home map, pickup via search (Bir Hospital), destination (Norvic), ambulance sheet, ICU category details, confirmation including patient details and the for-someone-else toggle (caregiver fields revealed, then switched back), booking created in demo (no DB writes), status timeline pending → assigned, demo alert dismissed, back Home. Screenshots `ui-01…ui-08` incl. `ui-06b/ui-06c`. |
| `maestro test --udid <sim> qa/maestro/maestro-verify-history-rating-sos.yaml` | **Passed end-to-end** (run `2026-10-18_213651`): ambulance sheet live + settled (layout fix), trip history, completed trip, trip receipt (recorded fare NPR 820, cash), rating with tags/comment/thank-you, notifications inbox, account, trusted-contact add (saved on device), two taps do not arm, auto-reset after 5 s, three deliberate taps arm and queue the alert on device, queued section offers "Message Aama" (SMS composer, nothing auto-sent), start over resets. Screenshots `ui-04b…ui-22`. |

Notes: the automated journeys run in demo mode (`EXPO_PUBLIC_DEMO_MODE=true`, OTP `1234`) because
the hosted project's phone OTP provider is disabled; the real code path calls `verifyOtp()` and
never accepts `1234`. Neither run created or modified any database row. Helper flows launched in
turn: `maestro-signin-demo.yaml` (used inside Flow B to reach the signed-in state).

## 8. Screens visually inspected

Screenshots captured during the Maestro runs are stored in `docs/ui-refinement-evidence/`
(Home, location search, ambulance sheet, service details, confirmation incl. patient details and
someone-else fields, booking status pending/assigned, trip history, completed trip, trip receipt,
rating, notifications inbox, account, SOS idle/contact-saved/two-taps/auto-reset/armed/SMS
options/after-reset) and were reviewed for alignment, clipping, hierarchy and honesty. The
`MapCanvas` real map renders in Expo Go with a pickup pin and straight-line preview and an honest
caption; the schematic fallback only appears when the native module is unavailable.

## 9. Known issues and remaining work

- Simulator GPS auto-fill for the pickup can be flaky; the location service now prefers a
  last-known fix and the verification flows set a fallback pickup when needed. On devices the
  permission prompt path is unchanged.
- The Booking Status timeline maps the six statuses the database actually supports; "patient on
  board" and "reached destination" are not separate DB states yet (trip completion covers the
  end of the journey), so no fake intermediate stages are shown.
- The `AmbulanceList` bottom sheet originally used an absolute overlay wrapper with a percentage
  `maxHeight` on the ScrollView; Yoga resolved the percentage twice (72% × 72%), so the sheet
  stopped short of the screen bottom (raw map visible beneath it) and then clipped its own
  content. It is now a normal flex-column sibling of the map with a definite 64% height cap on
  the wrapper and the ScrollView filling it — verified in `ui-04c` and by the hierarchy frames.
- Buttons at the very end of a long scroll (trip receipt / rate buttons, Emergency SOS row) can
  rest close to the home-indicator zone; the verification flows scroll with `centerElement: true`
  before tapping and the Account/Activity scroll content gained bottom clearance.
- No document-file receipts: the trip receipt renders the stored record and shares a text summary
  through the device sheet; no PDF/image document is generated until a real document service
  exists.
- Live OTP (hosted SMS) remains disabled in the Supabase project, so real sign-in could not be
  exercised end-to-end; demo mode is used for the automated journeys and the real code path is
  unchanged.

---

## 10. Round 2 — A–Z master-prompt delta (later the same day)

### 10.1 Audit outcome

**Already existed and re-verified (left unchanged):** Personal Info (avatar, DOB, real
`profiles.update`), Security (change password, signed-in devices, account-deletion request),
Help & FAQ, Legal / Privacy / Terms (draft-labelled), Language + Appearance (honest "not live"
states), Notifications inbox + preferences, Payment Methods (honest "not in this build" alert),
informational wallet card, driver-mode switch, logout, SOS with trusted contacts.

**Genuinely missing — built and verified in this round:**

1. Top-left menu drawer with profile header and grouped destinations.
2. Real trip counters (total / completed / cancelled / active) — one counting rule shared by the
   drawer and the Account screen; no double counting; sample data clearly labelled in demo.
3. Saved Places screen on the **real `saved_places` table** (no duplicate local store).
4. Saved Hospitals screen (live public-directory search + device-local starred snapshot).
5. Settings hub with only genuinely implemented options (no dead toggles).
6. About screen with an explicit "what this build does not do yet" list.
7. Driver onboarding form + local draft + typed contracts — submission intentionally absent so no
   application is ever falsely submitted or approved.

### 10.2 New features and how they stay honest

| Feature | Implementation |
| --- | --- |
| Menu drawer | Custom transparent-modal screen (React Navigation native stack, no new deps); profile row opens Personal Info; counters card; 12 destinations; Log Out with confirm; Android back closes the modal; menu rows `replace()` the drawer while mounted — no post-unmount navigation |
| Trip counters | `countTrips()` classifies every stored booking row: total = all rows, completed = `completed`, cancelled = `cancelled`+`rejected`, active = remaining; demo shows the sample trips with a visible "Sample walkthrough data" note; real mode reads `bookingsService.getByUser` for the signed-in UUID; loading/error/retry states |
| Saved Places | Name + type (home/work/other) + GPS-captured location (device reverse geocode); create/update/remove against `saved_places`; "Set pickup / Set destination" writes the booking store and returns Home; **demo mode never writes** — it explains with an alert; addresses are captured, so no placeholder coordinates |
| Saved Hospitals | Debounced search of the public `hospitals` directory (real rows only, stale-response guard, error/retry) + a device-local starred snapshot (max 20) with a "details can change" note; Set destination navigates Home |
| Settings hub | Notifications, Appearance, Language (honest translations note), Location permission → device settings, Account & Security, Privacy Policy, Terms of Service, About + version; footnote states sound/haptics are not implemented |
| About | Brand block + version (`src/constants/appInfo.ts`, kept in sync with app.json), what the app does, what it deliberately does not do yet, emergency notice with **no invented phone numbers**, legal links |
| Driver onboarding | Validated form (name, phone, licence number/expiry, plate, category, equipment checklist from the existing `SERVICE_CATEGORIES` capabilities, optional affiliation); draft saved on device only; status card states "nothing has been submitted"; Submit explains the review service is not connected |
| Future API | `src/services/api/contracts.ts` (typed DTOs) + `docs/future-api-contracts.md` (25 endpoint sketches, token-derived user id, role rules, error envelope, missing-table gaps) |

Shared behaviour across the new screens: 48 dp touch targets, accessibility roles/labels, safe
areas, keyboard handling (`keyboardShouldPersistTaps="handled"`), loading/empty/error/retry
states, and no fabricated content when a source is empty.

### 10.3 Files added / changed

**New:** `src/screens/user/{MenuDrawerScreen,SavedPlacesScreen,SavedHospitalsScreen,SettingsScreen,AboutScreen,DriverOnboardingScreen}.tsx`,
`src/services/stats/tripCounts.ts`, `src/hooks/useTripCounts.ts`,
`src/services/hospitals/savedHospitalsService.ts`, `src/services/driver/driverOnboardingService.ts`,
`src/services/api/contracts.ts`, `src/constants/{appInfo,demoSamples}.ts`,
`docs/future-api-contracts.md`, `qa/maestro/maestro-verify-menu-account.yaml`.

**Changed:** `src/navigation/UserNavigator.tsx` (6 new routes; drawer as `transparentModal`),
`src/screens/user/HomeScreen.tsx` (☰ button), `src/screens/user/AccountScreen.tsx` (counters card),
`src/screens/user/ActivityScreen.tsx` (shared sample source), `src/components/ui/Header.tsx`
(back-button label + hitSlop), `src/constants/storage.ts` (saved-hospitals + draft keys),
`qa/maestro/maestro-verify-history-rating-sos.yaml` (notifications back selector),
`docs/ui-refinement-checklist.md`, this report.

### 10.4 Database operations genuinely connected

- `saved_places` — the new screen calls the existing service (`getByUser` / `create` / `update` /
  `remove`) whenever a real UUID session is active.
- `hospitals` — Saved Hospitals searches the public directory (verification rendered a real row:
  Patan Hospital, Lagankhel, +977-1-5522266).
- `bookings` — counters read via `bookingsService.getByUser` in real mode.
- **No database rows were written during verification** (the journey ran as the demo session); no
  schema changes, migrations or resets.

### 10.5 Demo-only behaviour (updated)

- Everything from round 1 still applies. New surfaces follow the same rule: the demo session never
  reads or writes user tables. Saving a place in demo captures a real GPS location and then stops
  with an explicit "Nothing is saved in demo mode" alert.
- Driver onboarding is always draft-only in this build (no server), independent of demo mode.
- Device-local data that legitimately exists on the phone (saved hospitals, trusted contacts,
  SOS queue, driver draft) works and persists in demo mode, and screens say "on this phone".

### 10.6 Tests executed this round

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | **PASS** — 0 errors, re-run after the final code edits |
| Lint | `npx expo lint` | **PASS** — 0 problems |
| iOS bundle | `npx expo export --platform ios` | **PASS** — Hermes bundle 3.6 MB, exit 0 |
| Flow C — new surfaces | `maestro test qa/maestro/maestro-verify-menu-account.yaml` | **PASS** — drawer, counters, saved hospitals (real directory row + star), saved places (demo notice, validation, demo guard), settings, about, privacy, driver draft + honest submit alert; screenshots `ui-23…ui-33` in `docs/ui-refinement-evidence/` |
| Flow A re-run — booking regression | `maestro test qa/maestro/maestro-verify-booking.yaml` | **PASS** — exit 0; all booking screenshots re-captured (run `2026-10-18_222952`) |
| Flow B re-run — history/rating/SOS regression | `maestro test qa/maestro/maestro-verify-history-rating-sos.yaml` | **PASS** — exit 0, 112 steps, notifications back via the new "Go back" label (run `2026-10-18_223201`) |
| Visual review | all new screenshots inspected at full size | **PASS** — no clipped text, honest labels visible, ☰ button integrated in the Home header |

### 10.7 Known issues / blockers (round 2)

- Hosted phone OTP still disabled → real sign-in not exercisable; demo mode used for journeys.
- `supabase/patches/accept_booking_ownership_guard.sql` still not deployed (manual step).
- No `saved_hospitals` table → the starred list is device-local by design (contract documented).
- No partner-onboarding service → driver submission intentionally not implemented; the status card
  never claims submission.
- The drawer inset differs from regular screens in the transparent modal; the panel reads the
  provider insets and falls back to launch-time window metrics (verified visually).

---

## 11. Round 3 (2026-10-19) — Map-first home-to-ambulance booking flow

### 11.1 What changed

- **Home is now fully map-first.** The oversized bottom SOS block and the visible bottom
  Home / Ambulance / Activity / Profile tab bar were removed. Home opens directly with the map,
  a compact top-left ☰ menu, a compact top-right **SOS** button (the existing three-tap arming
  safeguards are unchanged), the pickup row (GPS-prefilled with manual correction), the
  destination prompt, **two side-by-side category cards — Patient Delivery (left) and
  ICU / Emergency (right)** — and a **Find Ambulance** CTA. Database enum values (`basic` /
  `icu`) are untouched; only the display labels changed.
- **Every former tab destination stays reachable** through the existing drawer, which gained
  "Ambulance" and "My Account" rows; Activity and Account got their own header back buttons.
- **Searching / assigned stages keep the map visible.** `BookingStatusScreen` now shows a compact
  map card with the real pickup and destination markers (captioned "straight-line preview, not
  live GPS") above the scrollable status panel — the pending state reads "Finding an
  ambulance…", the assigned state "Ambulance assigned", exactly as the real booking model
  defines.
- **Fare offers are previewed, not faked.** Demo walkthroughs show a clearly-labelled
  **PREVIEW** card ("Offering your fare", disabled stepper, real rate-card starting price,
  "Nothing is sent or saved"). Production fare offers need schema support — see
  `known-limitations.md` §11.
- **Live ambulance GPS is not connected** and is not pretended: the `trip_locations` plumbing
  (table, RLS, service) exists but has no producers/consumers yet — see
  `known-limitations.md` §12.
- **Navigation duplicate-stack fix (React Navigation v7):** the "return to trips" paths
  (rating done, tip, arrival, cancel, notifications) now `popTo` the existing destination
  instead of pushing duplicates — a latent bug exposed once the tab bar was removed.
- **Reference:** the newly supplied inDrive screenshots were analysed and mapped — see
  `docs/booking-flow-reference-analysis.md`. Only interaction patterns were adopted; RESQ's
  red-and-white design system, components and map are preserved.

### 11.2 Files added / changed

**New:** `src/utils/categoryOption.ts`, `qa/maestro/maestro-evidence-home-categories.yaml`,
`docs/booking-flow-reference-analysis.md`, `docs/reference-2026-10-19/` (the 5 reference JPEGs,
preserved).

**Changed:** `src/screens/user/{HomeScreen,BookingStatusScreen,AmbulanceListScreen,ActivityScreen,AccountScreen,MenuDrawerScreen,RatingScreen,TipScreen,ArrivalScreen,CancelRideScreen,NotificationsScreen}.tsx`,
`qa/maestro/{maestro-verify-booking,maestro-verify-history-rating-sos,maestro-verify-menu-account}.yaml`,
`docs/known-limitations.md` (§11 fare offers, §12 live GPS), this report.

### 11.3 Database and services reused

No schema changes, migrations, new dependencies or backend changes of any kind.
Reused as-is: `bookingsService` (`create` / `getById` / `updateStatus`), the hospital directory,
the fare rate card (`estimated_fare` only when a real distance exists), device-local SOS
contacts, and the existing demo-mode guards. Demo mode never writes user tables.

### 11.4 Tests executed (final source)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | **PASS** — 0 errors |
| Lint | `npx expo lint` | **PASS** — 0 problems |
| iOS bundle | `npx expo export --platform ios` | **PASS** — exit 0 |
| Flow A — booking regression | `maestro test qa/maestro/maestro-verify-booking.yaml` | **PASS** — 76 steps incl. the new assertions (map caption, "Offering your fare" preview label, "Nothing is sent or saved") → `ui-01…ui-08` refreshed |
| Flow B — history / rating / SOS | `maestro test qa/maestro/maestro-verify-history-rating-sos.yaml` | **PASS** — 124 steps (run `2026-10-19_010917`); the SOS add-contact tap now targets the left side of the row (Expo Go's floating dev bubble can overlap its right side) → `ui-04b…ui-22` refreshed |
| Flow C — drawer / account / settings | `maestro test qa/maestro/maestro-verify-menu-account.yaml` | **PASS** — 131 steps (run `2026-10-19_014827`) → `ui-23…ui-33` refreshed |
| Category-selection evidence | `maestro test qa/maestro/maestro-evidence-home-categories.yaml` | **PASS** → `ui-04d` (ICU selected) / `ui-04e` (Patient Delivery selected) |
| Visual review | all key screenshots inspected at full size | **PASS** — no clipped CTA, both cards fit side by side, drawer rows correct, honest labels visible |

Runbook note: the simulator's injected GPS position can be dropped between sessions; re-run
`xcrun simctl location <udid> set 27.7172,85.3240` (and the location privacy grant) before
the flows, otherwise the honest "Could not read the device location" state appears.

### 11.5 Known issues / blockers (round 3)

- Fare offers and live driver GPS are backend gaps — documented in `known-limitations.md`
  §11 / §12; nothing is faked.
- Hosted phone OTP and the `accept_booking_ownership_guard.sql` patch status are unchanged
  from round 2.
- Small-screen layout: the Home sheet was tuned so the CTA stays visible with the distance
  meta line (verified on the iPhone 17 Pro simulator); a physical small-device pass is still
  recommended.

## 12. Round 4 — premium polish pass (2026-10-19, later session)

### 12.1 Home screen — what changed

- **Top-centre branding card removed.** The floating "RESQ Nepal / Ambulance booking"
  chip between the menu button and SOS is gone; the header is now just ☰ (left) and the
  compact SOS control (right). No replacement title or decoration was added — the brand
  still appears in the drawer, Account/About and the sign-in screens.
- **Demo banner removed** from Home (see 12.2 for the app-wide demo-UI policy).
- **Subheading removed** ("Confirm the pickup and the hospital or destination, then choose
  a service.") — the pickup/destination card and the CTA already say what to do. Heading
  dropped from `h2` (24) to `h3` (20).
- **Category cards compacted**: one row (small tinted icon + label) plus a single short
  line ("Routine visits & transfers." / "Critical & emergency transport."). The always-on
  "Basic / ICU" badge chips were removed; the selected card now shows a white ✓ inside a
  red icon circle (same footprint — no layout shift). Full descriptive sentences remain on
  the cards' accessibility labels.
- **Fare/pickup card tightened**: RouteSummary paddings reduced (12→10 / 8→6); shared
  component so the list/confirm/status screens inherit the same compact rhythm.
- **CTA**: same "Find Ambulance" primary button, one size down (`lg`→`md`) — still full
  width, ~48 pt tall.
- Category taps animate via `LayoutAnimation.Presets.easeInEaseOut` (no new dependency;
  graceful no-op where unavailable).

### 12.2 Demo-UI policy (visible vs functional)

| Element | Before | After |
| --- | --- | --- |
| Home banner "🔧 DEMO MODE — simulated data…" | red banner | removed (Home has no demo chrome) |
| Welcome screen "🔧 DEMO MODE" chip | chip | removed |
| OTP screen "🔧 DEMO MODE" chip | chip | removed (subtitle still names the demo OTP) |
| BookingStatus demo/sample notice | amber card | small grey footnote, same truthful wording |
| Activity / AmbulanceList sample banners | amber banners | small grey footnotes |
| Notifications / Rating / Arrival demo notes | amber text | small grey footnotes (wording kept, no emoji) |
| Saved Places / drawer / Account notes | honest notes | kept as-is (asserted by flows; already compact) |
| Demo capability (OTP 1234, sample data, write guards) | — | **unchanged** — nothing was deleted |

### 12.3 Interaction polish

- `LayoutAnimation` cross-fade on category selection (Home).
- RouteSummary edit rows keep 0.7-opacity press feedback; category cards 0.85; CTA 0.7.
- No new dependencies; no changes to navigation, booking logic, fares, SOS, or the database.

### 12.4 Files changed in this round

`src/screens/user/HomeScreen.tsx`, `src/screens/user/BookingStatusScreen.tsx`,
`src/screens/user/ActivityScreen.tsx`, `src/screens/user/AmbulanceListScreen.tsx`,
`src/screens/user/NotificationsScreen.tsx`, `src/screens/user/RatingScreen.tsx`,
`src/screens/user/ArrivalScreen.tsx`, `src/screens/auth/WelcomeScreen.tsx`,
`src/screens/auth/OTPScreen.tsx`, `src/components/booking/RouteSummary.tsx`,
`src/utils/demoMode.ts` (comment), `qa/maestro/maestro-verify-history-rating-sos.yaml`
(idempotent SOS contact step — see 12.5), `docs/demo-run-guide.md`, this report.

### 12.5 Tests executed (round 4, final source)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | **PASS** — 0 errors |
| Lint | `npx expo lint` | **PASS** — 0 problems |
| iOS bundle | `npx expo export --platform ios` | **PASS** — exit 0 |
| Flow A — booking | `maestro test qa/maestro/maestro-verify-booking.yaml` | **PASS** (run `2026-10-19_114331`) |
| Flow B — history / rating / SOS | `maestro test qa/maestro/maestro-verify-history-rating-sos.yaml` | **PASS** (run `2026-10-19_120254`) |
| Flow C — drawer / account / settings | `maestro test qa/maestro/maestro-verify-menu-account.yaml` | **PASS** (run `2026-10-19_120616`) |
| Category-selection evidence | `maestro test qa/maestro/maestro-evidence-home-categories.yaml` | **PASS** (run `2026-10-19_121023`) → `ui-04d` / `ui-04e` |
| Visual review | key screenshots inspected (Home, status pending, SOS, drawer) | **PASS** — no branding card, no demo banner, cards balanced, CTA fine |

Notes:
- **Flow B idempotency fix (test hygiene, not a weakened assertion):** the device-local SOS
  contact list caps at five and repeated runs had filled it, hiding the "+ Add" control. The
  flow now frees one duplicate "Aama" row first *only when* "Add trusted contact" is not
  visible, then performs the real add exactly as before.
- **Simulator housekeeping:** Expo Go's floating dev bubble can overlap fixed controls
  (it sat on the Home ☰ and on the SOS "+ Add"). It was dragged to the right-middle edge
  (~90 %, 42 %) — flows pass with it there. If a future run mis-taps, drag the bubble away
  before blaming the app.
- **Evidence:** all 42 screenshots in `docs/ui-refinement-evidence/` refreshed from the runs
  above; the stale `ui-04-home-categories.png` (pre-refinement Home) was removed — the same
  state is covered by `ui-01`, `ui-03`, `ui-04d`, `ui-04e`.

### 12.6 Remaining items after round 4

- The Driver-mode demo banner ("🔧 DEMO MODE — All data is simulated") is out of scope for
  this patient-UI pass and will be revisited with the driver-mode work.
- Small-screen pass on a physical device is still recommended (simulator-verified only).

## 13. Round 5 — assigned-driver card & native Call Driver (2026-10-19, later session)

### 13.1 What the patient sees now

The old "assigned crew" placeholder (vehicle-model string, fake Call/Message buttons that only
raised an alert) is replaced by a real data path plus an honest demo preview:

- **Card position**: directly under the state hero — the crew is the key information once
  assigned — above the map context and timeline.
- **Real bookings** (`bookings.driver_id` recorded by `accept_booking`):
  - driver display name, avatar (when the backend shares one), category line and the
    ambulance **registration number**;
  - a `VERIFIED` badge only when the database actually confirms it;
  - a single full-width **Call Driver** button that opens the **native dialer** with
    `tel:` (`Linking.openURL`) — no in-app calling, no VoIP, no extra permissions, and the
    number is never rendered as text;
  - while the current policies do not yet expose the crew rows, the card shows the neutral
    fallback ("Assigned ambulance crew", initials avatar, no plate line) and Call Driver
    answers **"Driver contact is currently unavailable"** — nothing is invented.
- **Demo/sample walkthroughs**: the same card with a clearly fictional crew
  ("Bikash Tamang", plate `BA 2 KHA 4321`), a `SAMPLE` badge and the caption
  "Sample crew and plate — demo walkthrough only. No real crew is attached." Call Driver in a
  demo run explains that no call is placed — the dialer is never invoked with sample data.
- The bottom bar keeps `View active trip` (honest straight-line trip view, no live-GPS
  claims). *(Round 7 later moved this into the crew card as the reference-aligned
  `Track Ambulance` button — same `handleTrackLive` path.)*

### 13.2 Data path & privacy

- `src/services/database/assignedCrew.ts` resolves the crew for the patient's own booking:
  first the reviewed `get_assigned_crew` RPC, then a conservative fallback that only uses rows
  the patient's own policies allow (`bookings`), reporting `source: 'restricted'` when the crew
  rows are not readable. No widened policy, no service-role key, no guessed data.
- `supabase/patches/assigned_crew_visibility.sql` (NEW, **reviewed but NOT deployed**) defines
  the required backend function: owner-only, assigned-status-only, phone returned only while
  the trip is operationally active (`assigned`/`arriving`/`arrived`/`started`), `STABLE` +
  `SECURITY DEFINER` with pinned `search_path`, execute granted to `authenticated` only.
  The UI's Call Driver window matches this exactly.
- `supabase/patches/verify_assigned_crew_visibility.sql` (NEW) is the full behavioural check
  (7 checks + sub-assert): all passed on a **local PostgreSQL 15.8** instance with the exact
  schema (stubbed `auth`), executed end-to-end and rolled back. Documented in
  `docs/known-limitations.md` §13.
- `src/utils/dialer.ts` (NEW) keeps the dialer logic pure and testable:
  `toDialableNumber` / `buildTelUrl` / `openNativeDialer(raw, openUrl)` — the URL opener is
  injected, so the app passes `Linking.openURL` while tests pass a mock.

### 13.3 Tests executed (round 5, final source)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | **PASS** — 0 errors |
| Lint | `npx expo lint` | **PASS** — 0 problems |
| Dialer unit tests | `npm run test:unit` (`node --test`, mocked URL opener) | **PASS** — 6/6 |
| iOS bundle | `npx expo export --platform ios` | **PASS** — exit 0 |
| Flow A — booking (incl. crew card + demo call guard) | `maestro test qa/maestro/maestro-verify-booking.yaml` | **PASS** (run `2026-10-19_123421`) |
| Flow B — history / rating / SOS | `maestro test qa/maestro/maestro-verify-history-rating-sos.yaml` | **PASS** (run `2026-10-19_123656`) |
| Flow C — drawer / account / settings | `maestro test qa/maestro/maestro-verify-menu-account.yaml` | **PASS** (run `2026-10-19_124016`) |

Flow A now also asserts: the sample-labelled crew card, that no `+977` number appears anywhere
on the screen, that Call Driver in a demo shows the no-call explanation, and captures
`ui-08b-assigned-crew.png` (inspected: card reads exactly as above). Evidence folder refreshed
(43 files).

### 13.4 Manual device note

The native dialer hand-off itself cannot be exercised without an assigned real booking (the
patched function is not deployed, so no phone number is available to the app). Manual check on
a device: run the demo walkthrough and confirm the no-call explanation; after the patch is
deployed and a real booking is assigned, tapping Call Driver should open the system dialer
pre-filled with the crew's number — the app never dials by itself.

## 14. Round 6 — Driver Mode & interactive driver walkthrough (2026-10-19, later session)

### 14.1 What was built

**Driver Mode entry:** My Account → **Switch to Driver Mode**. The patient side stays the
default experience; driver screens live in their own stack reached from the existing account
mechanism (no new tabs, no clutter). With a real database connected and no driver record, the
driver home is a registration gate ("Become a RESQ Driver" — apply, reviewed before bookings);
the walkthrough runs only in demo/sample builds
(`walkthrough = isDemoMode() || !isSupabaseConfigured`).

**Driver dashboard (`DriverHomeScreen`)** — map-first:
- real device position via `locationService` with explicit loading / ready / unavailable
  states and the caption "Your position from this device's GPS" (blue dot only — no simulated
  movement, no location writes);
- Go Online / Offline toggle; walkthrough state is store-backed so it survives navigation
  remounts, real mode updates the ambulance record only when a real one exists;
- status card with the incoming count and View; summary cards read honestly in the
  walkthrough: `NPR 0` ("walkthrough — no real earnings"), walkthrough trip count, `—` rating
  ("available after real trips") — nothing invented;
- quiet `DEMO` chip in the header (replaces the old banner); "Driver walkthrough" card
  explains the sample data and offers **Restart walkthrough**;
- same design system as the patient side — no oversized panels, no dark-inDrive imitation.

**Incoming requests (`DriverRequestsScreen`):**
- both categories (ICU / Emergency, Basic Transport) with patient, pickup / destination,
  distance and time; count badge fixed during verification;
- **Accept** — real path uses the atomic `accept_booking` RPC plus ambulance lookup with a
  duplicate-tap guard; walkthrough moves the sample request into an in-memory trip;
- **Decline** — local only, never a fabricated backend record;
- honest empty state (with Refresh / Restart walkthrough) and a `Go back` affordance added
  when verification showed the screen had none.

**Trip journey (`DriverTripScreen`):**
- Heading to Pickup → Arrived at Pickup → Trip In Progress → Trip Completed, valid
  transitions only, duplicate-tap guards on Arrived / Start / Complete; real mode persists
  transitions through `bookingsService.updateStatus`;
- map preview with pickup / destination pins and a progress bar; caption explicitly reads
  "Straight-line preview — not live GPS" — no fake moving ambulance;
- Call Patient: real booking → native `tel:` via the shared dialer utility; walkthrough →
  honest no-call explanation; the number is never rendered as text or logged;
- walkthrough completion shows "Walkthrough trip completed. No records were written and no
  fare is charged." and returns to the dashboard.

**Walkthrough state (`src/store/driverDemoStore.ts`, NEW):** isolated in-memory zustand
store — two sample requests (fictional patients, one per category), active trip + phase,
completed-trip counter, online state, `restart()` (restores requests, keeps online).
Nothing is persisted; the walkthrough makes no Supabase calls.

**Earnings / Profile / Vehicle management:** real mode shows honest unavailable states (no
invented earnings, trips or documents); the walkthrough shows clearly-labelled sample data
("Walkthrough — sample … for this demo session").

### 14.2 Files changed (round 6)

| File | Change |
| --- | --- |
| `src/store/driverDemoStore.ts` | NEW — in-memory walkthrough store (requests, trip, online, restart) |
| `src/screens/driver/DriverHomeScreen.tsx` | Map-first dashboard, real GPS dot, DEMO chip, store-backed online, walkthrough card, honest summary |
| `src/screens/driver/DriverRequestsScreen.tsx` | Walkthrough request list, accept/decline guards, count badge fix, back affordance |
| `src/screens/driver/DriverTripScreen.tsx` | Store-driven phases, straight-line map + progress, duplicate-tap guards, completion alert |
| `src/screens/driver/DriverEarningsScreen.tsx` | Walkthrough condition + labelled samples; real mode honest empty |
| `src/screens/driver/DriverProfileScreen.tsx` | Same pattern |
| `src/screens/driver/VehicleManagementScreen.tsx` | Same pattern |
| `src/components/map/MapCanvas.tsx` | Optional `current` position marker (blue) — additive |
| `qa/maestro/maestro-verify-driver-demo.yaml` | NEW — Flow D, 84 steps |

### 14.3 Tests executed (round 6, final source)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | **PASS** — 0 errors |
| Lint | `npx expo lint` | **PASS** — 0 problems |
| Unit tests | `npm run test:unit` | **PASS** — 6/6 |
| iOS bundle | `npx expo export --platform ios` | **PASS** — exit 0 |
| Flow A — booking (regression) | `maestro test qa/maestro/maestro-verify-booking.yaml` | **PASS** — 81/81 (run `2026-10-19_140608`) |
| Flow B — history / rating / SOS (regression) | `maestro test qa/maestro/maestro-verify-history-rating-sos.yaml` | **PASS** — 124/124 (run `2026-10-19_135657`) |
| Flow C — drawer / account / settings (regression) | `maestro test qa/maestro/maestro-verify-menu-account.yaml` | **PASS** — 131/131 (run `2026-10-19_140101`) |
| Flow D — driver walkthrough end-to-end | `maestro test qa/maestro/maestro-verify-driver-demo.yaml` | **PASS** — 84/84 (run `2026-10-19_140927`) |

Flow D covers: sign-in → My Account → Switch to Driver Mode → DEMO chip → GPS caption →
Go Online → both sample requests (ICU + Basic) → decline one → accept the other →
pickup → arrived → started → completed (asserting the no-write completion copy) → restart →
both requests restored → Go back → Switch to User Mode → patient "Find Ambulance" back.
It also asserts the "not live GPS" caption and that no `+977` number appears on screen.

### 14.4 Evidence

- Six new driver screenshots added and inspected: `ui-34-driver-demo-home`,
  `ui-35-driver-demo-requests`, `ui-36-driver-demo-trip-pickup`,
  `ui-36b-driver-demo-trip-started`, `ui-37-driver-demo-completed`,
  `ui-38-driver-demo-restart` — each verified against the copy and honesty rules above
  (map-first dashboard, DEMO chip, sample labels, straight-line captions, completion alert).
- The full `docs/ui-refinement-evidence/` folder (49 files) was refreshed from the final
  green runs of flows A–D and spot-checked (Home, categories, driver set).

### 14.5 Manual device checks

Real path cannot be exercised end-to-end without a verified driver account and a real
patient request (standing platform items): with a real database connected, confirm the
"Become a RESQ Driver" gate appears for a non-driver account and that applying routes to the
reviewed stubs (no self-approval); after a real driver + ambulance exist, confirm Go Online
writes the ambulance status, Accept calls `accept_booking`, and phase transitions persist —
and that the app never shows earnings / ratings / plates that are not in the database.
The walkthrough itself is fully scripted (Flow D) and repeatable.

### 14.6 QA-runbook note (Expo Go overlay)

Expo Go's floating dev-menu button is an overlay, not app UI. During this round it ended up
over the OTP keypad's "4" and the SOS screen's "+ Add", silently opening the dev menu and
breaking taps. It was moved to the left edge (~10% / 25%) — clear of every tap point used by
flows A–D — and all four flows pass from there. Reposition it before a scripted run if a
swipe ever drags it.

## 15. Round 7 — 10-screen reference fidelity (2026-10-19, later session)

### 15.1 Scope

Reproduce the supplied 10-screen RESQ Nepal flow board (`RESQ Nepal Ambulance App Flow
(1).png`) across all ten app states, using the existing red/white brand and design system —
no new native dependencies, no schema changes, no invented data. The five inDrive
composition JPEGs informed layout only. The full per-screen breakdown (regions,
proportions, colors, typography, positions, interactions, missing information) lives in
**`docs/ui-reference-analysis.md` (NEW)**; this section records what was implemented and
verified.

### 15.2 What changed, per screen

- **Home (S1/S3)** — the "Get an ambulance" sheet heading is gone. The sheet now opens with a
  bordered two-row location card (soft green / soft red pin circles, bold "Your location" /
  "Where to?" labels, subtitle values, chevrons) followed by the centred distance line
  ("Approx: 1.5 km (straight line)") and the "Select Ambulance Type" section label once a
  destination exists. Category cards are now vertical with tinted icon circles (blue for
  patient delivery, red for ICU), coloured card borders, a clearly tinted/bordered selected
  state, and — with a destination set — real rate-card starting prices from
  `src/constants/fares.ts` (blue `Rs. 1,500`, red `Rs. 3,500`) under "Starting from". The CTA
  reads `Find Ambulance →`. A blue device-position dot is passed to the map only from a real
  GPS read, and the no-points Kathmandu viewport was tightened to street level.
- **Destination search (S2)** — visible header title removed (slim back row; the search field
  is the heading). New `Hospitals | Saved | Recent` tabs: the directory, device-local starred
  hospitals plus saved places, and addresses from real bookings. Rows use squircle icons,
  address subtitles, honest straight-line distances when both points have coordinates, and
  chevrons; phone numbers were dropped from rows. A `Choose from map` row opens the new
  **MapPickerScreen** — a real interactive map with a centre pin and device reverse geocode
  (falling back to explicit coordinate text when lookup fails; nothing invented).
- **Searching / assigned (S4/S5)** — the pending hero is a red cross in a soft red circle
  with bold red "Searching for driver…", a short explainer and the honest "This may take a
  few moments…" note (demo: "the sample timeline advances automatically"). The assigned hero
  is the filled green check "Booking confirmed / Your ambulance is on the way." The crew card
  is now the reference composition: section "Assigned crew" (+ `SAMPLE` badge in demo) →
  driver card (avatar, name, "Driver") → vehicle card (plate, "Ambulance vehicle",
  "Type: ICU/Basic" badge) → action row `Call Driver` + `Track Ambulance` → real-mode ⓘ
  footnotes ("phone number is not shown", "opens your phone's dialer"). `Track Ambulance`
  replaces the old bottom-bar `View active trip` and calls the same `handleTrackLive` path
  (demo → no-navigation walkthrough alert). A `Trip Details` From/To card (green/red pin
  circles) appears once a crew is attached or the booking is terminal; the pending state
  keeps the reference's shorter layout, so the flow-asserted straight-line map caption stays
  above the fold.
- **Booking in progress (S7)** — the shared `TripTimeline` now matches the reference stepper:
  completed steps are filled green circles with white checks and dark labels, the current step
  is red with a red bold label, pending steps stay muted. No per-step timestamps are invented
  (the schema stores none).
- **Live tracking (S6)** — a floating white back circle sits over the map; the sheet opens
  with the status banner (soft green, real status text, honest meta lines) instead of an
  overlay pill. The reference action pair became `Call Driver` (native `tel:` through the
  ownership-checked `assignedCrewService`; demo → no-call alert) plus the existing
  `Share trip summary`; the driver bar is display-only (real rating or "Rating not available
  yet") and the non-live in-app Chat/Call entry points were removed. Sheet scroll padding was
  added so every action scrolls fully into view.
- **Trip completed / rating (S8)** — green check circle, "Trip Completed", "Thank you for
  using RESQ Nepal!", a "Rate your driver" card (driver name only when really known), stars,
  feedback chips and comment as before. The payment summary card was removed (the stored fare
  stays on the receipt/tracking screens where the record lives), the ✕ was replaced by a
  "Skip" link, and the submit button now reads "Submit". The post-submit state is titled
  "Rating submitted".
- **Call driver (S9)** — unchanged native-dialer design from Round 5; the reference's ninth
  mockup is the OS dialer illustration (verified, skipped by design).
- **Menu drawer (S10)** — brand row (red cross mark + "RESQ Nepal") replaces the plain
  "Menu" title, the profile block now shows the account role "Patient" (the raw phone number
  was removed from the drawer), and logout is a plain red row under a divider. Every existing
  row, label and the real trip-counter card were kept — flows B/C anchor on them.

### 15.3 Intentional copy/selector updates in the QA flows

| Flow(s) | Old assertion | New assertion | Reason |
| --- | --- | --- | --- |
| A, B, C, D, sign-in helper, legacy d1/evidence flows | `Get an ambulance` | `Find Ambulance` | sheet heading removed; CTA carries the label |
| A | `View active trip` | `Track Ambulance` | reference action row (same handler) |
| B | `How was the trip` | `Trip Completed` | reference rating header |
| B | `Submit rating` | `Submit` | reference button label |
| B | `Thank you` (post-submit) | `Rating submitted` | the new subtitle contains "Thank you", so the post-submit marker was made unique |

Behaviour is unchanged in every case — only the asserted strings were re-pointed at the
renamed UI.

### 15.4 Honesty guardrails kept

- Prices are the real rate card (`startingPrice`); no mockup prices hardcoded.
- Distances remain explicitly "straight line"; no ETA, no search radius, no "Real-time"
  status claims — none are backed by the backend.
- `Choose from map` uses only device GPS + the OS reverse geocoder (no new tables, no new
  dependencies); failed lookups fall back to explicit coordinates.
- Calls only ever leave the app via `tel:`; phone numbers are never rendered anywhere (the
  drawer number was removed this round) and demo mode never invokes the dialer.
- The demo crew ("Bikash Tamang", `BA 2 KHA 4321`) stays `SAMPLE`-labelled with the
  "No real crew is attached" caption.

### 15.5 Files changed (round 7)

| File | Change |
| --- | --- |
| `src/screens/user/HomeScreen.tsx` | Sheet rebuild (location card, section label, accent cards + real prices), device dot, CTA label |
| `src/screens/user/LocationSearchScreen.tsx` | Slim header, source tabs, restyled rows with real distances, `Choose from map` row |
| `src/screens/user/MapPickerScreen.tsx` | NEW — interactive map picker with centre pin + reverse geocode |
| `src/screens/user/BookingStatusScreen.tsx` | Hero states, crew/vehicle/action composition, Trip Details card, `Track Ambulance` in-card |
| `src/screens/user/TripTrackingScreen.tsx` | Back circle, status banner, native `Call Driver`, driver bar cleanup, scroll padding |
| `src/screens/user/RatingScreen.tsx` | Reference layout (check, headers, rate card, Submit/Skip) |
| `src/screens/user/MenuDrawerScreen.tsx` | Brand row, role line, plain logout row |
| `src/components/booking/TripTimeline.tsx` | Reference stepper palette |
| `src/components/map/MapCanvas.tsx` | Optional `focus` + `onRegionChangeComplete`, `isNativeMapAvailable` export |
| `src/utils/geo.ts` | Street-level default viewport (viewport only — no fabricated points) |
| `src/types/index.ts` | `RoutePoint.source` gains `'map'` |
| `src/navigation/UserNavigator.tsx` | Registers `MapPicker` |
| `qa/maestro/*.yaml` | Renamed-selector updates (A–D + helper + legacy flows) |
| `docs/ui-reference-analysis.md` | NEW — per-screen reference analysis |

### 15.6 Tests executed (round 7, final source)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | **PASS** — 0 errors |
| Lint | `npx expo lint` | **PASS** — 0 problems |
| Unit tests | `npm run test:unit` | **PASS** — 6/6 |
| iOS bundle | `npx expo export --platform ios` | **PASS** — exit 0 (1234 modules) |
| Flow A — booking (incl. new Home/search/assigned states) | `maestro test qa/maestro/maestro-verify-booking.yaml` | **PASS** — 83/83 (run `2026-10-19_161826`) |
| Flow B — history / rating / tracking / SOS | `maestro test qa/maestro/maestro-verify-history-rating-sos.yaml` | **PASS** — 128/128 (run `2026-10-19_155417`) |
| Flow C — drawer / account / settings | `maestro test qa/maestro/maestro-verify-menu-account.yaml` | **PASS** — 131/131 (run `2026-10-19_160041`) |
| Flow D — driver walkthrough (regression) | `maestro test qa/maestro/maestro-verify-driver-demo.yaml` | **PASS** — 84/84 (run `2026-10-19_160426`) |

All four flows ran against the identical final source (no source edits afterwards), on the
iPhone 17 Pro simulator with GPS injected (`27.7172, 85.3240`). Two environment notes from
this round: the simulator location was re-injected after a failed location read in Flow C
(environment only — host flake, not app code), and the Expo Go dev-menu overlay sits over
screenshot decoration in some captures.

### 15.7 Evidence

`docs/ui-refinement-evidence/` (49 files) was refreshed from these final green runs and
spot-inspected against the reference crops: `ui-01` (home), `ui-02` (search with tabs),
`ui-03` (route state with real prices), `ui-07` (searching with honest notes above the
fold), `ui-08b` (assigned crew + Trip Details), `ui-11` (tracking sheet), `ui-12` (rating),
`ui-23` (drawer). Side-by-side comparison used `docs/reference-2026-10-19/board-crops/`
(step1–step10).

### 15.8 Documented deviations from the mockup

- Icons remain the app's emoji/Styled-View language (no icon font is installed and no new
  dependency was added); the reference's line icons are approximated.
- The S4 search-radius slider, S4 "Real-time" row, S6 ETA/"Arriving in ~12 min" and per-step
  timeline clock times are intentionally absent — none are backed by the backend/schema.
- The drawer keeps real rows the mockup doesn't show (trip counters, My Trips, Safety & SOS,
  Become a Driver, …) because the app is a working product and other flows anchor on them.
- Trip Details uses colour-coded dot circles rather than pin glyphs (emoji pins cannot be
  tinted green/red); labels and layout follow the reference.
- The rating screen has no fare summary (the stored fare lives on the receipt, which is the
  system of record).
