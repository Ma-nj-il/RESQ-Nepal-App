# Phase 1 — HTTP and realtime API contract

- **Status:** proposed contract; no endpoint in this document is implemented.
- **Base path:** `/api/v1`
- **Documentation artifacts:** Markdown, TypeScript DTOs, JSON event schemas, and Postman
  collections; Swagger/OpenAPI generation or runtime UI is explicitly out of scope.

## 1. Contract goals

The API is the only supported application boundary for the new platform. Mobile and portal clients
must not connect directly to PostgreSQL, Redis, Kafka, BullMQ, object storage credentials, or vendor
APIs.

The contract is workflow-compatible, not table-compatible, with the current systems:

- direct Supabase CRUD becomes purpose-specific commands and projections;
- globally readable pending bookings become tenant-scoped dispatch offers;
- generic status updates become named transition commands;
- hard-coded portal roles become permission-protected operations;
- DVR808 and payment routes become provider-neutral resources rather than vendor passthroughs;
- legacy `{ success, data, error }` and mobile `{ ok, data|error }` shapes are not preserved.

## 2. Transport and representation conventions

### 2.1 HTTP

- HTTPS is mandatory outside local development.
- JSON request/response media type is `application/json`; UTF-8 is assumed.
- JSON fields use `camelCase`. Database column names and provider payload names never leak through.
- Client timestamps are RFC 3339 UTC strings with an offset; server timestamps are returned in UTC
  with `Z`. Local Nepal dates are explicit `YYYY-MM-DD` fields, not implicit server time.
- IDs are opaque strings. Clients must not infer ordering, tenant, or resource type from an ID.
- Unknown request fields are rejected. Input DTOs are allowlisted, transformed only where explicit,
  and validated before a use case runs.
- Missing and `null` are distinct. Optional updates use missing for “unchanged”; nullable fields
  document when `null` means “clear.”
- Coordinates are WGS84 `{ "latitude": number, "longitude": number }` and are range-validated.
- Distances use integer meters; durations use integer seconds.
- Money is `{ "amountMinor": "150000", "currency": "NPR" }`. Minor values are decimal strings so
  JavaScript cannot lose `bigint` precision. Floating-point amounts are rejected.
- Phone numbers are accepted in E.164 form after client-side country selection and normalized again
  server-side. Masked values are returned unless the projection permits full content.
- Enumerations are uppercase stable codes. Labels and Nepali/English translations remain client or
  reference-data concerns.

### 2.2 Success envelopes

Single-resource response:

```json
{
  "data": {
    "id": "opaque-id",
    "version": 4
  },
  "meta": {
    "requestId": "01J..."
  }
}
```

Cursor-paged collection:

```json
{
  "data": {
    "items": [],
    "nextCursor": null
  },
  "meta": {
    "requestId": "01J..."
  }
}
```

An opaque, signed cursor contains the fixed sort position and filter fingerprint. It cannot be
edited, reused with different filters, or treated as an offset. Default and maximum page sizes are
route-specific; the platform default is proposed as 25 and hard maximum as 100. Stable ordering
uses a documented field plus ID tie-breaker.

`201` creates a durable resource, `202` accepts asynchronous work, and `204` is used only when no
representation is useful. An asynchronous response returns an operation/export/delivery resource
that can be queried; it never reports the provider action as completed.

### 2.3 Error envelope

```json
{
  "error": {
    "code": "TRIP.INVALID_TRANSITION",
    "message": "The trip cannot perform this action in its current state.",
    "retryable": false,
    "details": [
      { "field": "expectedVersion", "code": "STALE_VERSION" }
    ]
  },
  "meta": {
    "requestId": "01J..."
  }
}
```

- `code` is stable and namespaced; `message` is safe for a user-facing fallback and contains no
  secret, SQL, provider payload, stack, or cross-tenant existence detail.
