# Phase 0 — discovery and source-of-truth assessment

## 1. Scope and method

Discovery covered the mobile client, Supabase SQL, Go backend, local infrastructure, and the three
administrative portals. Repository source was treated as authoritative; deployment, hosted-schema,
and vendor-device claims were not assumed.

Evidence classifications:

- **Confirmed:** directly present in source or derived mechanically from it.
- **Inferred:** a design intent is visible, but no complete production path proves it.
- **Unverified:** requires hosted infrastructure, credentials, a physical device, or an owner-run
  environment that was not available during discovery.
- **Mock only:** local sample state demonstrates a workflow, not a persisted capability.

The baseline branch was clean at commit `8c2827a`. The portal directories in the primary working
copy were inspected read-only so uncommitted user work was not moved or modified.

## 2. Current systems are incompatible source realities

```text
Expo mobile ───────────────► Supabase Auth/Postgres/Storage
    │                         (direct client access + RLS)
    └── local/demo stores

Separate Go executables ───► separate PostgreSQL + Redis + NATS
    │                         (broad ride-hailing domain)
    └── WebSockets/providers/stubs

Province portal ───────────► Express in-memory mock database
Hospital portal ───────────► React in-memory state + DVR808 proxy
Super Admin portal ────────► mostly React mock state + limited Go API calls
```

There is no single deployed data model demonstrated by the repository. Identically named concepts
have different identifiers, statuses, ownership rules, and currencies. A safe rebuild must define a
new canonical model and explicit migration mappings rather than choose one source wholesale.

## 3. Mobile and Supabase inventory

### 3.1 Confirmed architecture

- Expo SDK 58 / React Native 0.88 client (`package.json`).
- Supabase phone OTP, persisted client session, direct PostgREST/RPC calls, and RLS
  (`src/services/auth/authService.ts`, `src/services/database/`).
- Twelve base application tables in `supabase/schema.sql`; identity work adds
  `identity_documents` and `registration_applications`.
- Booking acceptance is atomic through `accept_booking`; a later local migration adds a booking
  write guard; another local migration scopes tracking to active trips.
- Existing documentation states that identity/storage and tracking migrations are not proven on the
  hosted project. Their source presence is not deployment evidence.
- The client does not call the Go API. `src/services/api/contracts.ts` is documentation-as-types,
  not an HTTP client.

### 3.2 Product workflows evidenced by screens

| Area | Confirmed workflow | Production limitation | Primary evidence |
|---|---|---|---|
| Authentication | Phone entry, OTP verification, session restore/sign-out | Hosted phone provider state is environment-dependent | `src/services/auth/authService.ts`, `docs/screen-register.md` |
| Identity | User/driver details, private document metadata, application submission/status | Forward migrations and private bucket are not proven hosted; no review UI | `src/services/database/identity.ts`, `supabase/migrations/20261019_identity_registration.sql` |
| Booking | Search, ambulance list/detail, request, accept, status, cancel, trip progress | No dispatch engine; verified drivers poll pending rows | `src/services/database/bookings.ts`, `supabase/schema.sql` |
| Tracking | Driver breadcrumbs and patient reads during active states | Local migration not proven hosted; polling is not a scalable realtime channel | `src/services/database/trips.ts`, `20261024_secure_active_trip_tracking.sql` |
| Completion | Arrival summary, rating, tip metadata, receipts | Payment settlement is not connected | `src/services/database/ratings.ts`, `docs/screen-register.md` |
| Account | Profile, saved places, notifications, support | Several preferences and directories remain device-local | `src/services/database/`, `src/screens/user/` |
| Driver | Registration, vehicle, availability, incoming requests, trip progression, earnings | Approval/admin workflow and real matching are absent | `src/screens/driver/`, `src/services/database/drivers.ts` |
| Safety | SOS UI, emergency contacts, native SMS composer | SOS events are queued locally; delivery is never claimed | `src/services/sos/sosService.ts`, `src/services/contacts/emergencyContactsService.ts` |

The existing screen register identifies 48 registered user routes, only about 28 of which were
reachable from the then-current UI. This is useful scope evidence, but route registration is not a
backend requirement by itself.

### 3.3 Direct data operations

