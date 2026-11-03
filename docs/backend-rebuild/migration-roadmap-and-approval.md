# Migration roadmap and approval gates

- **Current gate:** Phase 0 discovery and Phase 1 architecture are presented for approval.
- **Hard boundary:** do not create `backend-v2/`, install NestJS dependencies, write target
  migrations, provision infrastructure, or replace any legacy path until Gate 1 is explicitly
  approved.

## 1. What approval means

Approval confirms the target boundaries, not a promise that every legacy feature will be rebuilt.
Specifically, approvers accept:

- provider organization as tenant root and facility as its hospital/base;
- explicit province/platform authority grants rather than an admin bypass;
- canonical booking, dispatch offer, assignment, and trip aggregates/lifecycles;
- a modular NestJS platform with independently scalable API, worker, outbox-relay, and migration
  runtime roles;
- PostgreSQL/TypeORM with RLS and scoped repositories, Redis/BullMQ, and Kafka outbox/inbox;
- the custom **Permissions → Roles → Role Profiles → Users** authorization hierarchy;
- short-lived asymmetric access JWTs and opaque rotating refresh-token families;
- the proposed HTTP/realtime/event/job boundaries and no Swagger/OpenAPI runtime;
- a staged strangler migration with reauthentication, reconciliation, and no portal mock-data import;
- deferral of broad speculative legacy features until core emergency workflows are proven.

Approval does not certify provider integrations, migrated data, security, scale, SLOs, or production
readiness. Each later gate requires evidence.

## 2. Proposed delivery scope

### 2.1 First production capability

The first cutover scope is the smallest complete emergency transport workflow:

1. phone/user and administrative authentication, MFA, sessions, and secure token rotation;
2. provider organizations, facilities, Nepal geography, membership, RBAC, and authority grants;
3. provider/facility review, drivers/crew, ambulances, equipment/readiness, private documents/review;
4. service coverage/fare quote, booking, dispatch offers, atomic acceptance, assignment, and
   canonical trip transitions/cancellation;
5. active-trip tracking with freshness, SOS/safety incidents, notification inbox and approved
   delivery channels;
6. cash collection/receipt, rating, basic support, tenant/province/platform operational projections;
7. audit, idempotency, outbox/inbox/job intent, observability, backup/restore, and tested runbooks.

The implementation can release these in internal increments, but a legacy workflow is not cut over
until its complete correctness/security/operations slice passes its gate.

### 2.2 Explicitly deferred

- ride pooling and negotiation;
- promotions, referrals, wallet/top-up, gifts, family accounts, subscriptions, loyalty and
  gamification;
- generalized multi-country pricing and exchange rates;
- ML ETA, demand forecasting, generalized fraud scoring, and advanced analytics;
- chat/voice/video calling beyond approved emergency contact/notification needs;
- card storage, automated provider payouts, and online payments before finance/provider approval;
- generalized background checks, OCR decisions, and biometric/selfie verification before
  legal/provider approval;
- DVR808 live video/playback before a real-device security and operational pilot;
- one-for-one compatibility with every Go route/table or every portal mock report.

Deferred source data is inventoried/archived according to legal policy; “deferred” does not mean
silently deleted.

## 3. Delivery phases and gates

```text
Gate 1: architecture approval
  ↓
Phase 2: foundation
  ↓ Gate 2
Phase 3: identity, tenancy, RBAC, security
  ↓ Gate 3
Phase 4: provider registry, workforce, fleet, documents
  ↓ Gate 4
Phase 5: booking, dispatch, trips, tracking, safety
  ↓ Gate 5
Phase 6: portals, communications, support, cash/reporting, approved integrations
  ↓ Gate 6
Phase 7: migration rehearsals, shadow validation, client readiness
  ↓ Gate 7
Phase 8: controlled cutover and stabilization
  ↓ Gate 8
Legacy retirement (separate approval)
```

### Gate 1 — Phase 0/1 architecture approval (now)

Required:

- all decision items in section 10 are approved or assigned a dated blocker/owner;
- tenant/authority model, lifecycle, first scope, and source precedence are accepted;
- security, operations, migration, API, event, and job invariants have no unresolved critical
  objection;
