# RESQ Nepal — Comprehensive Engineering, QA & UX Audit

**Date:** 2026-10-19 (evening pass) · **Auditor role:** principal RN engineer + QA + UX
**Scope:** the whole mobile client in `resq-nepal-mobile/` — every screen, route, component, service,
test and QA flow — with a deep re-audit of the booking journey reworked earlier the same day.
**Baseline:** `docs/final-audit-report.md` (2026-10-18 full-file audit) and
`docs/ui-refinement-report.md` remain valid; this document records what changed, what was
re-verified live, what was fixed, and what is still open. Nothing in this document is
fabricated: every PASS below has a command or flow run recorded in
`docs/resq-qa-evidence.md`.

---

## 1. Status

| Area | Verdict |
|---|---|
| Type safety | **PASS** — `npx tsc --noEmit` exit 0 (re-run after the final edit) |
| Lint | **PASS** — `npx expo lint` exit 0 |
| Unit tests | **PASS** — 18/18 (`npm run test:unit`) |
| Production bundle | **PASS** — `npx expo export --platform ios` → `dist/` (3.7 MB Hermes bundle) |
| Booking-journey regression (Maestro A) | **PASS** — final revision, all assertions |
| Driver / activity / account / identity / D1 journeys | **PASS** — 6 flows, see §9 |
| Local SQL harness (identity migrations) | **BLOCKED this session** — Docker CLI unresponsive; prior-session PASS recorded in `docs/identity-registration-status-implementation.md` |
| Live backend operations (uploads, OTP, crew read, dispatch) | **NOT DEPLOYED** — owner approval required; documented in `docs/resq-backend-integration-readiness.md` |
| Real-device testing (camera, HEIC, small screens) | **NOT PERFORMED** — simulator only; stated as a limitation everywhere it matters |

The booking UI now matches the reference interaction set (map-first, compact categories, no
payment step, honest searching state) and the application is stronger operationally: four
cross-cutting defects found in this pass were fixed (error boundary, auth-sign-out handling,
focus-gated polling, reduced-motion support).

## 2. Method & environment

- **Device:** iPhone 17 Pro simulator, iOS 26.4, Expo Go 58.0.4 (SDK 58 / RN 0.88).
- **Server:** Metro on `:8081` with `EXPO_PUBLIC_DEMO_MODE=true`; hosted Supabase credentials present
  for read-only directory data (hospital lookup), demo writes never leave the device.
- **Tooling:** Maestro 2.11.0, `xcrun simctl`, Node test runner, `expo export`.
- **Method:** (a) static review of every file touched or reachable from the booking path plus
  spot-audit of the rest against `docs/screen-register.md`; (b) live interactive runs of eight
  Maestro flows from a clean signed-out state; (c) failure analysis of one environmental flake
  (simulator GPS) and of the earlier XCUITest transport drop; (d) numeric pixel-diff verification
  of the radar animation; (e) security sweep for secrets/logging.

## 3. Inventory (verified against the tree, not assumed)

| Surface | Count | Notes |
|---|---|---|
| Screen source files | **62** `.tsx` | `src/screens/**` |
| Navigation stacks | **3** navigators | `AuthNavigator` (13 routes), `UserNavigator` (48), `DriverNavigator` (13); root `AppNavigator` switches by auth + mode |
| Shared components | **19** | 12 UI primitives, 4 booking, 1 map, 1 identity upload, 1 new `ErrorBoundary` |
| Services | **22** | 13 Supabase-backed (`src/services/database/*`), 1 auth, 1 location, 1 maps, 1 hospitals-local, 1 contacts-local, 1 SOS-local, 1 stats, 1 driver onboarding, 1 API contract doc |
| SQL surface | 1 base schema + 2 identity migrations + 4 patches | `supabase/` (see backend doc) |
| Automated tests | 3 unit files (18 assertions) + 13 Maestro flows | `qa/unit`, `qa/maestro` |
| Screenshots | `docs/booking-ui-audit/{before,reference,after}` (+ journey evidence under `~/.maestro/tests/<ts>/`) | after/ has 01–08 plus two radar frames |

**Reachability finding (new, P3):** 48 user routes are registered but only ~28 are reachable from
the live UI. `Arrival`, `Tip`, `Chat`, `Call`, `PromoList`, `PromoDetail`, `TopUp`,
`TopUpMethod`, `TopUpSuccess`, `TopUpDetails`, `ShareReceipt` and `Logout` have no caller
(`Chat`/`Call` reach each other only). They are retained (no destructive pruning) and listed as
dead UI surface to remove or wire in a future pass; none of them is a booking-path screen.
`PaymentMethods`/`AddPayment` remain reachable from Account and are honest “not connected”
screens — no payment UI exists anywhere in the booking path.

## 4. Interaction & state audit — booking path (deep pass)

Verified live (flow A) and by code reading:

