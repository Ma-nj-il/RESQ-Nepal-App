# Phase 1 — Kafka events, BullMQ jobs, and integrations

**Status:** Phase 1 architecture baseline. Phase 5 now implements the core-dispatch outbox relay,
BullMQ bridge/processors, and versioned booking/dispatch/trip/safety contracts under
`backend-v2/contracts/events/`; other catalog entries remain proposed until their phase ships.

## 1. Responsibility boundaries

| Mechanism | Carries | Does not carry |
|---|---|---|
| PostgreSQL transaction | Authoritative aggregate state, history, audit, outbox, job intent | Best-effort provider calls |
| Kafka | Durable versioned facts between modules/runtimes; high-volume telemetry on a dedicated path | User commands, delayed timers, arbitrary RPC |
| BullMQ | Delayed, scheduled, retryable, provider-facing, and batch work | Authoritative lifecycle truth or a duplicate domain bus |
| Realtime gateway | Audience-specific live projections | Durable catch-up or internal domain events |
| HTTP | Authenticated commands and queries | Fire-and-forget state changes |

A domain event is an immutable past-tense fact. A job is an instruction that may be retried. A
realtime event is a client projection. They may be caused by the same business transaction but are
not interchangeable and do not share payloads automatically.

## 2. Kafka topology

### 2.1 Proposed topics

| Topic | Key | Contents |
|---|---|---|
| `resq.identity.events.v1` | user ID | Principal/session lifecycle facts |
| `resq.access.events.v1` | user or access-assignment ID | Assignment, profile, and authority invalidation facts |
| `resq.provider.events.v1` | application/provider ID | Provider/facility onboarding and operating status |
| `resq.workforce.events.v1` | driver ID | Driver affiliation, verification, account, and duty facts |
| `resq.fleet.events.v1` | ambulance ID | Ambulance compliance/readiness/maintenance facts |
| `resq.document.events.v1` | document link ID | Upload scan and review lifecycle facts |
| `resq.booking.events.v1` | booking ID | Request/search/terminal booking facts |
| `resq.dispatch.events.v1` | booking ID | Offers, responses, assignment, and release facts |
| `resq.trip.events.v1` | trip ID | Named trip lifecycle facts |
| `resq.safety.events.v1` | incident ID | SOS/escalation/resolution facts |
| `resq.communication.events.v1` | notification/delivery ID | Notification creation and delivery outcomes |
| `resq.support.events.v1` | ticket ID | Support creation, assignment, escalation, resolution |
| `resq.billing.events.v1` | payment/cash-record ID | Cash and future provider-payment facts |
| `resq.telemetry.location.v1` | trip ID | Validated location ingress stream; not produced from outbox |

Dead-letter topics use the original topic plus `.dlt` and stricter ACLs/retention. Production
brokers disable automatic topic creation. Partition count, replication, minimum in-sync replicas,
and retention are capacity/recovery decisions tested before production; the proposed minimum
production replication factor is three where the selected Kafka platform supports it.

Topic version is a broad compatibility boundary. Individual event type versions remain explicit so
one type can evolve without rotating every topic.

### 2.2 Domain-event envelope

```json
{
  "eventId": "01J...",
  "eventType": "dispatch.offer.accepted.v1",
  "schemaVersion": 1,
  "occurredAt": "2026-11-03T10:20:30.000Z",
  "producer": "dispatch",
  "aggregate": {
    "type": "dispatchOffer",
    "id": "opaque-id",
    "version": 3
  },
  "stream": {
    "type": "bookingDispatch",
    "id": "opaque-booking-id",
    "sequence": 7
  },
  "tenantId": "opaque-tenant-id",
  "facilityId": "opaque-facility-id",
  "correlationId": "01J...",
  "causationId": "01J...",
  "traceparent": "00-...",
  "actor": {
    "type": "USER",
    "id": "opaque-user-id"
  },
  "data": {}
}
```

Rules:

- `eventId` is globally unique and is the outbox/inbox deduplication identity.
- `aggregate.version` increases monotonically for that aggregate. `stream.sequence` increases
  monotonically for the topic's ordering root, including when one transaction emits facts for
  booking, offer, and assignment aggregates under the same booking stream.