- `details` is optional and allowlisted. Validation details use public field names.
- `retryable` describes the same request, not whether a product workflow can be attempted again.
- The response carries `X-Request-Id`; the body repeats it for clients and support.
- Out-of-scope and nonexistent sensitive resources use the same `404 RESOURCE.NOT_FOUND` response.

| Status | Meaning | Representative codes |
|---:|---|---|
| 400 | Malformed or semantically invalid input | `REQUEST.VALIDATION_FAILED`, `MONEY.INVALID` |
| 401 | Missing/invalid/expired authentication | `AUTH.ACCESS_TOKEN_EXPIRED`, `AUTH.SESSION_REVOKED` |
| 403 | Authenticated but policy denies the action | `ACCESS.PERMISSION_DENIED`, `ACCESS.STEP_UP_REQUIRED` |
| 404 | Resource absent or undisclosable | `RESOURCE.NOT_FOUND` |
| 409 | State, idempotency, or uniqueness conflict | `DISPATCH.OFFER_ALREADY_RESOLVED`, `REQUEST.STALE_VERSION` |
| 410 | Deliberately expired public/one-time resource | `UPLOAD.GRANT_EXPIRED` |
| 413 / 415 | Body too large / unsupported media | `UPLOAD.SIZE_EXCEEDED`, `UPLOAD.TYPE_NOT_ALLOWED` |
| 422 | Valid syntax but command violates a domain rule | `TRIP.INVALID_TRANSITION`, `AMBULANCE.NOT_ELIGIBLE` |
| 429 | Rate limit or challenge attempt limit | `RATE_LIMIT.EXCEEDED`, `AUTH.OTP_ATTEMPTS_EXCEEDED` |
| 502 / 503 / 504 | Required dependency failure/unavailability/timeout | `MAPS.UNAVAILABLE`, `SERVICE.TEMPORARILY_UNAVAILABLE` |

Provider-specific errors are mapped to platform codes. A Twilio, Firebase, DVR, map, or payment
response is never returned directly.

## 3. Authentication and operational context

### 3.1 Standard headers

| Header | Use |
|---|---|
| `Authorization: Bearer <access-token>` | Required except explicitly public/authentication routes |
| `X-Tenant-Id` | Selects one tenant from the caller's active assignments on `/tenant/*` routes |
| `X-Facility-Id` | Optional facility narrowing when the route supports it |
| `X-Authority-Grant-Id` | Selects the approved grant used on `/authority/*` routes |
| `Idempotency-Key` | Required on externally retryable commands listed below; 16–128 opaque characters |
| `If-Match: "<version>"` | Required on ordinary mutable-resource updates and selected commands |
| `X-Request-Id` | Optional client correlation ID in accepted format; server replaces invalid values |

Tenant/facility/grant headers are selectors, not claims. The server resolves them against current
session, assignment, profile, and grant records. Body/query ownership fields cannot override the
resolved context.

### 3.2 Token delivery

- Mobile receives a short-lived access token and one opaque refresh token; both go only to
  OS-protected secure storage.
- Browser portals receive the refresh token only as a `Secure`, `HttpOnly`, appropriately
  `SameSite` cookie. The short-lived access token remains in memory.
- `POST /auth/tokens/refresh` rotates the refresh token every time. Browser calls use the cookie;
  mobile calls send the token in the documented body. A consumed token's reuse revokes its family.
- Access tokens are never accepted in URLs or realtime query strings.
- Protected calls may return `ACCESS.STEP_UP_REQUIRED` with a short-lived challenge reference. The
  client completes MFA and retries the original command with a newly issued higher-assurance access
  token; it does not send an OTP alongside the business request.

## 4. Idempotency, concurrency, and retries

### 4.1 Idempotency

`Idempotency-Key` is mandatory for booking creation/cancellation, offer response, assignment,
lifecycle commands, SOS creation, cash/payment mutation, access/authority mutation, provider review,
report export, and any provider-facing command.

The server scopes a key to actor, selected context, HTTP operation, and canonical request hash:

