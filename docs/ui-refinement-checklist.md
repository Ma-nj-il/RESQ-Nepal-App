# UI/UX Refinement — Implementation Checklist (2026-10-18)

Working checklist for the "reference ZIP" refinement round. Reference screenshots live in a
temporary directory (`iloveimg-compressed (1).zip`, 5 files, 10 panels) — the original ZIP and
its contents are **not** modified. This file tracks what is audited, changed and verified.

## Reference panels (inspected at full resolution)

| # | Panel | Reference content |
| --- | --- | --- |
| R1 | Main screen | Map-first home, destination sheet with search, Suggested/Last rides/Saved tabs, place list |
| R2 | Where do you want to go? / Pickup location | Map + ETA badge, search, selected place, CONFIRM DROP-OFF / CONFIRM PICKUP |
| R3 | Ride Summary | Map + ETA, vehicle options with price + ETA (Economy / Premium) |
| R4 | Payment method | Floating destination/pickup edit cards, vehicle selection, Cash + promo, CONFIRM RIDE |
| R5 | Finding your raider | Bottom sheet with pickup/dropoff + Edit, BOOKING DETAILS (vehicle/Cash/Fare), MANAGE RIDE |
| R6 | Your raider is on the way + cancel popup | Driver card (name, vehicle, plate), CALL/CHAT, TRIP DETAILS, MANAGE RIDE, cancel confirm sheet |
| R7 | Rating | 5 stars, "What went wrong?" chips, Submit, bottom nav |
| R8 | Ride History | Trip list with pickup/dropoff, date/time, fare, bottom nav |
| R9 | Ongoing Trip (driver) | Kathmandu map, driver sheet, START TRIP / I ARRIVED |

## Screen-by-screen audit (before)

| Reference | Existing screen(s) | Verdict | Planned action |
| --- | --- | --- | --- |
| R1 | `HomeScreen` | ✗ placeholder map, no pickup/destination fields, no booking CTA, emoji header | Rebuild: real map, pickup + destination fields, Find Ambulance, SOS entry, tab bar |
| R2 | `LocationSearchScreen` | ✗ hardcoded `MOCK_RESULTS`, decorative search, no map, no confirm step | Rebuild on real data: `hospitals` table (6 real rows), saved places, recent trips, labelled sample fallback |
| R3/R4/R5 | `AmbulanceListScreen`, `AmbulanceDetailsScreen`, `BookingConfirmationScreen` | ~ list w/ date & passenger pickers, no map sheet; payment defaults to **wallet**; fare uses invented 5.2 km default | Rebuild list as map + sheet with Basic/ICU cards + real vehicles; cash-only; honest fare states |
| R5 | `ProcessingScreen`, `BookingStatusScreen` | ~ spinner + timeline, `rejected` unhandled, "Total Fare" falls back to hardcoded 1,500 | Matching states: submitted/searching/assigned/no-ambulance/failed/cancelled; no fabricated totals |
| R6 | `TripTrackingScreen`, `CallScreen`, `ChatScreen`, `CancelRideScreen` | ~ real driver/vehicle data, placeholder map, cancel always visible | Polish: real map, timeline, terminal states, hide cancel when not allowed |
| R7 | `RatingScreen` | ~ stars only, no feedback chips/comment/skip | Add chips + optional comment + skip; persist `feedback` |
| R8 | `ActivityScreen` | ~ destination-only, mock trips when signed out, no details entry | Add pickup+destination, open-details, demo guard |
| R9 | `DriverTripScreen` | ✓ Arrived at Pickup → Start Trip → Complete exists | Preserve (authorized driver flow unchanged) |
| — | SOS | ✗ missing entirely | New screen: 3-tap activation, GPS capture, local queue, honest SMS composer |
| — | `AccountScreen` | ~ 3 menu items point at wrong/duplicate routes | Tidy menu, shared bottom tab bar |

## Cross-cutting findings

1. **`bookingStore.setPickup/setDestination` are never called** — confirmed booking payloads lose
   the route in real mode. Fix: location selection writes to the store; screens read it.
2. **Fare honesty** — `estimateFare` silently used `DEFAULT_TRIP_DISTANCE_KM = 5.2`. Replace with:
   estimate only when both points have coordinates (straight-line distance, clearly labelled),
   otherwise a "fare confirmed after trip" state. Rate card itself is reused, not invented.
3. **Cash-only booking journey** — remove wallet/eSewa/Khalti options from the booking screens
   (keep Cash selected; historical/account screens untouched, they are already labelled demo).
