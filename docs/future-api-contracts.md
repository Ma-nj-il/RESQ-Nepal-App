# RESQ Nepal — Future Backend API Contracts

Status: **design document for a backend that does not exist yet.** The mobile app
talks to Supabase directly today (`src/services/database/*`, RLS-protected).
This document defines the HTTP API the client will migrate to so no backend has
to be invented ad-hoc later. Typed request/response shapes live in
`src/services/api/contracts.ts`. Nothing here is implemented, and no screen may
claim a server operation succeeded until the matching endpoint exists.

## Conventions

- Base URL from `EXPO_PUBLIC_API_BASE_URL` (non-secret, per environment).
- JSON only. Dates are ISO-8601 UTC strings.
- Auth: `Authorization: Bearer <Supabase access token>`; the API verifies the
  token and derives the user id server-side. A client-supplied user id is never
  trusted for authorization.
- Error envelope: `{ "error": { "code": "string", "message": "human text" } }`
  with 400 validation, 401 unauthenticated, 403 forbidden, 404 missing,
  409 conflict (e.g. duplicate booking), 429 rate-limited, 5xx server.
- List responses are cursor-paged: `{ "items": [...], "nextCursor": string|null }`.
- Every mutation is idempotent-safe where noted (booking creation accepts an
  `Idempotency-Key` header to prevent duplicate submissions).

## Endpoint sketches

| # | Capability | Method & route | Request → Response | Auth / authorization | Database support needed |
|---|-----------|----------------|--------------------|----------------------|-------------------------|
| 1 | Session exchange | `POST /auth/session` | Supabase token → user profile + role | Any valid token | existing `profiles` (+ role column) |
| 2 | Profile update | `PATCH /me` | `ProfileUpdateRequest` → `Profile` | Self only | existing `profiles` (RLS: `auth.uid() = id`) |
| 3 | Profile photo upload | `POST /me/avatar` (multipart) | image → `{ avatarUrl }` | Self only | object storage bucket + size/type limits; never expose raw bucket URLs beyond the signed URL |
| 4 | Hospital search | `GET /hospitals?q=&cursor=` | → `HospitalSearchResponse` | Public read | existing `hospitals` (admin-managed) |
| 5 | Saved places list/create/update/delete | `GET/POST /saved-places`, `PATCH/DELETE /saved-places/:id` | `SavedPlaceDto` | Owner only | **exists**: `saved_places` table + RLS |
| 6 | Saved hospitals list/save/remove | `GET/PUT/DELETE /saved-hospitals/:hospitalId` | `SavedHospitalDto` | Owner only | **missing**: `saved_hospitals (user_id, hospital_id, saved_at)` + RLS |
| 7 | Create booking | `POST /bookings` (+ `Idempotency-Key`) | `CreateBookingRequest` → `BookingDto` | Authenticated user | existing `bookings`; server must own status transitions |
| 8 | Booking list / detail | `GET /bookings?status=&cursor=`, `GET /bookings/:id` | → `BookingDto` | Owner or assigned driver only | existing `bookings` RLS |
| 9 | Cancel booking | `POST /bookings/:id/cancel` | reason → `BookingDto` | Owner (pre-pickup rules) or dispatch | server-side transition rules |
| 10 | Ambulance availability | `GET /ambulances/available?category=&lat=&lng=` | → verified vehicles only | Authenticated | dispatch system; never return unverified availability |
| 11 | Driver/vehicle assignment | `GET /bookings/:id/assignment` | → driver + vehicle snapshot | Owner sees contact data only after assignment | existing `drivers`, `ambulances` |
| 12 | Booking status stream | `GET /bookings/:id/events` (SSE/poll) | → ordered status events | Owner or assigned driver | server-side event log; replaces simulated timelines |
| 13 | Trip history & counters | `GET /trips?cursor=`, `GET /trips/counts` | → `TripCountsDto` | Owner only | counts derived server-side (single counting rule) |
| 14 | Notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` | → `AppNotificationDto[]` | Owner only | `notifications` table (existing service wraps a table today) |
| 15 | Notification preferences | `GET/PUT /me/notification-preferences` | `NotificationPreferencesDto` | Self only | per-user row; push delivery only after a push provider exists |
| 16 | Emergency contacts | `GET/POST/PATCH/DELETE /me/emergency-contacts` | contact DTOs | Self only | currently device-local by design; server sync only with explicit consent |
| 17 | SOS events | `POST /sos-events` | `SosEventRequest` → `SosEventDto` | Authenticated | server queue + real dispatch integration before any "responder contacted" claim |
| 18 | Driver application submit | `POST /driver-applications` (multipart docs) | `DriverApplicationRequest` → `DriverApplicationDto` | Authenticated applicant | `driver_applications` + document storage + reviewer workflow; approval is server/back-office only |
| 19 | Driver application status | `GET /driver-applications/me` | → `DriverApplicationDto` | Applicant sees own | same table |
| 20 | Driver incoming requests | `GET /driver/requests` | matching bookings for this verified driver | **verified driver only** (server checks verification state) | dispatch matching service |
| 21 | Driver trip transitions | `POST /driver/bookings/:id/events` (`arrived`, `picked_up`, `completed`) | event → `BookingDto` | Assigned verified driver only | server validates allowed transitions only |
| 22 | Cash payment status | `POST /bookings/:id/payment` (`collected`, amount) | → payment status | Assigned driver only | `payment_status` column; UI never marks cash collected on its own |
| 23 | Receipt | `GET /bookings/:id/receipt` | → `ReceiptDto` | Owner only | derived from booking + payment status |
| 24 | Feedback / complaints | `POST /bookings/:id/feedback`, `POST /complaints` | `FeedbackRequest` → ok | Owner only | `ratings` (exists) + complaints table |
| 25 | Account deletion request | `POST /me/deletion-request` | → request reference | Self only | back-office workflow with legal retention rules |

## Security rules that the backend must enforce

1. User id always derived from the verified token — never from the request body.
2. Row scope: a user reads only own profile/bookings/notifications; a driver
   reads only assigned requests; hospital data is public read, write is admin.
3. Documents (licences, registration papers) go to private storage with signed
   URLs and server-side scanning; mobile clients never receive bucket secrets.
4. Status transitions (`assigned → started → completed`, cancellations) are
   validated server-side against the actor's role; the client only requests.
5. Counters and receipts are computed server-side so every surface agrees.
6. Secrets stay server-side; the app only carries `EXPO_PUBLIC_*` config.

## Known gaps this contract fills (current build)

- No dispatch/matching service and no driver partner network → assignment
  screens stay in "finding" states and demo mode stays clearly labelled.
- `saved_hospitals` table missing → the app keeps a device-local starred list
  and says so on screen.
- No partner onboarding service → the driver application form saves a local
  draft only and states that nothing was submitted.
- No push provider → notification preferences control in-app behaviour only.