- the first completed request stores its status and response;
- an identical retry returns the stored outcome without repeating effects;
- the same key with a different request hash returns `409 REQUEST.IDEMPOTENCY_KEY_REUSED`;
- an in-progress duplicate returns the original result when available or a retryable conflict;
- expiry is policy-specific and cannot undercut the external retry window or financial retention.

GET, PUT-like preference replacement, and token rotation use their own natural or protocol
idempotency rules. Clients must not blindly retry non-idempotent commands without the key.

### 4.2 Aggregate versions

Responses for mutable aggregates include `version` and an `ETag`. Attribute updates require
`If-Match`; stale writes return `409 REQUEST.STALE_VERSION` with no current sensitive data. Named
commands additionally validate state under a database lock/conditional update. `If-Match` alone is
not the double-assignment safeguard.

### 4.3 Retry guidance

- Clients may retry connection failure, `429`, and explicitly retryable `502/503/504` using bounded
  exponential backoff and jitter, honoring `Retry-After`.
- A timeout is an unknown outcome. The same idempotency key must be used to discover/replay the
  original command result.
- `400`, `401`, `403`, `404`, `409`, and `422` are not automatically retried except after the client
  has deliberately corrected authentication, version, input, or workflow state.

## 5. Endpoint catalog

Paths below are relative to `/api/v1`. “Core” means required before the corresponding legacy
workflow can cut over; it does not claim implementation.

### 5.1 Authentication, self-service, and reference data

| Method and path | Purpose | Authorization / notes |
|---|---|---|
| `POST /auth/otp-challenges` | Request phone OTP for registration/login/recovery | Public, enumeration-safe, rate-limited |
| `POST /auth/otp-verifications` | Consume one OTP challenge | Public challenge; issues session or MFA challenge |
| `POST /auth/password-sessions` | Administrative password sign-in where enabled | Public, enumeration-safe, rate-limited |
| `POST /auth/mfa-challenges/:id/verifications` | Complete TOTP/WebAuthn/recovery challenge | Challenge subject only |
| `POST /auth/tokens/refresh` | One-time refresh rotation | Valid unconsumed refresh token/cookie |
| `DELETE /auth/sessions/current` | Revoke current refresh family | Authenticated |
| `GET /me/sessions` | List masked active sessions | Self |
| `DELETE /me/sessions/:sessionId` | Revoke one owned session | Self; step-up for unfamiliar session |
| `POST /me/session-revocations` | Revoke all other or all sessions | Self; idempotent command, step-up |
| `GET /me` | Current profile and account state | Self |
| `PATCH /me` | Update allowlisted profile attributes | Self; `If-Match` |
| `GET /me/access-contexts` | Active tenant assignments, facility scopes, and usable authority grants | Self; no effective secret policy internals |
| `GET/PUT /me/notification-preferences` | Read/replace consent and channel preferences | Self |
| `GET/POST/PATCH/DELETE /me/saved-places[/:id]` | Manage personal places | Self |
| `GET/PUT/DELETE /me/saved-facilities/:facilityId` | Manage starred approved facilities | Self |
| `GET/POST/PATCH/DELETE /me/emergency-contacts[/:id]` | Manage trusted contacts | Self; explicit sync consent |
| `POST /me/push-devices` | Upsert a device push token | Self; token bound to this session/device |
| `DELETE /me/push-devices/:id` | Revoke owned push registration | Self |
| `POST /me/deletion-requests` | Start legal erasure/deactivation workflow | Self; step-up and idempotency |
| `GET /geography/*` | Versioned Nepal province/district/municipality reference | Public or authenticated by dataset |
| `GET /facilities` | Search approved public facility directory | Public fields only; cursor paged |
| `GET /facilities/:id` | Approved facility public detail/service categories | Public fields only |
| `POST /service-coverage-checks` | Check whether a category can be requested at a location | Authenticated; returns no crew/live vehicle identity |

The existing mobile “available ambulances” list is not reproduced as a public live fleet feed. The
core API exposes service/category coverage, then dispatch reveals the selected crew/ambulance only
after assignment.

