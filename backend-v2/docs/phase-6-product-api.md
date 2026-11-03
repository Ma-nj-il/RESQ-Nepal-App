# Implemented product HTTP contract

## Dispatch pagination used by mobile

Requester, tenant and authority booking/trip list routes accept an optional UUID `afterId` query.
They return at most 50 records in ascending ID order, with `nextCursor` set to the last returned ID
only when a further RLS-visible record exists. Submit it as the next `afterId`. This replaces the
previous unbounded booking/trip response. Reads re-evaluate scope on every page; pagination is not a
snapshot across concurrent writes. Product lists below retain `nextAfterId`. Timeline remains a
per-booking response with `nextCursor: null`.

## Product routes

All routes start with `/api/v1`. Use the existing authentication and server-resolved context selectors.
Responses use the standard `{ data, meta }` envelope; failures use `{ error, meta }`. Reads and
successful commands return `Cache-Control: no-store`. Versioned resource responses include an ETag.

## Concurrency and pagination

- Every product POST and preference PUT requires `Idempotency-Key` (16–128 printable ASCII
  characters). A replay returns the original HTTP status and `Idempotency-Replayed: true`.
- Preference replacement, rating, cash collection, support reply, and support transition require
  `If-Match: "<version>"`. Bare decimal versions are also accepted; weak, wildcard, malformed, and
  multiple ETags are rejected. Missing preconditions return 428, invalid values 400, stale values 409.
- Rating/cash preconditions refer to the **trip** version; reply/transition preconditions refer to the
  **ticket** version. First preference replacement uses version `0`; all other versions start at 1.
- Ticket, message, and notification lists accept an optional UUID `afterId`. Results contain at most
  50 items and an explicit `nextAfterId` or null. This is keyset pagination, not a signed cursor or a
  snapshot. Refetch to discover concurrent changes.
- Mark-read uses an idempotent PUT and needs neither an idempotency key nor a version.

## Self routes

| Method | Route                                    | Request / result                                                                               |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/me/notification-preferences`           | Booleans `bookingUpdates`, `tripUpdates`, `supportUpdates`, `marketing`; version defaults to 0 |
| PUT    | `/me/notification-preferences`           | Replace all four booleans; returns updated preferences                                         |
| POST   | `/trips/:tripId/ratings`                 | `{ "score": 1..5 }`; 201; completed trip's requester only                                      |
| GET    | `/trips/:tripId/receipt`                 | Completed fare/provenance, `paymentMethod: CASH`, `collectionStatus`, optional collection ID   |
| POST   | `/support/tickets`                       | `{ "category": "SERVICE\|BILLING\|ACCOUNT\|OTHER", "message": "...", "tripId"?: "uuid" }`; 201 |
| GET    | `/support/tickets`                       | Paginated safe ticket metadata                                                                 |
| GET    | `/support/tickets/:ticketId`             | Safe ticket metadata and version                                                               |
| GET    | `/support/tickets/:ticketId/messages`    | Paginated authorized plaintext messages, author IDs and timestamps                             |
| POST   | `/support/tickets/:ticketId/messages`    | `{ "message": "..." }`; 201 with message ID and new ticket version                             |
| GET    | `/me/notifications`                      | Paginated `SUPPORT_UPDATED` / `CASH_RECORDED` facts and read state                             |
| PUT    | `/me/notifications/:notificationId/read` | `{ id, read: true }`                                                                           |

Support messages must contain non-whitespace text and be at most 4,000 characters. A linked trip must
belong to the requester; tenant/facility ownership is derived from the trip. Ticket creation and
replay return metadata only. Reading plaintext uses the separately authorized, audited messages route.
Self routes reject tenant/authority context. Unknown and unauthorized resource IDs use 404 equivalence.

## Managed support

Tenant support uses `/tenant/support/tickets`; authority support uses `/authority/support/tickets`.
Both offer list, `/:ticketId`, `/:ticketId/messages` GET/POST, and `/:ticketId/transitions` POST.

- Metadata reads require `support.ticket.read`.
- Content reads require the same permission plus AAL2. Authority content reads also require
  `support_ticket` resource scope and `allowsPii`.
- Replies require `support.ticket.manage` plus AAL2; authority replies also require PII permission.
- Transitions require `support.ticket.manage` plus AAL2. Body:
  `{ "action": "START" | "RESOLVE", "resolutionCode"?: "ISSUE_RESOLVED" }`.
  `RESOLVE` requires a stable uppercase code matching `^[A-Z][A-Z0-9_]{2,63}$`.
- `START`: OPEN → IN_PROGRESS. `RESOLVE`: OPEN or IN_PROGRESS → RESOLVED. Resolved tickets are terminal.
- Tenant support is facility-exact and requires a trip-linked ticket. Unbound account tickets require
  an applicable nationwide authority grant without provider inclusion/exclusion filters.

Built-in tenant profiles are not silently broadened; an approved profile must contain the relevant
support permissions. Authority grants retain their existing profile/resource/expiry constraints.

## Cash and reporting

`POST /tenant/trips/:tripId/cash-collections` requires `cash.record`, scoped tenant/facility access,
and AAL2. Body: `{ "amountMinor": "45000" }`. Amounts are integer **strings**, bounded to PostgreSQL
signed bigint, and currency is always NPR. The amount must exactly match the completed fare.
Duplicates return `PRODUCT.ALREADY_RECORDED` (409); wrong amounts return `CASH.AMOUNT_MISMATCH` (422).
Cash records are immutable. Refunds, partial payments, adjustments, wallets, and electronic settlement
are not part of this contract.

`GET /tenant/reports/cash?from=<UTC timestamp>&to=<UTC timestamp>` requires `report.tenant.read`.
The half-open completion window `[from,to)` must be positive and at most 31 days. Per-facility counts
and monetary totals are integer strings: `completedTrips`, `recordedTrips`, `fareMinor`,
`recordedMinor`, `unrecordedMinor`. The response identifies the `TRIP_COMPLETED_AT` cohort and NPR.
Collections recorded later update that cohort's reconciliation; this is not a daily bank-deposit or
cashier-shift ledger. Empty authorized scope returns an empty list, never global totals.

## Transactional events and notifications

Six events cover preference replacement, rating, cash, ticket creation, reply, and transition.
The payload is only `{ resourceId, version }`; protected content and preference values are absent.
For cash/rating facts, `resourceId` is the trip ID. For support it is the ticket ID; for preferences,
the user ID. Consumers must deduplicate `eventId`, honor stream order, and fetch separately authorized
projections. Read-state and content-read audits do not emit product change events.

In-app facts confirm a database commit. Delivery preferences and Kafka publication do not imply
SMS, email, push, or human delivery. The local Newman collection includes preferences/replay and
requester support/ownership checks; managed and cash scenarios are in the gated integration suite.