4. **Demo mode vs database** — demo user id is not a UUID: DB-backed screens must branch on
   `isDemoMode()` exactly like the auth screens already do (no DB writes in demo).
5. **Duplicated bottom nav** in Home/Activity/Account → shared `BottomTabBar` component.
6. **Duplicated stack route** `Ambulances` + `AmbulanceList` for one screen → keep one.

## Implementation order

- [x] Foundation: `serviceCategories` constants, `hospitals` service, `geo` util, SOS service + constants, types
- [x] Shared UI: `BottomTabBar`, `MapCanvas` (react-native-maps in Expo Go, schematic fallback), `ServiceCategoryCard`, `RouteSummary`, `TripTimeline`
- [x] Home rebuild (map-first, pickup/destination, CTA, SOS)
- [x] LocationSearch rebuild (real search + confirm)
- [x] AmbulanceList rebuild (map + sheet, Basic/ICU categories first, real vehicles)
- [x] AmbulanceDetails + BookingConfirmation (cash-only, honest fare, edit route)
- [x] Processing + BookingStatus (matching states)
- [x] TripTracking + Arrival (active trip, terminal states, share summary, book again)
- [x] Activity (trip history) + Rating (feedback) + Account (tidy, cash-only wallet card)
- [x] SOS screen + routes + Home entry
- [x] Notifications inbox (real `notifications` table in real mode, labelled samples in demo)
- [x] Booking for someone else (self/other selector, caregiver fields → existing `notes` column)
- [x] Trusted emergency contacts (device-local, wired into SOS SMS composer)
- [x] Gates: `tsc --noEmit`, `expo lint`, `expo export --platform ios`
- [x] Simulator verification + screenshots + Maestro flows (`qa/maestro/maestro-verify-booking.yaml`, `qa/maestro/maestro-verify-history-rating-sos.yaml`)
- [x] Final report (`docs/ui-refinement-report.md` + chat)

## Round 2 additions (after the first visual pass)

| Area | Change | Reason |
| --- | --- | --- |
| Home | SOS subtitle "Open the one-tap SOS screen" → "Three deliberate taps to arm the alert" | Copy contradicted the actual 3-tap design |
| Account | Wallet card is informational only; "Top Up" CTA removed | Cash-only build; no active online payment entry points |
| AmbulanceList | Category cards moved above the vehicle list; sample rows say "Sample vehicle — availability not confirmed" | Categories are the primary choice; sample rows must not claim live availability |
| TripTracking | "Share trip summary" (native share sheet, no patient details) and "Book again" (prefills route) | Family sharing + quick rebook with no fabricated live link |
| Notifications | In-app inbox with read/unread, empty/error/retry states, taps open the trip | Spec item; reuses the existing `notifications` table |
| Booking | "For myself / For someone else" with caregiver fields stored in `bookings.notes` | Required family/caregiver flow without inventing schema |
| SOS | Trusted contacts (device-local) with add/edit/remove + per-contact SMS composer | Spec item; contacts never auto-send anything |
| Receipt | `ShareReceiptScreen` renders a real trip receipt when opened with a booking (ref, date, route, service, status, payment: cash, recorded fare or honest pending state) with native share; `TripTracking` shows "View receipt" on completed trips | Spec item; the screen was previously reachable only from the inactive wallet flow and rendered no trip data |
| MapCanvas | Debug `console.warn` diagnostics removed; `DemoMapView.tsx` (superseded) deleted | Cleanup after the real map was confirmed working |
| AmbulanceList | Sheet converted from an absolute overlay to a normal flex column sibling; the 64% height cap moved onto the sheet wrapper (the ScrollView fills it) | Yoga resolved a percentage `maxHeight` on the ScrollView twice (72%×72%): the sheet first stopped ~180 pt short of the bottom (raw map visible below it), then clipped its own content mid-scroll. Diagnosed via accessibility-hierarchy frames (sheet `[0,210][402,663]` instead of ending at 840) |
| AmbulanceList | Category card count says "1 sample vehicle" in demo (was "1 listed as available") | Sample vehicles must not read as confirmed live availability |
| QA flows | Back navigation uses the button's accessibility label "Go back"; the someone-else check scrolls to the revealed section; button targets near the bottom edge scroll with `centerElement: true` | The labelled back button does not expose its "←" glyph to Maestro; the caregiver fields sit below the fold; a button resting in the home-indicator zone swallows the tap (log: tap at y=847 of 874) |
| Account / Activity | Scroll content gained bottom clearance (paddingBottom 84) | The last menu row / trip card could sit under the fixed bottom tab bar, making its lower half untappable |