### 5.2 Uploads, identity, and applications

| Method and path | Purpose | Authorization / notes |
|---|---|---|
| `POST /uploads` | Create short-lived, operation-bound private upload grant | Authenticated; declares subject, purpose, size, MIME, hash |
| `POST /uploads/:uploadId/finalization` | Verify object metadata and queue scan | Upload owner/context; idempotent |
| `GET /uploads/:uploadId` | Read scan/finalization state | Upload owner or content-authorized reviewer |
| `GET /me/registration-application` | Read patient/identity registration state | Self |
| `POST /me/registration-application/submission` | Submit a complete identity application | Self; required documents must be `READY` |
| `POST /me/driver-applications` | Create driver/facility affiliation application | Self; one active application per policy scope |
| `GET /me/driver-applications` | List own application states/review requests | Self |
| `POST /me/driver-applications/:id/submission` | Submit/resubmit driver application | Self; named workflow command |
| `POST /provider-applications` | Create provider/facility onboarding draft | Authenticated applicant |
| `GET/PATCH /provider-applications/:id` | Read/update an owned draft | Applicant; PATCH only while editable, `If-Match` |
| `POST /provider-applications/:id/submission` | Submit/resubmit for province review | Applicant; idempotent command |
| `POST /provider-applications/:id/withdrawal` | Withdraw an allowed application | Applicant; reason required |

Raw multipart uploads through API pods are not the normal path. Finalization does not make content
reviewable until type, size, hash, and malware checks pass.

### 5.3 Patient booking, trip, safety, and feedback

| Method and path | Purpose | Authorization / notes |
|---|---|---|
| `POST /fare-quotes` | Obtain versioned fare/coverage estimate | Authenticated; quote is not an assignment |
| `POST /bookings` | Create and begin dispatch for a service request | Self/requester; idempotency required |
| `GET /bookings` | List caller's booking projections | Requester; filters + cursor |
| `GET /bookings/:bookingId` | Booking detail appropriate to caller relationship | Requester or explicitly involved actor |
| `GET /bookings/:bookingId/timeline` | Durable ordered booking/trip transitions | Involved actor; source of truth after socket gaps |
| `GET /bookings/:bookingId/assignment` | Selected provider/facility/crew/ambulance projection | Requester after assignment; data minimization |
| `POST /bookings/:bookingId/cancellation` | Request allowed cancellation | Requester or authorized operator; reason + idempotency |
| `GET /trips` | List caller's completed/active trip projections | Self/requester |
| `GET /trips/:tripId` | Read one involved trip projection | Involved actor |
| `GET /trips/:tripId/receipt` | Read server-derived fare/cash/payment receipt | Requester; only valid lifecycle states |
| `POST /trips/:tripId/ratings` | Submit one post-completion rating | Requester; idempotency/natural uniqueness |
| `POST /safety-incidents` | Create SOS/safety incident, optionally bound to active trip | Self/involved actor; high-priority idempotent command |
| `GET /safety-incidents/:id` | Read safe incident/delivery timeline | Creator/involved authorized actor |
| `POST /support-tickets` | Create support/complaint ticket | Self; idempotent |
| `GET /support-tickets[/:id]` | List/read own tickets | Self |
| `POST /support-tickets/:id/messages` | Add message/attachment reference | Ticket participant |
| `GET /notifications` | Cursor-paged inbox | Self |
| `POST /notifications/:id/read-receipt` | Mark one notification read | Self; naturally idempotent |
| `POST /notification-read-receipts` | Mark an allowlisted set/all-before timestamp read | Self; bounded request |

Booking request fields include service category, validated pickup/destination, patient/contact
details, assistance notes, cash as the initial payment method, accepted quote/version when required,
and consent flags. The requester ID and initial status are server-derived. Responses use canonical
booking states from the lifecycle document, not current mobile lowercase states.

### 5.4 Tenant/provider operations

Every route below requires `X-Tenant-Id`; facility narrowing never expands the assignment.