| Client service | Tables/RPC | Operations |
|---|---|---|
| `ambulances.ts` | `ambulances` | select, insert, update, delete |
| `assignedCrew.ts` | `ambulances`, `profiles`, optional `get_assigned_crew` | select/RPC fallback |
| `bookings.ts` | `bookings` | select, insert, update |
| `drivers.ts` | `drivers`, `ambulances` | select, insert, update |
| `hospitals.ts` | `hospitals` | select |
| `identity.ts` | `identity_documents`, `registration_applications`, `submit_identity_application` | select, insert, update, RPC |
| `notifications.ts` | `notifications` | select, insert, update |
| `profiles.ts` | `profiles` | select, insert, update |
| `ratings.ts` | `ratings` | select, insert |
| `savedPlaces.ts` | `saved_places` | select, insert, update, delete |
| `supportRequests.ts` | `support_requests` | select, insert |
| `trips.ts` | `booking_status_history`, `trip_locations` | select, insert |

### 3.4 Local/demo behavior that must not become migration data

- Demo OTP/session, sample booking assignment, driver walkthrough, ratings, wallet/top-ups, promos,
  chat, and call UI are explicitly local or in-memory.
- SOS queue, trusted contacts, saved hospitals, notification preferences, language, and some drafts
  use `AsyncStorage`.
- OSRM's public routing endpoint is a development fallback, not a production SLA.
- Sample hospital/location directories are shown only as labelled fallback data.
- Payment screens do not tokenize or move money; booking is currently cash-oriented.

These paths are valuable acceptance scenarios. Their records and fabricated identities are excluded
from migration.

## 4. Go backend inventory

### 4.1 Surface and composition

- `backend/internal/` contains 33 first-level packages: 32 feature-oriented areas plus
  `adapters`. They cover admin, analytics, auth, cancellation, chat, forecasting, disputes,
  documents, fraud, geo/geography/maps, matching, ML ETA, negotiation, notifications, onboarding,
  pooling, pricing, ratings, realtime/history/rides, ride types, safety, scheduling, support, 2FA,
  vehicles, verification, and wait time.
- A lexical inventory finds **508 Gin method registrations**: 274 GET, 185 POST, 27 PUT, and
  22 DELETE. This is a registration count, not a claim that 508 unique production routes are
  reachable.
- `cmd/` has 11 executables. `backend/Makefile` and Compose declare 13 application services;
  `payments` and `promos` executables are absent.
- There are no Go `*_test.go` files in the baseline.

The detailed registrations and table names are in
[phase-0-api-schema-inventory.md](./phase-0-api-schema-inventory.md).

### 4.2 Useful implementation evidence

The Go source contains patterns worth preserving conceptually, not porting mechanically:

- repository interfaces in many domains;
- PostgreSQL, Redis, NATS JetStream, WebSocket, health, timeout, retry, and tracing packages;
- JWT signing-key identifiers, rotation interval, grace period, and old-key verification;
- Google Maps, Firebase, Twilio, SMTP, S3-compatible storage, and secrets-provider adapters;
- circuit breakers/retries around selected maps, notification, verification, and service calls;
- safety, documents, scheduling, pricing/geography, and admin workflow vocabulary.

### 4.3 Production blockers and unsafe assumptions

| Finding | Impact | Evidence |
|---|---|---|
| No tenant key or consistent tenant guard | Admin/live views can cross provider and province boundaries | `backend/internal/admin/`, repositories and handlers |
| No transactional event outbox | A DB commit can succeed while its event is lost | `backend/internal/rides/service.go` async publish after persistence |
| Refresh-token family rotation absent | No one-time refresh reuse detection or family revocation | `backend/internal/auth/`, `backend/pkg/jwtkeys/` |
| Mobile composition injects stubs | Maps, storage, document verification, payments, SMS, and driver lookup can be nonfunctional | `backend/cmd/mobile/adapters.go`, `main.go` |
| Currency fallbacks conflict | Several ride/history paths silently choose USD while the product presents NPR | `backend/internal/rides/service.go`, `ridehistory/`, `pricing/` |
| Schema history is destructive | Migration 18 drops/recreates `wallet_transactions` | `backend/db/migrations/000018_new_feature_tables.up.sql` |
| Declared services do not compile from source | Compose/Make point to absent `cmd/payments` and `cmd/promos` | `backend/docker-compose.yml`, `backend/Makefile`, `backend/cmd/` |
| Observability mounts are missing | Compose references absent `monitoring/` and collector/Tempo files | `backend/docker-compose.yml`, absent paths under `backend/` |
| Broad domain is mostly unverified | No Go tests and no environment-level proof | absence of `*_test.go`; provider credentials unavailable |
| Incomplete safety behavior | Participant notification is a comment-only method | `backend/internal/safety/service.go` |