- accountable approvers in section 11 record approval and amendments.

Passing Gate 1 permits foundation implementation only. It does not permit production migration.

### Phase 2 / Gate 2 — foundation

Deliver after Gate 1:

- isolated `backend-v2/` NestJS/TypeScript workspace and Clean Architecture boundary enforcement;
- API, worker, outbox-relay, and migration entry points;
- locked dependencies and Docker local/CI stack for PostgreSQL/PostGIS, Redis/BullMQ, Kafka, and
  S3-compatible test storage;
- config validation, Pino redaction, OpenTelemetry plumbing, health, request context, error envelope,
  deterministic IDs/clock, and TypeORM transaction abstraction;
- migration framework with `synchronize: false`, baseline governance tables, CI security/build/test
  gates, and initial Postman environment/health collection.

Gate 2 evidence: clean build/lint/typecheck/tests, migration from zero and prior fixture, image scan/
SBOM, dependency failure behavior, architecture tests, no business/legacy route cutover, and reviewed
threat model.

### Phase 3 / Gate 3 — identity, tenancy, RBAC, and security

Deliver:

- OTP/administrative authentication, MFA, asymmetric keys/JWKS, sessions, one-time refresh rotation,
  reuse detection, revocation, and browser/mobile token delivery;
- users, provider tenant/facility/geography foundations, membership;
- permission/role/profile/assignment and authority-grant modules;
- request/worker context, RLS, composite tenant foreign keys, audit/idempotency;
- self/access administration API and Postman/Jest contracts.

Gate 3 evidence: independent security review, full cross-tenant/RLS/delegation/authority negative
suite, refresh race/reuse/key rotation tests, penetration-test remediation, database-role review,
secrets/key rotation drill, and no critical/high unresolved finding.

### Phase 4 / Gate 4 — provider, workforce, fleet, and documents

Deliver:

- provider application/review/approval and organization/facility activation;
- driver affiliation/verification/account/duty dimensions;
- ambulance compliance/operations/GPS dimensions, equipment and maintenance/readiness;
- private upload/finalization/scan/review/download/expiry workflow;
- tenant/province/platform projections and initial administrative client adapters.

Gate 4 evidence: segregation-of-duty decisions, cross-scope review tests, object-policy/malware/
content-download test, expiry/readiness races, provider onboarding acceptance, and approved document
provider/retention controls.

### Phase 5 / Gate 5 — core dispatch and safety

Deliver:

- coverage/quote, booking/search, tenant offers, contention-safe acceptance, assignment;
- every named trip/cancellation command, resource release, timeline, tracking, realtime;
- SOS/safety incident and high-priority communications;
- transactional outbox/inbox, durable job intents, Kafka/BullMQ processors for the core workflow.

Gate 5 evidence: transition/actor matrix, multi-replica acceptance race, idempotency/timeout recovery,
Kafka/Redis/provider outage tests, tracking authorization/load/freshness, SOS escalation drill,
observability/runbooks, performance against approved capacity/SLO, and an operations-led dispatch
simulation.

### Phase 6 / Gate 6 — product surfaces and approved integrations

Deliver only approved scope:

- mobile API adapter and canonical status/money/error/realtime handling;
- hospital, province, and platform portal API adapters with no authorization decisions in UI;
- notification preferences/delivery, basic support/rating/cash receipt/reconciliation;
- operational dashboards/reports/exports with scoped projections;
- approved maps, messaging, storage/scanner, and optional payment/DVR adapters.

Gate 6 evidence: mobile and three-portal persona acceptance, accessibility/offline/error states,
Newman suites, provider sandbox/live canary evidence, browser security review, no direct Supabase/Go
mutation on cutover paths, and user-facing claims that match actual provider state.

### Phase 7 / Gate 7 — migration rehearsal and client readiness

Deliver:

- production-source snapshots/profiles, source-to-canonical mappings, staging transforms, encrypted
  migration ledger, legacy-ID maps, quarantine/reconciliation reports;
- repeated full-volume staging migrations with measured duration/lock/storage/cutover window;
- read-only shadow comparisons and source-of-truth registry by capability/cohort;
- minimum supported mobile release, portal deployments, support/training/communications;
- backup/restore/DR exercise and signed go/no-go/rollback runbook.