| Method and path | Required permission (representative) | Purpose |
|---|---|---|
| `GET /tenant/context` | active assignment | Selected organization/facilities and effective profile version |
| `GET/PATCH /tenant/organization` | `provider.read` / `facility.manage` as policy permits | Provider projection and editable attributes |
| `GET/POST/PATCH /tenant/facilities[/:id]` | `facility.read` / `facility.manage` | Manage approved tenant facilities; lifecycle uses commands |
| `GET /tenant/dashboard` | projection-specific read permissions | Bounded operational KPIs, never raw unrestricted data |
| `GET /tenant/drivers[/:id]` | `driver.read` | Scoped workforce directory/detail |
| `POST /tenant/driver-applications/:id/information-requests` | `driver.verify` | Request additional evidence with reason |
| `POST /tenant/driver-applications/:id/approvals` | `driver.verify` | Approve eligible affiliation under segregation policy |
| `POST /tenant/driver-applications/:id/rejections` | `driver.verify` | Reject with stable reason and review evidence |
| `POST /tenant/drivers/:id/account-status-changes` | `driver.suspend` or `driver.manage` | Controlled activate/suspend/deactivate command |
| `POST /tenant/drivers/:id/duty-status-changes` | `driver.manage` or self policy | Controlled duty change; active-trip invariant enforced |
| `GET/POST/PATCH /tenant/ambulances[/:id]` | `ambulance.read` / `ambulance.manage` | Fleet CRUD for ordinary fields; `If-Match` |
| `POST /tenant/ambulances/:id/operational-status-changes` | `ambulance.status.change` | Controlled state command with reason |
| `GET/POST /tenant/ambulances/:id/maintenance-records` | `maintenance.read/manage` | Maintenance history and scheduling |
| `GET /tenant/documents` | `document.metadata.read` | Scoped metadata/compliance queue |
| `GET /tenant/documents/:id/content-grant` | `document.content.read` | Audited short-lived private download grant |
| `POST /tenant/documents/:id/reviews` | `document.review` | Append review decision; no status PATCH |
| `GET /tenant/dispatch-offers[/:id]` | `dispatch.offer.read` | Facility-scoped pending/history offers |
| `POST /tenant/dispatch-offers/:id/acceptance` | `dispatch.respond` | Atomically accept with eligible facility/driver/ambulance |
| `POST /tenant/dispatch-offers/:id/decline` | `dispatch.respond` | Decline with structured reason |
| `GET /tenant/bookings[/:id]` | `booking.read` | Minimum tenant projection for offered/assigned work |
| `GET /tenant/trips[/:id]` | `trip.read` | Active/history trip projection |
| `POST /tenant/trips/:id/preparation` | `trip.transition` | `ASSIGNED → PREPARING_TO_DEPART` |
| `POST /tenant/trips/:id/departure-to-pickup` | `trip.transition` | Start travel to pickup |
| `POST /tenant/trips/:id/arrival-at-pickup` | `trip.transition` | Confirm pickup arrival |
| `POST /tenant/trips/:id/patient-boarding` | `trip.transition` | Confirm patient on board |
| `POST /tenant/trips/:id/departure-to-destination` | `trip.transition` | Start destination leg |
| `POST /tenant/trips/:id/arrival-at-destination` | `trip.transition` | Confirm destination arrival |
| `POST /tenant/trips/:id/completion` | `trip.transition` | Complete, release resources, create financial work |
| `POST /tenant/trips/:id/cancellation` | `trip.cancel` | Policy-controlled cancellation; elevated after boarding |
| `POST /tenant/trips/:id/location-point-batches` | `tracking.publish` + assigned relationship | HTTP fallback for bounded telemetry batches |
| `GET /tenant/safety-incidents[/:id]` | `safety.incident.read` | Scoped emergency queue/detail |
| `POST /tenant/safety-incidents/:id/acknowledgements` | `safety.incident.manage` | Acknowledge responsibility for an open incident |
| `POST /tenant/safety-incidents/:id/escalations` | `safety.incident.manage` | Escalate to an allowed tier with reason |
| `POST /tenant/safety-incidents/:id/resolution` | `safety.incident.manage` | Resolve with outcome/evidence under policy |
| `POST /tenant/trips/:id/cash-collection-records` | `cash.record` | Record/reconcile cash; does not synthesize provider payment |