- The Kafka message key is `stream.id`, matching the ordering root shown in the topic table.
  Consumers reject duplicates and detect sequence/version gaps; they never use Kafka offset as a
  business version. Headers repeat only routing, tracing, event ID/type, and content-schema metadata;
  the payload remains canonical.
- `tenantId` is mandatory for tenant-owned aggregates. It can be absent only for a reviewed global,
  principal-owned, or pre-tenant platform workflow event.
- `facilityId` is present only when the fact is facility-scoped.
- `correlationId` follows the initiating workflow. `causationId` is the command/event/job that
  directly caused this event, preventing untraceable event chains.
- `actor` is a stable identifier/type, never a copied name, phone, token, role label, or permission
  list. Workload and system-policy actors are explicit.
- Event `data` contains the minimum immutable fact. Restricted documents, patient details, precise
  locations, provider credentials, presigned URLs, OTPs, and access/refresh tokens are forbidden.
- Consumers build only projections they are authorized to own. An event's presence does not grant a
  user access to its aggregate.

Telemetry uses a separately reviewed compact envelope with point ID, trip/device binding reference,
capture/receive time, sequence, coordinate, accuracy, and quality. Its ACL, encryption, retention,
and consumer set are more restrictive than ordinary operational events.

## 3. Transactional outbox and consumer inbox

### 3.1 Producer transaction

Each command that changes state performs one PostgreSQL transaction:

1. resolve/lock the scoped aggregate and validate its version/state;
2. write the aggregate and immutable transition/history records;
3. append required audit evidence;
4. insert one row per domain event into `outbox_events` with the final event envelope;
5. insert any durable `job_intents` required by the command;
6. commit.

No handler publishes Kafka or enqueues Redis work before claiming that the database transaction has
committed. Conversely, a committed state change cannot depend on an in-process goroutine to publish
its fact.

### 3.2 Outbox relay

- Relay replicas claim committed rows with bounded batches and `FOR UPDATE SKIP LOCKED`.
- A row is eligible only when no earlier unpublished `stream.sequence` for the same ordering root
  exists. A transaction emitting multiple ordered facts allocates distinct stream positions.
- Kafka uses idempotent producers, `acks=all`, bounded delivery timeout, TLS authentication, and the
  aggregate ordering key.
- The relay records publish attempts and broker metadata. If Kafka accepts a message but the relay
  crashes before marking it published, it publishes again after restart. Consumers must deduplicate.
- Poison serialization/schema errors are non-retryable and page operators; infrastructure failures
  back off with jitter. Domain state remains committed while outbox age is visible as degraded.
- Published rows are retained long enough for investigation, then archived/purged under the
  approved retention policy. They are not a permanent event-sourced aggregate store.

The platform promises at-least-once delivery, not exactly-once business effects.

### 3.3 Consumer inbox

For a database-mutating consumer, one local transaction:

1. inserts `(consumerName, eventId)` in `inbox_messages` or finds the prior result;
2. validates event schema, ownership shape, stream sequence, and aggregate version;
3. applies the idempotent projection/policy effect;
4. writes resulting outbox events and/or `job_intents`;
5. records inbox completion and commits;
6. acknowledges Kafka only after commit.

A duplicate returns the stored completion without applying the effect. A version gap is retried or
reconciled from the authoritative module; it is never silently applied out of order. Consumer code
does not make a provider call inside this database transaction.

### 3.4 PostgreSQL-to-BullMQ bridge

Because PostgreSQL and Redis cannot commit atomically, queue intent is durable in PostgreSQL:

- commands/consumers write a versioned `job_intents` row in their transaction;
- worker relay logic adds a BullMQ job with a deterministic `jobId` based on the intent ID;
- successful enqueue records broker metadata, but a crash may repeat `queue.add`; stable job IDs and
  idempotent processors make that safe;
- a reconciler continuously finds unqueued/stale intents and missing terminal outcomes;
- the job processor re-reads current authoritative state before acting, so an obsolete delayed job
  becomes a safe no-op.

BullMQ's Redis state improves execution; it is not the only record that required work exists.