Gate 7 evidence includes the zero-tolerance invariants in section 7, accepted exceptions, owner
signoff, and no unresolved critical/high migration/security/operations issue.

### Phase 8 / Gate 8 — cutover and stabilization

Execute the approved sequence in section 8. During stabilization, feature work yields to correctness,
reconciliation, SLO/security monitoring, support, and forward fixes. Legacy is retained read-only or
isolated for the approved rollback/evidence window.

Gate 8/retirement evidence: stable error budget and business reconciliation for the approved period,
no legacy writes/traffic/credentials/event bridge, legal archive complete, rollback window closed,
owners approve decommission, and infrastructure/secrets/data are removed with evidence.

## 4. Source precedence and migration eligibility

No source schema is the target schema. Precedence resolves evidence conflicts as follows:

1. approved canonical invariants and business-owner decisions;
2. validated live production records from the system designated authoritative for that capability;
3. immutable histories/provider records that corroborate state;
4. repository schema/code/documentation as interpretation evidence;
5. local/demo/mock records as workflow evidence only.

| Source | Potentially migratable | Never assumed/migrated without separate proof |
|---|---|---|
| Hosted Supabase | Real principals/profiles, approved facilities/drivers/ambulances, bookings/history/ratings/support/notifications, private object metadata/bytes | Local migrations claimed deployed, demo/AsyncStorage state, client sessions/refresh tokens, malformed RLS-derived assumptions |
| Go PostgreSQL | Real users/drivers/rides/documents/payments only if a live authoritative deployment and ownership are proven | All 125 table names, generated/sample data, destructive migration history, USD defaults, untested derived/materialized state |
| Province portal | None from in-memory/sample database | Users, applications, hospitals, trips, audit IDs, tokens, KPIs |
| Hospital portal | None from React mock state | Staff/fleet/bookings/trips/GPS/video sample records and local audit |
| Hospital DVR provider | Device bindings/history only after account/device ownership and provider export are verified | Unit-test fixtures, terminal allowlists, stream URLs, simulated telemetry |
| Super Admin portal | None from mock context/data | Roles/users/providers/bookings/financial/integration telemetry; local-storage token |
| Mobile device storage | Normally none | Demo sessions, SOS queue, drafts, contacts, starred hospitals, wallet/chat/rating samples unless an explicit consented sync feature ships first |

Repository source remains the discovery authority until live environments are accessed. Once a
signed production snapshot is available, differences are documented; they do not silently rewrite
the approved target model.

## 5. Migration pipeline

### 5.1 Extract and stage

- Inventory actual schema/version/extensions/RLS/functions/row counts/object buckets and deployment
  provenance using read-only credentials.
- Take encrypted, access-logged, point-in-time-consistent source exports and object manifests.
- Load immutable copies into source-specific restricted schemas such as `staging_supabase` and
  `staging_go`; target application roles cannot query them.
- Record source system, export ID/time, table/object, source primary key, row hash, and extraction
  result in a migration ledger.
- Profile nulls, duplicates, invalid IDs/states/dates/coordinates/currency, orphan relationships,
  active work, and PII classification before transforming.

Legacy SQL migrations are not replayed against target production. Staging DDL represents the actual
extract format only.

### 5.2 Transform and map

- Deterministic, rerunnable transforms create canonical records through reviewed bulk repositories/
  SQL that still enforce tenant and referential invariants.
- `legacy_id_maps` link source/system/type/ID to target ID; mappings are unique, immutable after
  cutover, and never exposed to ordinary clients.
- Every row is classified `MIGRATED`, `MERGED`, `SKIPPED_BY_POLICY`, or `QUARANTINED`, with stable
  reason and review outcome. No source row disappears from accounting.
- Re-runs produce the same target IDs/content or explicitly version the transformation.
- Sensitive temporary exports/staging are deleted after reconciliation/hold approval and the deletion
  is evidenced.

### 5.3 Identity

- Do not migrate passwords, JWTs, refresh tokens, OTPs, MFA secrets, recovery codes, mock tokens, or
  browser/local device sessions.