Trip command bodies contain command-specific evidence, `expectedVersion`, optional safe location,
and reason where required. They never contain a target arbitrary status, tenant, driver owner, or
audit actor.

### 5.5 Tenant access administration

| Method and path | Permission / invariant |
|---|---|
| `GET /access/permissions` | Authenticated catalog filtered to delegable permissions |
| `GET/POST /tenant/access/roles` | `access.role.read/manage`; tenant role cannot exceed delegator |
| `GET/PATCH /tenant/access/roles/:id` | Versioned metadata/permission update, `If-Match`, audited |
| `POST /tenant/access/roles/:id/retirement` | Retire rather than hard-delete an in-use role |
| `GET/POST /tenant/access/role-profiles` | Read/create role composition and scope ceiling |
| `GET/PATCH /tenant/access/role-profiles/:id` | Versioned update; active assignment impact preview required |
| `POST /tenant/access/role-profiles/:id/retirement` | Prevent new use and migrate/revoke assignments |
| `GET/POST /tenant/access/assignments` | Read/grant user profile in allowed tenant/facilities/validity |
| `GET /tenant/access/assignments/:id` | Scoped assignment detail |
| `POST /tenant/access/assignments/:id/revocation` | Immediate revocation and session/socket invalidation |
| `POST /tenant/invitations` | Invite user to a pre-approved profile/scope; one-time expiry |

Permission records are seeded/migration-controlled, not created through ordinary production APIs.
Role/profile/assignment changes require idempotency, recent MFA at the configured risk level, and an
audit reason.

### 5.6 Province and platform authority

Every `/authority/*` request resolves `X-Authority-Grant-Id`. A grant controls geography, resource,
action, purpose, PII/content, export, and intervention; a broad role name is insufficient.

| Method and path | Purpose / additional control |
|---|---|
| `GET /authority/context` | Resolved grant summary, expiry, geography, allowed resource/action classes |
| `GET /authority/provider-applications[/:id]` | Province/platform review queue and projection |
| `POST /authority/provider-applications/:id/information-requests` | Request missing evidence; reason required |
| `POST /authority/provider-applications/:id/recommendations` | Province recommendation; segregation of duties |
| `POST /authority/provider-applications/:id/rejections` | Authorized rejection; step-up and reason |
| `POST /authority/provider-applications/:id/approvals` | Final approved authority only; creates tenant atomically |
| `POST /authority/providers/:id/suspensions` | High-risk operating suspension; step-up/dual approval policy |
| `POST /authority/providers/:id/reinstatements` | Controlled reinstatement after evidence |
| `GET /authority/facilities` | Grant/geography-scoped directory and compliance projection |
| `GET /authority/ambulances` | Grant-scoped fleet/compliance view; no unrestricted live feed |
| `GET /authority/drivers` | Grant-scoped workforce/compliance view |
| `GET /authority/documents` | Metadata review queue only if grant permits |
| `GET /authority/documents/:id/content-grant` | Restricted content grant, step-up and download audit |
| `POST /authority/documents/:id/reviews` | Grant-scoped review decision with reason |
| `GET /authority/bookings` | Province/platform operational projection, purpose-filtered |
| `GET /authority/trips` | Grant-scoped monitoring/history projection |
| `POST /authority/trips/:id/interventions` | Exceptional dispatch intervention; step-up, reason, incident/ticket |
| `GET /authority/safety-incidents` | Emergency projection for authorized operations staff |
| `GET /authority/support-tickets` | Scoped support/escalation queue |
| `POST /authority/support-tickets/:id/assignment` | Assign/escalate under grant and role policy |
| `GET /authority/audit-events` | Purpose- and field-filtered immutable audit projection |
| `POST /authority/report-exports` | Asynchronous scoped export with filters frozen at request time |
| `GET /authority/report-exports/:id` | Export state; completed download grant is short-lived/audited |
| `POST /authority/grants` | Issue grant only within issuer delegation ceiling and approval policy |
| `GET /authority/grants[/:id]` | Read grants the actor may administer/audit |
| `POST /authority/grants/:id/revocation` | Immediate revocation and cache/socket invalidation |
| `GET/POST/PATCH /authority/access/system-role-profiles[/:id]` | Platform security administration only; step-up/dual control |