## 4. Event schema governance

Versioned JSON Schemas and canonical examples live with the future backend under
`contracts/events/<domain>/<event-type>/vN/`. This is not Swagger/OpenAPI.

CI must verify:

- envelope and payload schema validation;
- backward compatibility for the same event major version;
- producer examples against schemas and consumer fixtures;
- required ownership, aggregate, correlation, and redaction fields;
- no forbidden high-risk field names/content in fixtures;
- every production consumer declares supported event versions and a DLT/replay owner.

Adding an optional field is permitted when consumers tolerate it. Renaming/removing fields,
changing meaning/type, or narrowing prior valid values requires a new event type version. During
migration, a producer may dual-publish v1/v2 from one outbox transaction for a bounded window.
Consumers must migrate before v1 retirement. Unknown event types/versions are never treated as a
known fact.

## 5. Core domain-event catalog

The table describes initial facts and intended reactions. Reactions create local projections or
durable job intents; they do not mutate another module's tables directly. Any offer/assignment,
trip/resource-release, or provider-approval invariant described as atomic in the lifecycle document
is already committed before its event is published; a consumer is never the missing half of that
transaction.

### 5.1 Identity and access

| Event type | Producer | Intended consumers/effects |
|---|---|---|
| `identity.user.registered.v1` | Identity | Create default self profile/preferences and welcome-notification intent |
| `identity.user.deactivated.v1` | Identity | Revoke access projections, devices, and active subscriptions; start approved erasure workflow |
| `identity.session.revoked.v1` | Identity | Realtime disconnect/revocation cache invalidation |
| `identity.session-family-compromised.v1` | Identity | Security alert/audit projection and user notification |
| `access.assignment.granted.v1` | Access Control | Invalidate effective-access cache and refresh user contexts |
| `access.assignment.revoked.v1` | Access Control | Invalidate cache, disconnect unauthorized sockets, revoke affected sessions if policy requires |
| `access.role-profile.changed.v1` | Access Control | Invalidate assignments referencing the version; force context re-resolution |
| `access.authority-grant.issued.v1` | Access Control | Update authority context projection and expiry work |
| `access.authority-grant.revoked.v1` | Access Control | Immediate cache/socket invalidation and security notification |

Permission checks still read current server-side policy. An access event is an invalidation signal,
not a portable authorization token.

### 5.2 Provider, workforce, fleet, and documents

| Event type | Producer | Intended consumers/effects |
|---|---|---|
| `provider.application.submitted.v1` | Provider Registry | Province review queue and reviewer notification |
| `provider.application.information-requested.v1` | Provider Registry | Applicant notification and deadline work |
| `provider.application.recommended.v1` | Provider Registry | Platform review queue |
| `provider.application.approved.v1` | Provider Registry | Tenant/facility read projections and onboarding notifications; creation already committed |
| `provider.application.rejected.v1` | Provider Registry | Applicant notification; no tenant creation |
| `provider.operating-status.changed.v1` | Provider Registry | Dispatch eligibility/cache update and active-work risk review |
| `workforce.driver-affiliation.changed.v1` | Workforce | Facility workforce/access projections |
| `workforce.driver-verification.changed.v1` | Workforce | Dispatch eligibility update and subject notification |
| `workforce.driver-account-status.changed.v1` | Workforce | Eligibility update, session/access review when suspended |
| `workforce.driver-duty-status.changed.v1` | Workforce | Dispatch availability projection |
| `fleet.ambulance-registered.v1` | Fleet | Compliance/readiness projection |
| `fleet.ambulance-operational-status.changed.v1` | Fleet | Dispatch eligibility and portal realtime projection |
| `fleet.ambulance-readiness.changed.v1` | Fleet | Dispatch availability; reason references document/maintenance facts |
| `fleet.maintenance-due.v1` | Fleet | Reminder jobs and readiness policy evaluation |
| `document.object-ready.v1` | Documents | Permit a pending application to validate completeness |
| `document.object-quarantined.v1` | Documents | Security/compliance alert; block review/download |
| `document.review-recorded.v1` | Documents | Subject application/readiness recalculation and notification |
| `document.expired.v1` | Documents | Driver/ambulance/provider readiness recalculation |