- Normalize/verify phone/email identities and map only with defensible evidence. Same phone/email
  across Supabase and Go is a merge candidate, not automatic proof of one person.
- Collision queue requires data-owner/security review; ambiguous accounts remain separate/blocked
  until the user re-verifies and ownership is resolved.
- New canonical user IDs are mapped to legacy IDs. Users reauthenticate and enroll required admin
  MFA; communications explain this without exposing account existence.

### 5.4 Tenant, facility, workforce, and fleet

- A product/data owner supplies the provider-organization grouping for each real hospital/operator.
  Similar names, registration numbers, or province are matching evidence, not an automatic tenant
  assignment.
- Facilities map to one approved tenant and normalized Nepal geography. Duplicate/unknown legal
  registrations are quarantined.
- Driver/ambulance links require verified facility/tenant ownership and non-overlapping active work.
  Overloaded source status is split into target dimensions using explicit evidence.
- Documents copy only after object existence/hash/owner/purpose is proven and the target scanner
  passes them. Missing/unsafe/ambiguous files require re-upload; approval is not inherited blindly.

### 5.5 Bookings, trips, tracking, and money

- Closed history is migrated before active operations and retains source/status/provenance plus the
  approved canonical mapping.
- Ambiguous `started`/`in_progress`, assignment, cancellation, timestamps, and terminal records enter
  reconciliation; they are not guessed from labels.
- High-frequency locations migrate only if needed by approved retention/legal policy, with correct
  trip/tenant ownership and precision. Expired points are deleted rather than copied.
- Money reconciles in integer minor units by currency. No USD value is relabelled NPR; unknown
  currency/scale is quarantined.
- Wallet/payment/provider records are excluded until finance proves a live ledger and signs exact
  opening balances. Cash trip records can migrate with source evidence; mock balances never do.

## 6. Coexistence and strangler rules

### 6.1 One writer per aggregate/capability

At every moment, a source-of-truth registry names one authoritative writer for each capability and
cohort. Reads may be shadowed/compared; business writes are not sent optimistically to both legacy
and target databases.

Examples:

- target can shadow-evaluate authorization or fare/dispatch eligibility without returning or
  persisting its result;
- legacy facts can feed staging comparison through an idempotent bridge;
- target events can be observed without causing legacy state changes;
- a booking/trip/resource is controlled by exactly one runtime through its full active lifecycle.

No “fallback” reads an out-of-scope legacy row after target authorization denies it. No bridge turns
portal mocks into canonical events.

### 6.2 Mobile direct-Supabase constraint

Old mobile versions write Supabase directly and cannot be safely traffic-routed at an API gateway.
Recommended cutover therefore requires:

1. release and observe a target-API mobile version with upgrade/re-authentication UX;
2. approve/enforce a minimum supported version before authoritative booking cutover;
3. stop new legacy booking writes in a communicated window and verify direct-write policy/key
   disablement;
4. extract/apply/reconcile the final delta;
5. enable target writes and monitor synthetic/real canary workflows;
6. retain only deliberately read-only legacy access needed for history/rollback evidence.

Leaving old direct-write clients active would create split-brain bookings and is a Gate 7 blocker.
If product rejects a minimum-version/maintenance approach, a separately designed, tested legacy
write-capture/compatibility bridge is required before approval; it is not assumed here.

### 6.3 Portal and Go routing

- Portals switch capability-by-capability through deployed API adapters/feature flags after their
  persona tests; UI state never becomes migration truth.
- Explicit ingress routes can keep unmigrated Go capabilities isolated, but target auth/tenant
  tokens are not forwarded to a legacy global endpoint without an anti-corruption authorization
  layer.
- NATS-to-Kafka comparison bridges are temporary, read-only/idempotent, measured, and removable.
  Kafka becomes authoritative only for target transactions created through the outbox.

## 7. Reconciliation acceptance criteria

Every rehearsal and final run produces machine-readable and signed human reports.

### 7.1 Zero-tolerance invariants

- 100% of in-scope source rows/objects are accounted as migrated, merged, skipped by approved
  policy, or quarantined with an owner/reason.
- Zero orphaned target foreign keys, invalid ownership shapes, missing required tenant/facility keys,
  or composite cross-tenant references.