| Step | Behaviour | Verdict |
|---|---|---|
| Home map | Real device/selected coordinates only; straight-line framing via `MapCanvas`; no routing engine invented | Honest |
| Pickup / destination | Real hospital directory rows (Norvic loaded from the DB in the live run); manual pin supported; demo rows labelled demo | Honest |
| Route preview | Both markers + "Approx. X km straight line"; no ETA, no polyline promise | Honest |
| Category cards | Exactly two compact cards, icon + name; description only in accessibility label; selection state is a checked badge; always-visible "Select Ambulance Type" | Matches brief |
| Find Ambulance | Directly pushes `Processing` with full booking payload; no forced explainer/confirmation; secondary vehicle-list flow still exists via the drawer | Matches brief |
| Searching | Map stays visible and dominant (map/sheet are flex siblings, both route points stay on screen); radar rings expand/fade around the pickup; sheet shows honest copy, route summary, cancel | Verified |
| Booking creation | `bookingsService.create` only when configured + not demo + real user id; UUID-guarded `ambulance_id`; `estimated_fare` only from the rate card; `patient_name` only from profile; errors surface a retry sheet | Verified by code + flow |
| Assigned/next states | Demo progression is prefixed "Sample:", crew card says "Sample crew state"/"Demo placeholder"/"Vehicle not assigned"; no fake name, plate or phone; live rows poll every 8 s only while focused | Verified |
| Cancel | Pending: real `updateStatus('cancelled')` for live bookings, local for demo, with different honest alert text | Verified by code + flow B |
| Payment | No payment section, no fare-offer preview, no wallet step anywhere in the booking path; fare fields retained in DB schema and the secondary confirm screen | Verified (`assertNotVisible Payment Method`) |

## 5. Defects fixed in this pass

| # | Sev | Defect | Fix | Evidence |
|---|---|---|---|---|
| 1 | **P1** | No render error boundary — any render exception produced an unrecoverable screen | New `src/components/ErrorBoundary.tsx`, wraps `AppNavigator` in `App.tsx`; neutral recovery UI, no sensitive data in fallback; `__DEV__`-only message logging | tsc/lint clean; all 8 flows render through it |
| 2 | **P1** | Supabase `SIGNED_OUT` (expired/revoked session) did not clear local auth; protected screens could stay mounted | `authService.onAuthStateChange` now forwards the event; `AppNavigator` calls `logout()` only on a real `SIGNED_OUT` (the first implementation cleared demo sessions on `INITIAL_SESSION:null` and was caught and corrected before completion) | tsc/lint; demo flows stay signed in as intended |
| 3 | **P2** | Status screen polled Supabase every 8 s and the demo timeline advanced even while the screen was backgrounded | `useIsFocused` gating for both effects; polling resumes on focus | tsc/lint; flows A/B still pass |
| 4 | **P2** | Search radar ignored the OS Reduce Motion setting | Static origin ring + `AccessibilityInfo.isReduceMotionEnabled`/`reduceMotionChanged` listener; loops untouched otherwise | tsc/lint; radar still animates normally in the two-frame diff |
| 5 | **P3** | `maestro-signout-demo.yaml` assumed the app was foregrounded on Home; failed against a terminated app | Helper is now idempotent: launches Expo Go, signs out only if signed in, always ends on Welcome | Used between flows; Passed |
| 6 | **P3** | `qa/maestro/README.md` flow table described the pre-rework booking flow | Updated with the new flow list, evidence probes, the sign-out helper and the simulator-location prerequisite | Doc updated |

Fixes carried over from the same-day UI rework (all re-verified by flow A in this pass): payment
removal, compact categories, direct booking entry, radar searching screen, sample labelling,
equipment simplification, map/sheet flex layout.

## 6. Defects open (ranked, with owner and plan)

| # | Sev | Finding | Owner / plan |
|---|---|---|---|
| O-1 | **P1** | `bookings_update_involved` RLS allows the booking owner and the assigned driver to update **any** column, including `status`, `driver_id`, `ambulance_id`, `final_fare`. The app only sends valid transitions, but a modified client could falsify trip state or attribution. There is no server-side transition guard (the `booking_status_history` trigger audits, it does not enforce). | Owner: approve a reviewed DB migration (state-machine trigger + immutable-column revoke). Spec in `docs/resq-backend-integration-readiness.md` §5. **Not applied.** |
| O-2 | **P1** | Identity migrations + private Storage bucket not deployed → live signup/upload/status is blocked (honest error shown) | Owner approval; procedure already documented in `docs/identity-registration-status-implementation.md` |
| O-3 | **P1** | `assigned_crew_visibility.sql` not deployed → live patients who are assigned a crew cannot see name/plate/contact; UI shows neutral fallback and “contact unavailable” | Owner approval; patch + local verification SQL exist |
| O-4 | **P2** | No dispatch/matching/push infrastructure: a live booking waits for a verified driver to refresh the requests list; the searching screen is a real pending booking with a client-side animation, not a server search | Backend contract needed (worker + push/Realtime); documented |
| O-5 | **P2** | No live GPS: driver never calls `trips.recordLocation`, patient never reads the trail, Realtime not enabled → trip maps remain labelled straight-line previews | Backend + driver-loop work; documented in `known-limitations.md` §12 |
| O-6 | **P2** | Hosted phone OTP disabled → live authenticated signup unverified end-to-end | Owner decision (SMS provider/cost) |
| O-7 | **P2** | No admin/reviewer UI; identity applications and drivers approvals are manual DB/dashboard actions | Product decision; documented |
| O-8 | **P3** | Dead registered routes (see §3) and reachable-but-unconnected wallet/payment account screens | Effectively cosmetic; remove or wire in a separate pass |
| O-9 | **P3** | `AGENTS.md` mandates Expo Router, while this app uses React Navigation and the mission forbids replacing navigation | Documented conflict; migration would be a standalone project |