### 5.3 Booking, dispatch, and trip

| Event type | Producer | Intended consumers/effects |
|---|---|---|
| `booking.requested.v1` | Dispatch | Dispatch policy starts eligible-provider search and requester projection |
| `booking.search-started.v1` | Dispatch | Requester realtime update and search-deadline intent |
| `booking.cancelled.v1` | Dispatch/Trips | Refresh offer/resource projections and notify actors; cancellation effects already committed |
| `booking.unfulfilled.v1` | Dispatch | Requester notification, operations metric/escalation by policy |
| `booking.completed.v1` | Trips | Requester/reporting projection after the trip and booking complete atomically |
| `dispatch.offer.created.v1` | Dispatch | Tenant offer projection, expiry intent, realtime notification |
| `dispatch.offer.accepted.v1` | Dispatch | Remove competing live-offer projections; accepted/superseded/assignment state already committed |
| `dispatch.offer.declined.v1` | Dispatch | Continue search and record reason metric |
| `dispatch.offer.expired.v1` | Dispatch | Remove live offer projection and continue/finish search |
| `dispatch.offer.superseded.v1` | Dispatch | Remove competing offer from active queues |
| `dispatch.assignment.created.v1` | Dispatch | Trip/requester projection, crew notification, tracking authorization |
| `dispatch.assignment.released.v1` | Dispatch/Trips | Fleet/workforce availability policy evaluation |
| `trip.preparation-started.v1` | Trips | Timeline/realtime projections |
| `trip.departed-to-pickup.v1` | Trips | Timeline, requester ETA refresh work |
| `trip.arrived-at-pickup.v1` | Trips | Timeline and patient notification |
| `trip.patient-boarded.v1` | Trips | Safety/tracking policy and destination-leg projection |
| `trip.departed-to-destination.v1` | Trips | Timeline and ETA refresh work |
| `trip.arrived-at-destination.v1` | Trips | Completion prompt/projection |
| `trip.completed.v1` | Trips | Refresh released-resource projections, receipt/cash work, rating eligibility, reporting |
| `trip.cancelled.v1` | Trips | Refresh released-resource/cancellation projection and safety/support review as policy dictates |

Offer expiry jobs improve timeliness, but acceptance compares the database deadline in the locking
transaction. A late job cannot expire an accepted offer; an absent job cannot make an expired offer
acceptable.

### 5.4 Safety, communication, support, and billing

| Event type | Producer | Intended consumers/effects |
|---|---|---|
| `safety.incident.created.v1` | Safety | High-priority response projection and approved channel delivery intents |
| `safety.incident.acknowledged.v1` | Safety | Creator/operations timeline update |
| `safety.incident.escalated.v1` | Safety | Next escalation tier and notification intents |
| `safety.incident.resolved.v1` | Safety | Close active escalation and reporting projection |
| `communication.notification.created.v1` | Communications | User inbox realtime event and channel-specific jobs |
| `communication.delivery.succeeded.v1` | Communications | Delivery timeline/metrics; provider reference is sanitized |
| `communication.delivery.failed.v1` | Communications | Retry/escalation policy and safe user/operations state |
| `support.ticket.created.v1` | Support | Queue projection and acknowledgement notification |
| `support.ticket.escalated.v1` | Support | Province/platform queue according to explicit scope/grant |
| `support.ticket.resolved.v1` | Support | Requester notification and service metric |
| `billing.cash-collection.recorded.v1` | Billing | Receipt/reconciliation projection |
| `billing.cash-collection.reconciled.v1` | Billing | Finance/reporting projection |
| `billing.payment.succeeded.v1` | Billing (future) | Receipt/ledger projection only after verified callback/reconciliation |
| `billing.payment.failed.v1` | Billing (future) | Safe retry/user state; never changes a completed trip back in time |

## 6. BullMQ design

### 6.1 Queue separation

