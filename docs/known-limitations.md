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