### 4.4 Existing events

`backend/pkg/eventbus/eventbus.go` declares NATS subjects for five ride events, two payment events,
three driver events, and fraud detection. Matching subscribes to requested/accepted/cancelled ride
subjects. Safety publishes `safety.sos`; negotiation defines 16 WebSocket-oriented event types.

The generic envelope has event ID, type, source, timestamp, and raw data, but no required tenant,
aggregate version, correlation/causation, schema version, transactional outbox, or consumer inbox.
Publishing in `rides/service.go` occurs in an untracked goroutine after business persistence. The
target architecture therefore replaces behavioral reliance on NATS with Kafka plus outbox/inbox;
it does not transliterate subject strings.

## 5. Administrative portal inventory

### 5.1 Province portal

**Evidence:** `PROVINCE/server.ts`, `src/types/index.ts`, and 23 page components.

- 28 explicit `/api/*` Express registrations plus a SPA wildcard.
- In-memory cloned `INITIAL_DATABASE`; restart loses mutations.
- Tokens are strings held in a process `Map`; password checks and MFA are demonstrative.
- Province filtering and cross-province denial are implemented in the mock server, including an
  audit event. This is workflow evidence, not cryptographic or database isolation.
- Workflows include dashboards, district views, hospital application review/recommendation,
  ambulance flagging, driver directory, booking monitoring/escalation, trip history, document
  review, alerts, support, provincial users, reports, settings, and audit history.
- Roles evidenced: Province Administrator, Provincial Monitoring Officer, Reporting Officer, and
  Read-Only Reviewer.

The portal establishes a valid requirement: province staff need geographically constrained views
and review powers. It does **not** establish province as the provider tenant root.

### 5.2 Hospital portal

**Evidence:** `HOSPITAL/src/context/HospitalContext.tsx`, `src/types/index.ts`, 29 page components,
and `server/`.

- Hospital isolation, session switching, and most role checks are React context/local state.
- Roles evidenced: Hospital Admin, Operations Manager, Ambulance Coordinator, Dispatcher, Fleet
  Manager, Reporting Officer, and Read-Only Staff.
- Dispatch requires a selected in-scope ambulance and driver; local logic checks readiness,
  assignment, and active-trip conflicts.
- Workflows include booking inbox/detail, dispatch, active trip progression/cancellation, fleet,
  maintenance, documents, drivers, staff roles, reports, settings, notifications, support, audit,
  GPS, and dashcam views.
- An ambulance on an active trip cannot be marked available in the demonstrated workflow; status
  changes require reasons and generate local audit entries.
- A same-origin DVR808 proxy exposes 13 routes for vehicles, telemetry, device status, alarms,
  history, tracking, streams, recordings, and playback. Credentials remain server-side, terminal
  allowlisting is supported, and unit tests cover normalization/config/client behavior.
- No real vendor credential, terminal, GPS stream, live video, recording, or playback was verified.

The portal's role strings must become data-driven permissions/role profiles. Its in-memory
cross-hospital checks must become server authorization and database isolation.

### 5.3 Super Admin portal

**Evidence:** `SUPER/src/context/AppContext.tsx`, `src/types/index.ts`, component workflows, and
`src/api/backend.ts`.

- Most national data, integration telemetry, workflows, and mutations are mock React state.
- A limited client calls the Go auth/admin/rides services for login, dashboard, users, drivers,
  approvals, recent rides, statistics, and audit logs.
- Its bearer token is stored in browser `localStorage`; there is no refresh family or demonstrated
  MFA exchange with the Go API.
- Roles are hard-coded booleans for Platform Owner, Super Admin, Ops Manager, Support Officer,
  Finance Officer, and Auditor.