| Queue | Work | Isolation reason |
|---|---|---|
| `safety-critical` | SOS channel delivery, escalation timer, responder reminders | Cannot wait behind bulk notification/report work |
| `dispatch-critical` | Offer expiry, search deadline, bounded rematch/ETA refresh | Independent latency and concurrency controls |
| `communications` | Push, SMS, and email delivery | Provider-specific rate limits/retries |
| `documents` | Malware scan, type/hash verification, approved extraction, cleanup | CPU/provider-heavy and restricted data |
| `compliance` | Expiry evaluation/reminders, readiness recalculation | Scheduled policy work |
| `billing` | Cash reconciliation and future payment verification/refunds | Financial idempotency and restricted operators |
| `reports` | Authorized export generation and expiry cleanup | Memory/CPU-heavy; lower priority |
| `integrations` | Webhook processing, DVR/map/provider reconciliation | Provider isolation/bulkheads |
| `maintenance` | Retention, partition/archive, idempotency/OTP cleanup, consistency scans | Operational work cannot starve product queues |

Separate queues are not separate domain services. Worker deployments can subscribe to different
queue sets and scale independently.

### 6.2 Job envelope

```json
{
  "jobIntentId": "01J...",
  "jobType": "dispatch.expire-offer.v1",
  "tenantId": "opaque-tenant-id",
  "resource": { "type": "dispatchOffer", "id": "opaque-id", "version": 1 },
  "runAt": "2026-11-03T10:21:00.000Z",
  "correlationId": "01J...",
  "causationId": "01J...",
  "traceparent": "00-...",
  "requestedBy": { "type": "SYSTEM_POLICY", "id": "dispatch-policy-v1" }
}
```

The job carries references and policy versions, not credentials, raw documents, patient narratives,
or stale permission lists. The processor establishes a fresh workload/request context, re-reads the
resource, validates current state and authority, obtains secrets from the adapter, and records a
safe result.

### 6.3 Initial job catalog

| Job type | Trigger | Idempotent completion rule |
|---|---|---|
| `dispatch.expire-offer.v1` | Offer creation/deadline | Conditional update only if `PENDING` and database time is past deadline |
| `dispatch.finish-search.v1` | Booking search deadline | Terminalize only if still searching with no selected assignment |
| `dispatch.refresh-eta.v1` | Selected trip milestone/policy | Store against input/version; obsolete result discarded |
| `safety.deliver-alert.v1` | Incident created/escalated | One delivery-attempt identity per incident/channel/recipient/tier |
| `safety.escalate-unacknowledged.v1` | Incident policy deadline | Escalate only if still open/unacknowledged at required tier |
| `communication.deliver-push.v1` | Notification/channel policy | Unique notification/device/attempt policy; invalidate bad token safely |
| `communication.deliver-sms.v1` | Notification/channel policy | Stable provider idempotency reference where supported |
| `communication.deliver-email.v1` | Notification/channel policy | Stable message identity and delivery-attempt record |
| `document.scan-object.v1` | Upload finalization | Scan one immutable object hash/version; quarantine or mark ready |
| `document.evaluate-expiry.v1` | Scheduled policy scan | One outcome per subject/document/policy date |
| `compliance.recalculate-readiness.v1` | Document/maintenance/provider fact | Compare current versions and write only changed readiness |
| `billing.reconcile-cash.v1` | Cash record/policy window | Reconcile one immutable collection record once |
| `billing.verify-provider-payment.v1` | Future callback/reconciliation | Verify provider state before ledger event; callback alone is not truth |
| `report.generate-export.v1` | Authorized export request | Revalidate grant, freeze query scope, write one immutable encrypted object |
| `report.expire-export.v1` | Export expiry | Revoke/delete object according to legal policy; preserve audit |
| `integration.process-webhook.v1` | Persisted verified receipt | One receipt/provider event ID; effects via module command/outbox |
| `integration.refresh-dvr-device.v1` | Approved pilot schedule/manual request | One tenant/ambulance binding; bounded, sanitized projection |
| `governance.reconcile-job-intents.v1` | Repeatable schedule | Enqueue missing intents by deterministic ID |
| `governance.apply-retention.v1` | Approved schedule | Policy/version/date partition; report counts and holds |

Repeatable jobs are only wake-up signals. The database determines due records so two schedulers or a
missed tick cannot duplicate/lose authoritative work.