- Zero duplicate accepted offer/selected assignment and zero overlapping active driver/ambulance
  assignment prohibited by policy.
- Zero invalid target lifecycle transition sequence; every ambiguous state has a reviewed outcome.
- Zero unauthorized cross-tenant/grant read in migration and post-load security tests.
- Exact monetary reconciliation by source/currency/minor unit; tolerance is zero for ledger values.
- Every copied restricted object matches manifest hash/size/type, has a valid subject link, passes
  scan, and remains private.
- Every principal has one documented identity outcome; no password/token/MFA secret migrated.
- Outbox/inbox/audit/transition constraints pass and no migration process bypass remains available to
  application roles.

### 7.2 Business comparison

- Counts by source, date, tenant/facility, status mapping, driver, ambulance, and terminal outcome;
- sampled and risk-based record comparison including oldest/newest/high-value/active/ambiguous cases;
- provider/facility/driver/ambulance compliance and readiness reviewed by operations;
- booking/trip duration, cancellation, fare/cash, rating, support, and notification aggregates within
  explained transformation differences;
- portal/mobile projections compared to the canonical API for each approved persona;
- quarantines/exceptions signed by data/product/security/finance owners as applicable.

Aggregate count equality alone cannot approve migration.

## 8. Cutover sequence

### 8.1 Preconditions

- Gates 1–7 passed; go/no-go owner and incident commander named.
- Capacity/SLO, provider, backup/restore/DR, security, penetration, migration, app-store/minimum-version,
  portal, support/training, and communications evidence approved.
- Final source snapshot/delta scripts and target transforms are immutable/checksummed and rehearsed
  within the window.
- Target and legacy aggregate ownership, feature flags, credentials, DNS/ingress, queues/topics,
  dashboards, pages, and rollback/forward-fix runbooks are verified.
- No unexplained active-trip/resource conflict or critical/high issue remains.

### 8.2 Active operation handover

The preferred rule is to drain active legacy work before transferring a resource. If emergency
operations cannot pause until all trips complete:

- stop creating new legacy bookings at the boundary;
- inventory and import each active legacy trip as a protected legacy-controlled reservation so its
  driver/ambulance cannot be assigned by target;
- keep each active aggregate on legacy through completion/cancellation, sync its terminal evidence
  idempotently, then release the corresponding target reservation;
- allow new target work only on resources not controlled by legacy;
- display one authoritative tracking/timeline source per trip and provide operations a combined,
  clearly labelled view;
- never issue lifecycle commands for the same trip in both systems.

This coexistence must be rehearsed. Otherwise, schedule a full drain/maintenance window.

### 8.3 Execution

1. Announce/freeze affected writes and capture exact boundary time/source positions.
2. Complete/mark active-operation ownership as above.
3. Take final consistent delta and object manifest; revoke/disable obsolete direct write paths.
4. Run deterministic transforms and zero-tolerance reconciliation.
5. Reauthenticate canary operators/users and run synthetic end-to-end booking/offer/trip/SOS flows.
6. Enable target writes by the approved cohort/capability plan; keep non-target paths explicit.
7. Monitor SLI/error budget, authorization denials, business funnel, assignments, GPS/SOS, provider
   outcomes, database, outbox/Kafka/job lag, audit, and support reports continuously.
8. Reconcile deltas at short intervals, record each go/hold/rollback decision, and communicate status.
9. Close the write freeze only after the incident commander and product/operations/security/data
   owners accept the evidence.

### 8.4 Rollback semantics

Before target authoritative writes, routing/client rollback is straightforward. After target creates
new bookings/trips/access/audit, blindly pointing clients back to legacy would lose or duplicate
emergency work.

Post-write failure order is therefore:

1. disable the failing optional capability or stop new mutations safely;
2. restore/fail over the target dependency or roll back compatible application code while keeping
   the expanded database;
3. forward-fix data/code using idempotent audited tooling;
4. return a capability to legacy only if a rehearsed target-to-legacy compensation bridge has
   transferred every new authoritative record and active-resource reservation exactly once.

Database restore over post-boundary target writes is a last-resort disaster action requiring
point-in-time/reconciliation and incident authority. Production down migrations are not the default
rollback.