- Workflows cover national dashboards/maps, provinces, hospital review, fleet/drivers, bookings,
  trips, analytics, provincial admins, user roles, documents, support, alerts, financials,
  integrations, security/audit, settings, reports, and acceptance-test views.
- High-risk confirmation dialogs are useful UX requirements but are not authorization controls.

The target retains national oversight as explicit authority, not a default query with no tenant
predicate.

## 6. Cross-source business rules

### 6.1 Rules supported by more than one source

1. Only an eligible/verified driver and operational ambulance may receive work.
2. One request must have at most one accepted assignment; concurrent acceptance must be atomic.
3. Driver, ambulance, facility, and request must share an authorized operational scope.
4. Active-trip resources cannot be independently marked available.
5. Trip status progresses through controlled steps; completion/cancellation releases resources.
6. Patient, assigned crew, facility operators, province authorities, and platform authorities see
   different projections of the same operation.
7. Documents have private bytes, expiry/review states, and an auditable review history.
8. Sensitive or high-risk actions require a reason and immutable audit evidence.
9. GPS reads/writes are limited to authorized active operations and must age into stale/offline
   states.
10. Money and external delivery must never be reported successful from local/demo state.

### 6.2 Conflicts requiring a canonical decision

| Concept | Mobile/Supabase | Go | Portals | Required resolution |
|---|---|---|---|---|
| Tenant | None | None consistently | Hospital or province simulated | Provider organization + facility + authority grant |
| Core unit | `booking` | `ride` | booking + trip | Service request/booking, assignment, and trip as separate aggregates |
| Booking states | 9 lowercase states | 5 ride states | richer 8–9 state variants | Canonical lifecycle and source mappings |
| Driver state | pending/verified/rejected | availability/approval fields | verification + account/duty | Separate verification, account, and duty statuses |
| Ambulance state | available/busy/offline | driver-centric vehicle model | operations + review + GPS | Separate regulatory, operational, and telemetry states |
| Currency | UI expects NPR | mixed NPR/USD defaults | NPR-oriented presentation | NPR default, ISO code, integer minor units |
| Identity | Supabase UUID/phone | Go UUID/email/password | fabricated portal identities | New principal IDs + explicit legacy identity map |
| Admin authority | absent | global admin role | province/national strings | Permission/role/profile assignment + scoped grant |

## 7. Integration inventory and confidence

| Capability | Source evidence | Confidence | Target treatment |
|---|---|---|---|
| PostgreSQL | Supabase DDL and Go migrations/repos | Confirmed in source; hosted state partly unverified | Canonical PostgreSQL/PostGIS |
| Redis | Go cache/rate-limit/realtime code and Compose | Inferred, not environment-proven | Required for BullMQ, rate limits, bounded cache |
| NATS JetStream | Go event bus | Inferred, no outbox | Replaced by Kafka behavior |
| Maps/routing | mobile public OSRM; Go Google/HERE abstractions and stubs | Mixed | Port + approved provider; no fabricated fallback |
| Push/SMS/email | Firebase/Twilio/SMTP code; mobile native SMS composer | Mixed/unverified | Provider ports, BullMQ delivery, signed callbacks |
| Object storage | Supabase private bucket SQL; Go S3 code; mobile composition stub | Mixed | Private S3-compatible adapter |
| OCR/identity/background checks | Go schema/config and disabled/stub paths | Unverified | Deferred adapter after provider/legal approval |
| Payments | Go models/Stripe dependency and mobile demo/cash path | Unverified | Cash ledger first; Nepal providers separately approved |
| Realtime | Supabase polling, Go WebSockets, portal local simulations | Partial | Authenticated gateway with Redis adapter; Kafka fan-out |
| DVR808 | Hospital proxy and unit tests | Code-confirmed/device-unverified | Optional isolated adapter/pilot |
| Observability | Go Pino-equivalent Zap/OTel/Prometheus intent; missing mounts | Partial | Pino + metrics + traces with deployable config |

## 8. Discovery conclusion

The correct rebuild is not a Go-to-Nest syntax port and not a Supabase schema copy. It is a
canonical multitenant platform built around the currently exercised emergency workflow, with
explicit adapters and migration ledgers for each source. The broad legacy feature catalog is a
backlog input only; it does not justify reproducing hundreds of untested routes or 125 legacy table
names in the first release.
