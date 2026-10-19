# RESQ Nepal — Known Limitations

This project is a React Native (Expo) mobile client connected **directly** to a managed
database (Supabase) with no custom backend, exactly as required. This document lists every
capability that cannot be fully guaranteed in that architecture, so nothing is silently faked.

## 1. Driver verification cannot be self-served

**What the app does:** a driver can submit an application (`drivers` insert with
`status = 'pending'`), upload verification documents, and see their status.
**What it deliberately cannot do:** change its own status to `verified`. A database trigger +
RLS policy reject any client attempt to modify `status`, `rating`, `total_rides` or
`verified_at`.
**To approve a driver:** run the SQL in `docs/database-setup.md` §7 as the project owner, or
use the Supabase dashboard. A production product would need an admin surface (Supabase
dashboard, a separate admin app, or the service role in trusted infrastructure).

## 2. Booking assignment is safe but not a guarantees-everything dispatcher

- The `accept_booking()` RPC performs an atomic compare-and-set, so two drivers racing for the
  same pending booking cannot both win — the loser receives "booking is no longer available".
- **Not covered:** push notification *delivery* of new bookings in the background, automatic
  dispatch ordering, driver timeout re-assignment, and any matching logic beyond "first verified
  driver to accept". Those require a trusted always-on worker (Supabase Edge Functions, cron, or
  a backend) and are intentionally out of scope.
- **No server-side search:** the booking-status “Finding an ambulance…” state is an animated,
  labelled waiting state around a real `pending` row (or a local-only demo request) — it is not a
  server query and the radar is decorative, not GPS. See `docs/resq-backend-integration-readiness.md`.
- Without push infrastructure, a driver sees new requests when the Requests screen refreshes.

## 3. Chat, voice and video calling

The reference includes chat and call screens. The app implements the full UI (threads, call
timer, mute/video toggles) with local state. Real end-to-end chat/calling needs a realtime
service — turn on Supabase Realtime on a `messages` table, or integrate a calling SDK
(e.g. LiveKit/Twilio) and store its credentials in secure infrastructure. Until then the UI is
demonstrative and says so.

## 4. Payments

- The wallet is a client-side ledger for development; there is no payment-gateway capture.
- eSewa/Khalti/IME Pay/Connect IPS buttons model the flow but do not perform real transactions
  (that requires merchant credentials and a server-side signature/verification step).
- Card entry validates locally and **never stores PANs** — correct behaviour, and real card
  processing requires a tokenisation provider (Stripe/Adyen etc.).
- Production pricing/charging logic should run server-side.

## 5. Postgres/Realtime subscriptions

Trip status updates are fetched by polling/refetch on screen focus. Live push updates require
enabling Supabase Realtime replication for `bookings` and `trip_locations` (a dashboard toggle)
— the client API supports it but the toggle is environment-specific, so the app treats polling
as the baseline.

## 6. Background location

Only foreground location is implemented (see `maps-setup.md` §6). Continuous background
tracking requires `expo-task-manager` + store review; it is not claimed.

## 7. App language switching

The language picker is fully implemented, but app copy ships in English only. Wiring 11
languages needs an i18n catalogue (e.g. `i18next` + translations) — the UI is ready for it.

## 8. Map tiles need platform keys

Interactive Google map tiles require adding platform API keys and rebuilding natively
(`maps-setup.md`). Without keys the app shows its own styled map surface with real pins and
route lines — never a fake "live" map.

## 9. Push notifications

The notifications list, unread badges and settings all work against the `notifications` table.
OS-level push (Expo Notifications/FCM) requires project credentials and a sending pipeline
(server-side) — not included, and not claimed.

## 10. Session & auth

Phone OTP sign-in goes through Supabase Auth when `.env` credentials exist. Without them, the
app is fully navigable through a clearly-labelled local development session — it does not
pretend a real account was verified. No plaintext passwords or privileged keys are ever stored
on-device.

## 11. Fare offers (proposing your own price) are not supported