Dashboards are projections composed from these scopes. There is no `GET /admin/all-data`, hidden
super-admin bypass, or query parameter that disables tenant filtering.

### 5.7 Optional DVR/telematics contract

Only after real-device and security approval, the target may expose provider-neutral routes such as:

- `GET /tenant/ambulances/:id/telematics`;
- `GET /tenant/ambulances/:id/device-health`;
- `GET /tenant/ambulances/:id/alarms`;
- `POST /tenant/ambulances/:id/live-video-sessions` and session termination;
- `GET /tenant/ambulances/:id/recordings`;
- `POST /tenant/ambulances/:id/playback-sessions`.

Clients never submit arbitrary vendor base URLs or unscoped terminal IDs. Video session responses
contain short-lived platform-mediated data, not DVR credentials. This contract is excluded from the
core cutover until approval gate A-11 passes.

## 6. Projection and privacy rules

The same aggregate has audience-specific DTOs; controllers do not serialize TypeORM entities.

| Audience | Booking/trip projection |
|---|---|
| Requester | Own patient details, route, selected provider/crew contact at allowed state, fare, timeline |
| Offered tenant | Minimum pickup/category/urgency/distance data needed to respond; patient identity masked until policy permits |
| Assigned crew/facility | Operational patient/contact/route data needed for active assignment |
| Province authority | Geography and operational/compliance projection; PII masked unless grant/purpose allows |
| Platform support/security | Case/grant-specific fields only; content access separately permissioned and audited |
| Reports | Aggregated/de-identified by default; row-level export requires explicit permission/grant |

Omitted fields are not represented as misleading `null` values. DTO names and Postman examples
must make the audience explicit (`RequesterBookingDetail`, `TenantDispatchOfferDetail`, and so on).

## 7. Realtime contract

### 7.1 Connection and authorization

- Proposed transport is a NestJS Socket.IO-compatible gateway at `/realtime`, horizontally scaled
  with the Redis adapter. Final transport is an implementation ADR, but the semantics below hold.
- The access token is supplied in the protected handshake authentication field, never a URL.
- The gateway resolves session and selected tenant/authority context exactly as HTTP does.
- Token expiry requires reauthentication; session/assignment/grant revocation disconnects affected
  sockets and removes subscriptions promptly.
- A client subscribes to a resource (`booking`, `trip`, tenant dispatch queue, notification inbox),
  not a client-chosen room name. Authorization runs on every subscription.
- Lifecycle mutations use HTTP named commands. The socket is not an alternate generic status API.

### 7.2 Server event envelope

```json
{
  "eventId": "01J...",
  "type": "trip.updated.v1",
  "occurredAt": "2026-11-03T10:20:30.000Z",
  "sequence": 12,
  "resource": {
    "type": "trip",
    "id": "opaque-id",
    "version": 8
  },
  "correlationId": "01J...",
  "data": {}
}
```

Events are audience-specific projections and may be delivered more than once. `sequence` is scoped
to the subscription/resource and detects gaps; it is not a global order. On reconnect or a gap, the
client refetches the HTTP resource/timeline. The realtime channel is not a durable event log.

Initial event types:

| Event | Audience |
|---|---|
| `booking.updated.v1` | Requester and explicitly involved operators |
| `dispatch.offer.created.v1` / `dispatch.offer.updated.v1` | Eligible tenant/facility dispatchers |
| `trip.updated.v1` | Requester, assigned crew/facility, authorized monitors |
| `tracking.position.updated.v1` | Active-trip requester/crew and grant-authorized monitor |
| `safety.incident.updated.v1` | Creator/responders/authorized emergency operators |
| `notification.created.v1` | Notification owner |
| `document.review.updated.v1` | Subject/applicant and authorized review queue |
| `access.context.invalidated.v1` | Affected principal; forces context refresh/disconnect as needed |

### 7.3 Tracking ingress

Assigned crew may publish bounded `tracking.location-points.v1` batches over the authenticated
socket, with the HTTP batch endpoint as a fallback. Each point contains a client-generated point ID,
capture time, sequence, coordinate, accuracy, heading/speed when available, and declared device
quality. It does not carry authoritative tenant, driver, assignment, or patient identity.

The server validates active assignment/trip, sequence, replay, timestamp skew, coordinate range,
accuracy, and rate before acknowledging accepted/rejected point IDs. An acknowledgement means
accepted for the telemetry pipeline, not durably visible forever. Tracking quality ages to stale or
unavailable; no last point is presented as live without its age.

## 8. Rate limits and abuse controls

Limits are distributed through Redis and identified by the narrowest safe combination of IP,
principal, session/device, tenant, route, and normalized destination. Exact values are environment
configuration validated by load/security tests.

Stricter policies apply to OTP/password/MFA, token refresh, booking creation, offer acceptance, SOS,
document grants/downloads, exports, access administration, provider callbacks, and tracking. A
rate-limit response includes `Retry-After`; it never confirms account existence. Safety routes use
an emergency-specific abuse policy rather than sharing a generic low application limit.

## 9. Contract artifacts and change policy

After approval and during implementation, each route requires:

1. versioned TypeScript request, response, error-code, and projection types;
2. validation tests plus authorization and RLS tests;
3. a Postman request with success, denial, validation, stale-version, and idempotent-retry examples;
4. a Newman acceptance test for critical workflows;
5. a Markdown contract entry and migration note for a breaking change.

No Swagger decorators or generated OpenAPI document are introduced. Postman examples cannot be the
only executable contract: DTO/validation and consumer contract tests remain authoritative.

Within `/api/v1`, changes may add optional response fields and new error codes but cannot reinterpret
existing fields, expose a broader projection, or add required request fields without a compatibility
window. Enum additions are treated as compatibility-sensitive because mobile clients may exhaustively
switch on them. Breaking changes require `/api/v2` or a deliberately negotiated media version,
parallel support, telemetry proving client migration, and an announced retirement date.

## 10. Legacy client mapping

| Current behavior | Target contract |
|---|---|
| Supabase auth/session | Target OTP/session/refresh endpoints; users reauthenticate at cutover |
| Direct table CRUD | Purpose-specific HTTP routes above |
| `accept_booking` RPC | Tenant offer acceptance command with row lock, idempotency, outbox, and assignment constraints |
| Poll all pending bookings | Authorized tenant dispatch offer list + realtime offer events |
| Poll `trip_locations` | Authorized tracking realtime + bounded HTTP timeline/current position |
| Mobile `BookingDto.finalFare: number` | Minor-unit money DTO; explicit client adapter during migration |
| Lowercase mobile statuses | Canonical uppercase states with a versioned UI mapping |
| Portal hard-coded roles | `/me/access-contexts` plus server authorization; UI hints never decide access |
| Browser local-storage Go JWT | In-memory access token + secure rotating refresh cookie |
| Province in-memory APIs | `/authority/*` under a live geography/action grant |
| Hospital local dispatch mutations | `/tenant/*` command endpoints |
| DVR808 passthrough | Optional provider-neutral telematics/video resources after pilot |

The pre-existing `docs/future-api-contracts.md` and `src/services/api/contracts.ts` remain discovery
evidence. They must be superseded deliberately during implementation; their Supabase token,
floating-point fare, and overloaded booking DTO are not the target contract.