## Round 3 additions (A–Z master-prompt delta)

Audit outcome first — most of the A–Z areas already existed and were verified as-is: Personal Info
(avatar + DOB + real `profiles.update`), Security (password change, signed-in devices, deletion
request), Help/FAQ, Legal/Privacy/Terms (draft-labelled), Language and Appearance (honest "not
live yet" states), Notifications with preferences, Payment Methods (honest "not in this build"
alert), wallet card (informational), logout. Genuinely missing and built in this round:

| Area | Change | Reason |
| --- | --- | --- |
| Home | Top-left ☰ "Open menu" round button in the header | Drawer entry per spec; matched to the existing round location button |
| Drawer (new `MenuDrawerScreen`) | Transparent-modal panel: profile header → PersonalInfo; real trip counters with sample-data note; groups (My Trips, Saved Hospitals, Saved Places, Notifications / Safety & SOS, Become a Driver / Settings, Help, Legal & Privacy, About); Log Out with confirm | Spec §7; custom modal keeps React Navigation without new dependencies; menu rows `replace()` the drawer while it is still mounted |
| Trip counters (new `services/stats/tripCounts.ts`, `hooks/useTripCounts.ts`) | One counting rule (total / completed / cancelled[+rejected] / active) shared by drawer + Account screen; loading/error/retry; demo shows the labelled sample trips | Spec §8; no double counting; single source for every surface |
| Saved Places (new screen) | Real `saved_places` DB CRUD through the existing service; name + type (home/work/other) + GPS-captured location (device reverse geocode); "Set pickup / Set destination" writes the booking store and returns Home; demo mode never writes — it shows an honest alert | The `saved_places` table already existed — no duplicate device-local store was created |
| Saved Hospitals (new screen + `services/hospitals/savedHospitalsService.ts`) | Live search of the public `hospitals` directory (real rows, debounced, stale-response guard) + a device-local starred snapshot (max 20) with a "details can change" note; Set destination navigates Home | No `saved_hospitals` table — local-only snapshot, schema contract documented |
| Settings hub (new screen) | Notifications, App appearance, Language (honest translations note), Location permission → `Linking.openSettings()`, Account & Security, Privacy Policy, Terms of Service, About + version; footnote explains sound/haptics are absent instead of showing dead toggles | Spec §15/§19 |
| About (new screen) | Brand block + version, "What RESQ Nepal does", "What this build does not do yet" (dispatch network, cash only, translations, storage locations, driver onboarding), emergency notice without invented numbers | Spec §21 |
| Driver onboarding (new screen + `services/driver/driverOnboardingService.ts`) | Validated form (licence number/expiry, plate, category chips from existing `SERVICE_CATEGORIES`, equipment checklist from real capabilities, optional affiliation); saves a device draft only; status card says nothing was submitted; Submit shows an honest "not connected yet" alert | Spec — frontend + typed contracts, never a false submission or approval |
| API contracts (new `src/services/api/contracts.ts`, `docs/future-api-contracts.md`) | Typed DTOs for every future capability + 25 endpoint sketches with auth/authorization/error rules | Spec §23 |
| Header (shared) | Back button gained `accessibilityLabel="Go back"` + hitSlop | Accessibility; flows target the label |
| Activity | Sample trips moved to `src/constants/demoSamples.ts` (shared with the counters hook) | One labelled source for demo data |
| QA | New `qa/maestro/maestro-verify-menu-account.yaml` (Flow C); Flow B notifications back-selector moved to "Go back" | Coverage for all new surfaces + regression |

**Round-3 verification (all green):** `tsc --noEmit` 0 errors · `expo lint` 0 problems ·
`expo export --platform ios` exit 0 (3.6 MB Hermes bundle) · Flow C **PASS end-to-end** with
screenshots `ui-23…ui-33` · Flow A re-run **PASS** (booking regression, run `2026-10-18_222952`) ·
Flow B re-run **PASS** (history/rating/SOS regression, run `2026-10-18_223201`). Evidence bundle
`docs/ui-refinement-evidence/` (39 screenshots) refreshed with the final UI.

## Constraints honoured

- Existing navigation architecture (React Navigation), state (Zustand), DB layer (existing
  Supabase client + services) preserved. No new dependencies, no new backend, no DB writes,
  no commits. Reference ZIP untouched.