**What the app does:** every fare shown is either an *indicative* estimate computed from the
real distance and the published rate card (`src/constants/fares.ts`) or the recorded final fare
on a completed booking. The fare is stored in `bookings.estimated_fare` / `bookings.final_fare`.
**What it deliberately cannot do:** let a patient propose a fare, or a driver accept / reject /
counter an offered price. There is no `offered_fare` column, no offer-status model, and no
accept/reject machinery — so the app never sends an "offer".
**To implement the inDrive-style "Offering your fare" stage, you need:** (1) an
`offered_fare numeric` column (or a `fare_offers` table) on the booking, (2) offer statuses
(e.g. `offer_sent` / `offer_accepted` / `offer_rejected`) with RLS allowing the booking owner to
set/revise the offer and the assigned-side driver to accept it, (3) an atomic RPC so acceptance
matches exactly one driver, and (4) realtime or polling transport for counter-offers. Until
then the app shows **no offer control at all** — the earlier demo-only fare preview card was
removed on 2026-10-19 so the booking path cannot imply a capability the backend does not have.

## 12. Live ambulance GPS updates are not wired end-to-end

**What exists:** a `trip_locations` breadcrumb table with full RLS (`select` for the booking's
patient and assigned driver; `insert` only for the assigned driver, whose booking is in
`assigned`/active states), plus a typed service (`src/services/database/trips.ts`:
`recordLocation` / `getLatestLocation` / `getTrail`).
**What is missing:** (1) the driver app never calls `recordLocation` — there is no periodic or
background location loop on the driver side; (2) the patient map never reads `getTrail` /
`getLatestLocation` — trip screens show the recorded route summary and honest straight-line
previews, not live movement; (3) Supabase Realtime is not enabled on `trip_locations` (no
`alter publication supabase_realtime add table`), so updates would need polling or a realtime
publication; (4) background location on the driver device needs `expo-location`
background permissions and store review.
**To ship real live tracking:** turn on the driver-side recording loop (foreground while the
trip screen is open, background via `expo-task-manager`), add polling or Realtime consumption on
the patient trip map, and verify the privacy review of continuous location collection. The app
currently shows only real coordinates it holds (pickup / destination markers) and labels every
map as a straight-line preview — never a fake moving ambulance.

## 13. Assigned-crew details (driver name, verification, plate, contact number) are not readable by the patient client

**What exists:** the booking row the patient owns records that a crew *was* assigned
(`driver_id` / `ambulance_id`), and the status screen shows the assigned state plus a clearly
labelled demo preview of the crew card. The client-side lookup
(`src/services/database/assignedCrew.ts`) is written against the reviewed backend function and
falls back to an honest "restricted" state when that function is not deployed.

**What is missing:** the three related rows are deliberately not exposed to a patient by the
current policies —
`profiles` has only `profiles_select_own`, `drivers` only `drivers_select_own`, and
`ambulances` only `ambulances_select_available` (an assigned ambulance is normally `'busy'`).
So a real booking can truthfully show *that* a crew is assigned, but not the driver's name,
photo, verified status, the ambulance's registration number, or a contact number for the
native dialer. Nothing client-side tries to work around this (no widened policy, no
`service_role` key, no guessing).

**The precise, reviewed backend change** is a single read-only function,
`public.get_assigned_crew(p_booking_id uuid)`, in
`supabase/patches/assigned_crew_visibility.sql` (reviewed, validated on a local PostgreSQL 15.8
instance — see `supabase/patches/verify_assigned_crew_visibility.sql` — and **not yet applied
to the hosted project**). It:
- returns rows only when `bookings.user_id = auth.uid()` (the caller owns the booking);
- returns rows only while a driver is actually assigned (never for
  `pending`/`cancelled`/`rejected` bookings);
- returns the contact phone only while the trip is operationally active
  (`assigned`/`arriving`/`arrived`/`started`), `null` afterwards — the patient UI shows the
  **Call Driver** action in exactly that window;
- is `STABLE` + `SECURITY DEFINER` with `search_path` pinned, cannot write, and is granted to
  `authenticated` only (revoked from `public` and `anon`).

**Deployment:** manually in the Supabase SQL Editor (Dashboard → SQL Editor → paste → Run);
full behavioural verification is `supabase/patches/verify_assigned_crew_visibility.sql`.
Until it is deployed, the status screen shows neutral fallbacks ("Assigned ambulance crew",
dots-free placeholder avatar, no plate line) and **Call Driver** answers "Driver contact is
currently unavailable" — the app never invents a name, plate or phone number.

## 14. Driver-side requests and location are not realtime