## 9. Legacy retirement

Retirement is separate from cutover:

- prove no application, user, cron, bridge, webhook, DNS route, provider callback, or operator uses
  legacy writes/events;
- export/verify legally required history and migration evidence;
- revoke Supabase client write policies/keys, Go/NATS/provider secrets, portal mock/demo production
  paths, database users, object grants, and infrastructure access;
- make the legacy database/object store immutable for the approved evidence window, then delete or
  archive under retention policy;
- remove compatibility code/flags/topics with a reviewed release;
- record cost/security inventory closure and owner signoff.

Legacy source is never deleted merely to force a migration metric to pass.

## 10. Decisions requiring explicit approval

All are **pending** until an accountable approver records otherwise.

| ID | Decision | Recommendation | If not approved / required owner |
|---|---|---|---|
| A-01 | Tenant root | Provider organization; hospital/base is a facility | Redesign ERD/RLS/API before implementation. Product + security |
| A-02 | Province/platform access | Explicit time/purpose/geography/resource/action authority grants; no global-admin bypass | Security must approve an equally testable scope model |
| A-03 | Deployment boundary | Modular platform first; separate API, worker, outbox-relay, migration roles | Engineering must justify operational/data boundaries for more services |
| A-04 | Source precedence | Canonical target + capability-specific proven live source; no wholesale source copy | Product + data owner must identify alternatives/conflict rules |
| A-05 | Identity migration | Map verified identities cautiously; migrate no credentials/sessions; force reauthentication/MFA | Security + product must approve any account-linking exception |
| A-06 | Dispatch lifecycle | Adopt booking/offer/assignment/trip states and explicit source mappings | Operations + product must supply revised transition/actor matrix |
| A-07 | First scope | Core emergency dispatch/safety/cash first; defer speculative catalog | Product must rank additions and accept schedule/risk impact |
| A-08 | Maps/routing | Select contracted production provider with Nepal quality/privacy/capacity; public OSRM dev-only | Product + legal + operations; no live ETA/fare claim until passed |
| A-09 | Messaging/storage/scanner | Approve Nepal-capable SMS/push/email, private object, malware scan, residency/key controls | Security + operations + legal; blocked workflows degrade honestly |
| A-10 | Payments | Cash ledger first; eSewa/Khalti/other provider only after commercial/security/financial design | Finance + product + security |
| A-11 | DVR808 | Optional isolated pilot; no core dependency until real-device/security/load test | Operations + security; otherwise defer all video endpoints |
| A-12 | Retention/SLO/DR | Ratify or revise proposals in operations document, including cost and legal obligations | Operations + legal/privacy + product + security |
| A-13 | Mobile cutover | Enforce minimum target-API app version and bounded write freeze/final delta | Mobile/product/operations; otherwise fund a proven write-capture bridge |
| A-14 | Hosting/residency | Choose production regions/managed PostgreSQL, Redis, Kafka, object, KMS, telemetry and egress controls | Security + legal + operations; blocks provider/DR finalization |
| A-15 | Data conflicts/quarantine | New IDs + legacy maps; no automatic identity/tenant merge; named owners decide quarantines | Data + product + security + finance as applicable |

Approvals must reference a document revision/commit and record amendments. Silence, implementation
discussion, or approval of one table is not blanket Gate 1 approval.

## 11. Approval matrix

| Accountable function | Must approve |
|---|---|
| Product owner | First scope, canonical workflows/statuses, user cutover/communications, deferred features |
| Dispatch/clinical operations owner | Booking/offer/trip actor rules, active-trip handover, SOS/escalation, operational projections |
| Security owner | Tenant/RLS/RBAC/authority, authentication/tokens/MFA, keys/secrets, uploads/providers, threat/test gates |
| Data owner | Source authority, mappings, quality/quarantine, reconciliation and archive/deletion |
| Platform engineering owner | Runtime/module boundaries, Kafka/BullMQ/outbox, hosting/capacity, migrations/deploy/DR |
| Mobile owner | API/status/money/realtime adapter, minimum version, secure token storage, offline/error behavior |
| Hospital/Province/Super portal owners | Persona/API acceptance and removal of local authorization/mock success paths |
| Legal/privacy owner | PII/document/location/provider flows, consent, residency, retention/erasure/legal hold |
| Finance owner | Currency, fare/cash reconciliation, payment scope, ledger/retention |