## 7. UI / UX review

- **References vs build:** `docs/booking-ui-audit/reference/` holds the inDrive-pattern screenshots
  the brief is based on; `before/` the pre-rework build; `after/` the current build. The current
  home is map-dominant with a compact bottom sheet; categories are two icon+name cards; searching
  keeps the map full-height with a small sheet; assigned states are card-based and clearly sample-labelled.
- **Accessibility:** category cards carry the full description as an accessibility label while
  showing only icon+name; radar is `accessible={false}`/hidden from the a11y tree; Reduce Motion
  respected; primary CTAs ≥ 48 pt; all form fields have labels and inline errors; the dialer is
  only ever invoked through the native `tel:` handoff (unit-tested) and numbers are never rendered
  as text.
- **Honesty inventory:** every state that does not come from a real backend says so in-place —
  “Demo search — no dispatch server is contacted”, “Radar is illustrative — not live GPS.”,
  “Sample: Booking confirmed”, “Sample crew state”, “Vehicle not assigned”, “No records were
  written”, “Demo mode is local-only”, “Sample walkthrough data”. No countdowns, no viewer
  avatars, no fake ETAs, no fake plates.
- **Copy/typography:** unchanged red/white identity, existing type scale and spacing; the only
  text removed was redundant descriptive copy on cards (moved to accessibility labels) and the
  payment/offer UI.

## 8. Backend readiness (summary)

The app talks **directly to Supabase** (Auth, Postgres/RLS, Storage) with no custom backend and no
privileged keys on device. Base schema + hospital seed are live (the flow read a real hospital row);
identity migrations, the storage bucket and two hardening patches are **not** applied. Full matrix,
gaps, security spec and a deploy-order checklist are in
**`docs/resq-backend-integration-readiness.md`**.

## 9. QA evidence (summary)

Eight Maestro flow runs passed this session — six full journeys from a clean signed-out state
(A booking, B activity/rating/SOS, C drawer/account/settings, D driver demo, Identity, D1 demo
journey) plus the radar and no-payment evidence probes run back-to-back on the state flow A leaves
behind. The radar was verified numerically: between two frames 1.2 s apart,
**6.25 %** of sampled map-area pixels changed while **0.07 %** of the bottom sheet changed.
Full commands, exit codes, screenshot paths, the one environmental retry (simulator GPS) and the
blocked items are in **`docs/resq-qa-evidence.md`**.

## 10. Handoff checklist

1. **Approve or reject** the pending hosted changes in this order: (1) `accept_booking` ownership
   guard, (2) `assigned_crew_visibility.sql`, (3) identity migrations + private bucket. Procedures
   and verification SQL are in the backend doc.
2. **Approve the state-machine migration** for `bookings` updates (O-1) before any real booking is
   accepted; until then, treat booking status as advisory.
3. **Enable phone OTP** (or an alternative sign-in) and complete one real signup → upload → status
   read on a staging account.
4. **Wire dispatch + push** (worker + `expo-notifications`) before claiming real ambulance search.
5. **Wire driver location streaming + Realtime** before claiming live tracking.
6. Re-run the checklist in `docs/resq-qa-evidence.md` §6 after any of the above; re-run on a
   physical iOS and Android device for camera/HEIC/small-screen verification.
7. Keep demo mode labelled as-is; it is the only way to walk the flow without a backend, and it
   writes nothing.

## 11. Limitations of this audit

- Automated evidence is **simulator-only**; no physical-device testing, no Android run, no
  small-screen/tablet layout verification.
- Live backend operations could not be exercised (not deployed / OTP disabled); all PASS claims
  about persistence, dispatch or storage are limited to code review, RLS analysis and the local
  SQL harness from the prior session.
- Docker was unavailable during this session, so the SQL harness was not re-run; the prior PASS is
  cited, not re-claimed.
- The dead routes and the Expo-Router guidance in `AGENTS.md` were documented, not migrated.
- No coverage percentage is claimed; the unit suite is 18 focused assertions over pure helpers.