**What exists:** for real accounts the driver screens use real data end-to-end: incoming
assignments are listed from the driver's own bookings when the requests screen opens, accept
is the atomic server-side `accept_booking` RPC, and trip phase transitions are persisted
through `bookingsService.updateStatus`. The dashboard shows the device's own GPS position as a
read-only map marker. The Driver Mode walkthrough (demo/sample builds only) is a completely
isolated in-memory experience (`src/store/driverDemoStore.ts`) — sample requests, trip phases
and the online toggle never touch Supabase.

**What is missing:**
- **No realtime request delivery**: the requests list loads once when the screen opens — no
  Supabase Realtime subscription, no polling, no push notification when a new booking matches
  the driver (see §5 and §9). A driver must reopen the screen to see new requests.
- **Decline is local-only**: declining removes the request from the driver's own list; no
  backend record is written, and the booking stays pending for other drivers (which is the
  correct dispatch semantics here, but there is no "declined by driver X" audit).
- **Driver location is display-only**: the app never uploads continuous position updates (no
  background location — §6), so patients cannot see live ambulance movement anywhere; trip
  maps remain labelled straight-line previews.
- **Walkthrough isolation**: restarting the app clears the walkthrough (by design); the
  online toggle and completed-trip counter survive navigation but not a relaunch.

**Why:** realtime fan-out for requests and continuous location streaming need backend tables
and policies (Realtime publication, push tokens) that are deliberately out of scope for this
client-only increment and are tracked in the standing limitations above.

## 15. Identity registration, private document storage and application status

**What exists:** real (non-demo) signup collects a citizenship number and citizenship image; driver
registration collects citizenship, driving licence (number, expiry, image) and a vehicle Blue Book.
Images upload to a private `identity-documents` Storage bucket; Postgres stores metadata only. The
`submit_identity_application(text)` RPC re-checks ownership and the actual private objects before
creating a `registration_applications` row. The shared Application Status screen shows the reference
ID, submission date, status and document upload states, including empty/error/retry/session-expiry
states. New applications remain `PENDING_VERIFICATION`; `drivers.status` is still the sole driver
approval source.

**What is not deployed or verified:**
- The two identity migrations and the private bucket are **not applied to the hosted Supabase
  project**. Until the owner explicitly approves deployment, live signup/upload/submission returns
  the app's honest “Identity registration is not enabled on this database yet” error.
- Live Supabase Storage upload/delete behaviour has not been exercised against the hosted project.
- Hosted phone OTP is not enabled/verified, so a live authenticated signup cannot be completed.
- Camera capture and HEIC upload have not been verified on a physical iOS or Android device.
- The local SQL harness uses a disposable PostgreSQL 16 container with Supabase stubs; it proves
  schema/RLS/RPC/constraint logic, not Supabase Storage binary transport.

**What is intentionally missing:**
- No reviewer/admin UI, OCR, authenticity check, malware scan or automated approval. “Pending
  verification” is a real pending state and never a simulated success. An authorized operator must
  review and update `drivers.status` (and user application status) outside the client.
- Capture is camera-only images. PDFs and gallery files are rejected in this phase.
- One driver application per account. The Blue Book is checked against the driver's newest vehicle;
  per-vehicle applications and a multi-vehicle selector are not implemented.
- Deleting a profile cascades `identity_documents` metadata but does **not** automatically delete the
  private Storage objects. A service-role cleanup job/retention policy is still required.
- Citizenship numbers/documents are sensitive PII. RLS limits access, but there is no
  application-layer encryption or data-retention automation.
- No physical-device, production-scale, backup/restore or accessibility readiness is claimed.

**Deployment/testing record:** `docs/identity-registration-status-implementation.md` records the
executed PASS/BLOCKED/UNTESTED checks and the approval-gated deployment procedure.

## 16. Booking updates are not state-machine enforced server-side

`bookings_update_involved` RLS lets the booking owner and the assigned driver update **any column
of the row** — including `status`, `driver_id`, `ambulance_id` and `final_fare`. The shipped app
only ever sends legitimate transitions, and the `booking_status_history` trigger records changes,
but a modified client could falsify trip state or attribution. The fix is a server-side
`BEFORE UPDATE` trigger with a transition allow-list and immutable-column guards; it is specified
(and explicitly **not written or deployed**) in `docs/resq-backend-integration-readiness.md` §5.
Until it ships, booking status should be treated as client-asserted, not server-guaranteed.