### 6.4 Retry, failure, and cancellation policy

- Every processor classifies failures as transient, rate-limited, permanent input/policy,
  authentication/configuration, or unknown.
- Transient failures use bounded exponential backoff with jitter. `Retry-After` is honored.
- Permanent validation, revoked authority, deleted resource, unsupported provider operation, and
  most provider `4xx` responses do not retry automatically.
- Credential/configuration failure opens the circuit, marks the integration degraded, and alerts an
  owner rather than exhausting every job.
- Maximum attempts and delay ceilings are configured per job/provider after provider SLA testing;
  safety/dispatch use escalation/fallback policy, not unlimited retries.
- Exhausted jobs move to a restricted failed state with a safe error code and remain linked to the
  durable job intent. Operator retry creates an audited new attempt; it does not edit history.
- Obsolete delayed work exits successfully as `NO_OP_CURRENT_STATE`.
- Queue pause/drain during deployment stops new claims while active processors finish within their
  lease or become safely retryable.

## 7. External integration ports

All provider SDKs live behind application ports and infrastructure adapters. A domain/application
use case never imports a vendor SDK or parses a vendor response.

| Port | Required behavior | Source candidates / decision status |
|---|---|---|
| Routing/geocoding/ETA | Route, distance, duration, geocode, bounded cache, data-quality metadata | Public OSRM is development-only; production provider pending A-08 |
| Push | Device delivery with invalid-token classification | Firebase code exists in Go; credentials/delivery unverified |
| SMS | OTP and transactional message, delivery callback, Nepal reachability | Twilio code exists; provider/legal/cost pending A-09 |
| Email | Transactional/admin mail and safe templates | SMTP code exists; provider pending A-09 |
| Object storage | Private presigned upload/download, hash/metadata, lifecycle, server-side encryption | Supabase/S3 evidence; target provider/residency pending A-09 |
| Malware scanning | Immutable-object scan and quarantine result | No proven provider; required before restricted uploads go live |
| Identity/document verification | Optional OCR/authenticity/background check with consent | Go configuration/stubs only; legal/provider approval pending |
| Payment | Intent/callback/refund/reconciliation without storing card secrets | Cash first; eSewa/Khalti/commercial scope pending A-10 |
| DVR/telematics | Allowlisted device telemetry/video sessions and normalized errors | Hospital proxy/unit evidence only; real device pending A-11 |
| Secrets/KMS | Runtime secret resolution and signing/encryption key operations | Cloud/Vault source adapters exist; deployment platform pending |

An adapter is not production-ready merely because its constructor succeeds. Each provider requires
sandbox/live contract tests, error taxonomy, timeout/rate behavior, key rotation, data-flow/privacy
review, observability, and an owner-run failure drill.

## 8. Resilience with Opossum

Opossum wraps outbound provider operations at the adapter boundary.

- Timeouts are shorter than the enclosing HTTP/job deadline and include connection/request phases.
- Retry occurs in one layer only and only for safe/idempotent operations; the breaker observes final
  attempt outcomes so retries do not multiply across HTTP client, breaker, and BullMQ.
- Breakers are keyed by bounded provider/operation/credential pool, not unbounded user or tenant IDs.
- Bulkhead concurrency, provider quotas, and queue rate limiters prevent one slow dependency from
  consuming all workers.
- Open/half-open/closed transitions emit metrics and structured logs without secrets.
- Fallbacks are explicit business behavior: cached reference data may be labelled stale; a quote may
  fail; a notification may switch to an approved channel; no adapter fabricates route, payment,
  verification, GPS, or delivery success.
- Health probes do not continuously force user traffic through an open circuit. Controlled probes
  and provider status determine recovery.

## 9. Inbound webhooks

Provider callbacks use dedicated routes such as `/api/v1/integrations/:provider/webhooks/:kind`
with provider-specific allowlists; `:provider` is not an arbitrary adapter selector.

1. Preserve the raw body needed for signature verification.
2. Verify TLS, current/previous rotated signing secret, timestamp/replay window, signature, expected
   account/environment, body size, and known event shape before trusting fields.