Recommended approval record:

```text
Gate: 1 — Phase 0/1 architecture
Document commit/revision:
Decision: APPROVED | APPROVED WITH AMENDMENTS | REJECTED
Approved decision IDs:
Amendments/blockers (owner + due date):
Name/function:
Date:
```

Any amendment that changes tenant root, authority semantics, lifecycle invariants, source precedence,
first scope, or event/transaction correctness requires documents to be revised and Gate 1 reviewed
again before implementation.

## 12. Risk register

| Risk | Severity | Mitigation / gate | Accountable owner |
|---|---|---|---|
| Hosted Supabase/Go reality differs from repository | Critical | Read-only production discovery, signed schema/data profiles, revise mappings before Gate 7 | Data owner |
| No existing reliable tenant grouping | Critical | Owner-supplied provider/facility registry, quarantine ambiguity, composite keys/RLS tests | Product + security |
| Old mobile direct writes cause split brain | Critical | A-13 minimum version/freeze or proven capture bridge; one-writer registry | Mobile + product |
| Identity collisions merge different people | Critical | No credential migration/automatic merge; re-verification and reviewed collision queue | Security + data |
| Active trip controlled by two systems | Critical | Drain or explicit legacy reservation handover; one command authority per aggregate | Operations |
| Province/platform view leaks tenant/PII | Critical | Explicit grants, field projections, RLS, step-up, audit, negative/export tests | Security |
| Double assignment under contention | Critical | DB locks/conditional update/unique constraints/idempotency and multi-replica race tests | Engineering + operations |
| Broad Go catalog overwhelms core rebuild | High | A-07 scope, workflow acceptance not route/table parity, separate backlog approval | Product |
| Provider code exists but live delivery fails | High | Provider-specific gates, sandbox/live canary, breaker/fallback, truthful statuses | Operations |
| DVR device/vendor creates security or support burden | High | Isolated optional pilot, egress/terminal allowlist, real-device/load/privacy acceptance | Security + operations |
| Mixed NPR/USD or unproven wallet corrupts finance | Critical | Minor units/ISO, zero-tolerance reconciliation, cash first, quarantine unknown money | Finance |
| Kafka/Redis dual-write loses events/jobs | Critical | PostgreSQL outbox/inbox/job intents and failure/recovery suites | Engineering |
| Retention violates law or copies excess GPS/docs | High | A-12 legal schedule, data minimization, hold-aware dry-run deletion | Legal/privacy |
| Infrastructure declared but not operable | High | Staged gates, restore/failover/DLT/key/provider runbooks and owned on-call | Operations |
| Portal UI continues hard-coded authorization | High | Server-only authorization, persona negative tests, remove mock success before cutover | Portal owners + security |
| Migration rollback discards new target writes | Critical | Post-write forward-fix preference; compensation bridge required for legacy fallback | Incident commander + data |
| Nepal connectivity/reconnect storms overload service | High | Batching/backoff, idempotency, socket reconnect load test, degraded tracking semantics | Mobile + engineering |

## 13. Gate 1 package checklist

- [x] Consolidated Phase 0 source-of-truth discovery.
- [x] Exact Go registration and schema inventory with confidence limits.
- [x] Target module/runtime/Clean Architecture design.
- [x] Tenant, facility, RLS, custom RBAC, authority, token, and security design.
- [x] Canonical ERDs, ownership classes, lifecycle states, and source mappings.
- [x] HTTP/realtime contract and legacy-client mapping.
- [x] Kafka event, outbox/inbox, BullMQ job-intent, and integration design.
- [x] Operations, observability, SLO/DR/retention proposals, and Jest/Postman test strategy.
- [x] Migration, coexistence, cutover, rollback, reconciliation, risk, and approval gates.
- [ ] Accountable owner decisions A-01 through A-15.
- [ ] Gate 1 approval record.

## 14. Stop point

This document is the end of Phase 1. The next action is owner review and an explicit Gate 1 decision.
No NestJS implementation is authorized by completion of these documents alone.