3. Persist a `webhook_receipt` with provider event ID and payload hash. Duplicate IDs/hashes return
   the prior acknowledgement without repeating work.
4. Return the provider-required success only after durable receipt; queue processing through a job
   intent.
5. Re-query the provider for high-impact payment/identity state where supported. A callback does not
   directly mutate trip, approval, or ledger truth.
6. Quarantine invalid/unknown events with safe metadata; never log full restricted payloads.

Network source allowlists are defense in depth, not a replacement for signatures. Callback secrets,
URLs, and payloads follow the provider's reviewed retention and residency policy.

## 10. NATS-to-Kafka behavioral mapping

The legacy NATS subjects are not mirrored automatically:

| Legacy subject/event | Target fact/path |
|---|---|
| `rides.requested` | `booking.requested.v1` after canonical booking transaction |
| `rides.accepted` | `dispatch.offer.accepted.v1` plus `dispatch.assignment.created.v1` |
| `rides.started` | One named trip milestone based on reconciled evidence; no blind mapping |
| `rides.completed` | `trip.completed.v1` only after target completion invariants |
| `rides.cancelled` | Booking or trip cancellation fact based on lifecycle point |
| `drivers.location.updated` | Validated `resq.telemetry.location.v1`, not an outbox domain event |
| `drivers.online/offline` | Duty/device-presence inputs; not automatically verification/readiness |
| `payments.processed/failed` | Billing facts only after source financial reconciliation |
| `fraud.detected` | Deferred risk capability; preserve as staging evidence, not core event |
| `safety.sos` | `safety.incident.created.v1` through durable incident transaction |

During migration, a bounded bridge may consume verified legacy facts into source-specific staging or
shadow comparison. New domain events are emitted only after idempotent canonical import/command
processing. The target never publishes the same business fact to both NATS and Kafka as two
authoritative paths.

## 11. Observability and operations

Required metrics include:

- outbox oldest-unpublished age, pending count, publish latency/failure, and stream-order blocks;
- Kafka consumer lag by group/partition, handler duration/failure, duplicates, version gaps, DLT
  count, and replay state;
- job-intent oldest-unenqueued age, BullMQ waiting/active/delayed/failed age and count, processor
  duration, retries, no-op obsolete jobs, and reconciliation repairs;
- provider request latency/result/timeout, breaker state, bulkhead saturation, quota/rate response,
  webhook signature failure/age/duplicates, and delivery outcome;
- telemetry ingest rejection reason, lag, per-trip rate anomalies, durable sample lag, and realtime
  fan-out delay.

Logs include event/job/intent ID, type, aggregate reference, tenant where allowed, attempt,
correlation, causation, and trace IDs. Payloads, coordinates, document keys/URLs, tokens, and provider
secrets are redacted. Traces propagate HTTP → transaction/outbox → Kafka → consumer → job intent →
BullMQ → provider while allowing sampling appropriate to restricted workflows.

## 12. Failure semantics

| Failure | Required outcome |
|---|---|
| PostgreSQL commits, Kafka unavailable | Business state succeeds; outbox backlog grows and alerts; relay catches up |
| Kafka publishes, relay marker update fails | Event may repeat; inbox prevents duplicate effect |
| Consumer commits DB, Kafka ack fails | Event repeats; inbox returns prior completion |
| Redis/BullMQ unavailable | Job intent remains durable; API reports accepted state only when truthful; reconciler enqueues later |
| Delayed job runs after state changed | Processor re-reads state and records safe no-op |
| Provider times out after accepting request | Reuse provider/platform idempotency reference and reconcile; never assume failed or successful |
| Consumer receives version gap | Pause/retry/reconcile; do not silently skip or apply stale event |
| DLT grows | Page owning team, stop unsafe dependent automation, inspect/replay with audit |
| Telemetry stream degrades | Lifecycle HTTP remains available; UI marks tracking stale/unavailable |
| Safety channel fails | Record failed attempt, execute approved escalation/fallback, never claim contact delivered |

Provider selections, Kafka retention/capacity, delivery fallback policy, and DVR/payment scope remain
approval decisions in [migration-roadmap-and-approval.md](./migration-roadmap-and-approval.md).
