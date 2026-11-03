# Phase 1 — operations, observability, and testing

**Status:** proposed production and verification plan. SLO, retention, disaster-recovery, hosting,
and provider values require approval before they become commitments.

## 1. Operating principles

1. PostgreSQL is the transactional source of truth; Redis, Kafka, BullMQ, caches, sockets, and
   provider callbacks cannot independently declare a business outcome.
2. Every runtime is replaceable and horizontally scalable. Process memory holds no authoritative
   session, permission, timer, job, subscription, or booking state.
3. Deployments are immutable container images. Runtime configuration and secrets are external.
4. Migrations are explicit release jobs. Application startup never calls TypeORM `synchronize` or
   opportunistically mutates schema.
5. Health, logs, metrics, traces, audit, and business reconciliation answer different questions;
   none substitutes for another.
6. Degraded behavior is declared. The platform reports stale, queued, unavailable, or unknown rather
   than inventing route, GPS, delivery, verification, or payment success.
7. Production access is least-privilege, time-bounded, MFA-protected, and audited. Engineers do not
   use shared database, broker, cloud, or portal credentials.

## 2. Environments and configuration

| Environment | Purpose | Data and integration rules |
|---|---|---|
| Local Docker | Developer feedback and deterministic integration tests | Synthetic data; local providers/emulators; no production secrets |
| CI | Isolated test stack per run | Generated fixtures; ephemeral credentials and networks |
| Development | Shared feature integration | Synthetic accounts; provider sandboxes only |
| Staging | Release candidate, migration rehearsal, load/failure tests | Sanitized/synthetic production-shaped data; separate provider accounts |
| Production | Live service | Approved providers, retention, residency, backups, monitoring, and access controls |

No lower environment receives a raw production database or object-store copy. If production-shaped
data is essential, an approved export removes/directly transforms PII and restricted content before
leaving the production boundary, with re-identification tests and an expiry.

Configuration is validated at process startup with an allowlisted schema:

- environment, runtime role, release/build identifier, public base URLs;
- PostgreSQL, Redis, Kafka, object storage, telemetry exporter, and provider endpoints;
- timeouts, connection/concurrency budgets, rate limits, feature/cutover flags, and policy versions;
- secret/key references, never secret values in ordinary configuration;
- explicit production safeguards: no localhost/public demo provider, no plaintext dependency URL,
  no default signing key, no wildcard CORS, no TypeORM synchronization, no mock adapter.

Unknown/deprecated variables fail CI and warn or fail startup according to risk. Configuration
changes are reviewed, versioned, attributable, and observable; emergency changes receive a later
review rather than becoming invisible drift.

## 3. Container and deployment model

### 3.1 Images

The future `backend-v2/` build produces pinned, reproducible Docker images for API, worker/outbox
relay, and migration entry points.

- Multi-stage build; production image contains compiled output and production dependencies only.
- Non-root user, read-only root filesystem, minimal writable temporary volume, dropped Linux
  capabilities, and no shell/package manager where practical.
- Locked dependency graph, source/build provenance, SBOM, signature/attestation, secret scan,
  dependency/license scan, and OS image scan.
- No credentials, `.env`, private keys, source maps with secrets, test fixtures containing PII, or
  portal/mobile bundle is baked into the image.
- The same digest advances through staging to production. Environment rebuilding does not create a
  different artifact.

Docker is required for reproducibility. The production container scheduler/managed platform is an
approval decision; architecture cannot assume Kubernetes-specific correctness.

### 3.2 Deployments

| Role | Dependencies for useful work | Scaling signal |
|---|---|---|
| API/realtime | PostgreSQL; Redis for sessions/rate limits/socket coordination; object/provider ports by route | Request latency/concurrency, socket count, DB pool budget |
| Worker | PostgreSQL, Redis/BullMQ, Kafka for subscribed consumers, provider ports by queue | Oldest job age, queue depth, consumer lag, provider quota |
| Outbox relay | PostgreSQL and Kafka | Oldest unpublished outbox age and throughput |
| Migration job | PostgreSQL and secret/KMS access needed by migration | Exactly one reviewed release execution |

API and worker deployments have independent resource limits and disruption budgets. Safety- and
dispatch-critical workers are isolated from report/document bulk work. Autoscaling has bounded
minimum/maximum replicas and cannot create more database/provider connections than budgets allow.

Production credentials and capacity are isolated by purpose. In particular, BullMQ/security-
critical Redis data must not share an eviction budget with best-effort cache entries; the BullMQ
deployment uses the supported persistence/HA mode and `noeviction`, while cache/socket data can use
reviewed TTL/eviction policy. Kafka ACLs, database roles, object prefixes, and provider credentials
are similarly scoped to the runtime/module that needs them.

### 3.3 Graceful lifecycle

- On shutdown, stop accepting new HTTP/socket subscriptions, fail readiness, drain in-flight work
  within a configured deadline, release Kafka/BullMQ leases safely, and close pools.
- API requests with an idempotency key remain discoverable after a pod dies mid-response.
- Workers extend/observe job locks for long approved operations and design processors so a lost lock
  cannot duplicate an effect.
- Deployments do not terminate all replicas simultaneously. Socket clients reconnect and refetch
  authoritative HTTP state after gaps.

## 4. Health and service status

| Probe | Meaning | Dependency policy |
|---|---|---|
| `/health/live` | Process event loop is alive and not irrecoverably wedged | No network dependency calls |
| `/health/startup` | Configuration and required clients initialized | Fails until startup work completes |
| `/health/ready` | This replica can safely accept its configured work | Role-specific, fast, cached/bounded checks |
| `/status` | Public coarse service status if product requires it | No versions, hosts, topology, or dependency details |

Readiness is not a complete deep diagnostic:

- API requires PostgreSQL and the security-critical Redis capabilities used for distributed
  throttling/session invalidation. Kafka outage alone need not reject a DB command because the
  outbox is durable, but backlog limits can trigger protective admission control.
- Outbox relay requires PostgreSQL and Kafka.
- A queue worker requires PostgreSQL and Redis; a Kafka consumer worker also requires its broker.
- Optional provider failure degrades only routes/jobs that require that provider unless business
  policy says the whole service is unsafe.

Detailed health is restricted to operators and exports safe component state, breaker state, and lag
without credentials, URLs containing secrets, SQL, or vendor bodies.

## 5. Structured logging with Pino

Pino emits one JSON object per record to stdout/stderr for platform aggregation. Containers do not
manage rotating local log files.

Required common fields:

- UTC timestamp, severity, service/runtime role, release, environment, host/pod instance;
- request/event/job ID, correlation/causation ID, W3C trace/span IDs;
- route template or event/job type (never raw URL with secrets), method/status/duration;
- authenticated principal/session and tenant/facility/grant IDs only where classification permits;
- aggregate type/opaque ID/version and safe result/error code;
- provider/operation, attempt, timeout/breaker result with sanitized metadata.

Pino serializers/redaction remove at least:

- authorization/cookie/API-key/signature headers, access/refresh/OTP/MFA/recovery values;
- passwords, secret/KMS material, database/provider URLs with credentials;
- phone/email/citizenship/licence values, patient/contact narrative, support message bodies;
- exact GPS coordinates unless a narrowly approved restricted diagnostic stream exists;
- document bytes, object keys/presigned URLs, filenames, hashes where identifying;
- payment tokens/accounts and full provider request/response bodies.

Production does not log stack traces to clients. Internal error stacks are sampled/restricted and
linked by request ID. Logging failure must not crash a safety command, but sustained log-export
failure alerts operators and follows a bounded backpressure/drop policy.

Audit events are immutable business/security records with separate access and retention; writing a
Pino line is not an audit control.

## 6. Metrics, traces, dashboards, and alerts

### 6.1 Metrics

Prometheus-compatible metrics use bounded labels. User, booking, trip, tenant, phone, request ID,
raw route, and error message are forbidden labels.

Required groups:

- HTTP/realtime: request count/duration/status by route template; active sockets; auth/subscription
  denials; reconnects; event fan-out lag;
- PostgreSQL: pool usage/wait, query/transaction duration, errors/deadlocks, lock waits, replication
  lag, storage/partition growth, migration version;
- Redis/BullMQ: connection latency/errors, memory/eviction, queue depth/age, active/delayed/failed,
  job runtime/retry/stall;
- Kafka/outbox/inbox: publish age/failure, consumer lag, duplicates, version gaps, DLT/replay;
- domain: booking request outcome, offer time-to-response, unfulfilled rate, assignment contention,
  trip state age, cancellation reason, SOS acknowledgement age—aggregated without PII;
- security: login/OTP/MFA outcomes, token-reuse detections, rate limits, RLS/policy denials, grant
  changes, restricted downloads, webhook signature failures;
- providers: latency/outcome/timeout, breaker/bulkhead state, rate-limit responses, delivery status;
- infrastructure: CPU, memory, event-loop lag, restarts, network, disk/certificate/key expiry.

### 6.2 Tracing

OpenTelemetry-compatible traces propagate W3C context through HTTP, WebSocket acknowledgements,
PostgreSQL, outbox, Kafka, job intent, BullMQ, and approved provider calls. Sampling keeps all errors
and high-risk/safety traces according to policy while respecting volume and restricted-data rules.
Span attributes use route templates and opaque references; SQL statements and event/provider
payloads are not captured in production.

### 6.3 Minimum dashboards

1. Core API and authentication SLI/error budget.
2. Dispatch funnel: requested → offered → accepted/assigned/unfulfilled and state age.
3. Active trips/tracking freshness and realtime delay.
4. SOS age, acknowledgement, channel attempts, and escalation.
5. PostgreSQL capacity/locks/replication and migration state.
6. Redis/BullMQ queue health by criticality.
7. Kafka/outbox/inbox/DLT health.
8. Provider health and Opossum breaker/bulkhead state.
9. Security anomalies, authority/access changes, and restricted content downloads.
10. Migration/cutover reconciliation and legacy-vs-target shadow comparison.

### 6.4 Paging policy

Pages represent user-impact or imminent data/correctness risk, not every exception. Initial page
conditions include exhausted core error budget burn, sustained booking/offer command failure,
unbounded trip/SOS age, database availability/replication risk, refresh-family attack spike,
outbox/job-intent/Kafka critical lag, safety queue age, object exposure, and failed backup/restore
verification. Lower-severity provider/report issues create tickets or business-hours alerts.

Every page links to a runbook, dashboard, owning team, severity, communications path, and safe
mitigation. Static thresholds are tuned from load tests/baselines but cannot hide an SLO burn.

## 7. Proposed service objectives — approval A-12

These are planning targets, not current claims or signed SLAs. The measurement window is a calendar
month unless approved otherwise.

| Capability | Proposed SLI/objective | Notes |
|---|---|---|
| Core lifecycle API | 99.95% valid create-booking, accept-offer, and trip-command requests receive a correct non-5xx response | Does not count policy/validation rejection as availability; measured per command too |
| Authentication/refresh | 99.9% platform-side success availability | External SMS delivery reported separately |
| Other authenticated API | 99.9% availability | Report exports/provider-specific routes have separate objectives |
| Core command latency | p95 ≤ 750 ms, p99 ≤ 2 s | Excludes deliberately asynchronous provider completion; includes authorization/transaction/outbox write |
| Core read latency | p95 ≤ 500 ms, p99 ≤ 1.5 s | Server processing at ingress, bounded page |
| Domain event propagation | 99% of committed core outbox events published and consumed within 5 s | Kafka healthy; backlog age remains visible during outage |
| Lifecycle realtime projection | 99% delivered to connected authorized clients within 2 s after commit | Client refetch remains recovery path |
| Accepted tracking point freshness | 99% reflected in latest-position projection within 3 s | Connectivity/device loss measured separately; UI shows age |
| SOS platform acknowledgement | p95 ≤ 1 s for durable incident creation | Does not claim responder/SMS delivery |
| Safety delivery initiation | 99% of eligible channel attempts started within 5 s | Provider delivery success/latency reported separately |

Planned maintenance, dependencies, invalid requests, and client connectivity are tagged, not simply
removed from all reporting. Both platform-only and end-to-end user journeys are measured so a
provider exclusion cannot make a broken service appear healthy.

Error-budget policy should halt risky feature releases and prioritize reliability when burn exceeds
the approved threshold. Financial or safety correctness incidents can halt release regardless of
availability budget.

## 8. Capacity and performance planning

No source supplies trustworthy production traffic, tenant, fleet, trip, GPS, or retention volumes.
Before sizing, owners must provide a forecast with peak/normal:

- registered/monthly/daily/concurrent users and portal operators;
- providers/facilities/drivers/ambulances and active province grants;
- bookings per second/minute, offer fan-out, active trips, and lifecycle commands;
- tracking devices, point frequency/batch size, socket count, and reconnect storm size;
- OTP/push/SMS/email attempts and provider quotas;
- document sizes/submissions/scans, exports, DVR streams if approved;
- event/job rates, growth, retention, and geographic/availability requirements.

Load tests model steady state, forecast peak, at least the approved headroom factor, burst booking,
mass socket reconnect, offer-acceptance contention, GPS stream, report isolation, and one dependency
degraded. Results establish pod/worker counts, pool budgets, Kafka partitions, Redis/PostgreSQL
capacity, rate limits, and autoscaling—not guessed production defaults.

## 9. Dependency degradation

| Dependency unavailable | Safe behavior |
|---|---|
| PostgreSQL | Reject stateful/auth-sensitive requests; do not serve stale mutable truth as current |
| Redis | Fail closed for security-critical rate/session checks as policy requires; no BullMQ claims; database job intents remain |
| Kafka | Commit eligible DB commands with outbox; alert/backpressure on bounded backlog; realtime/eventual projections may lag visibly |
| Object storage/scanner | Preserve application draft; block final submission/review of unsafe content |
| Maps/routing | Do not invent route/ETA/fare input; allow only approved manual-location workflow if product/security accepts it |
| Push/SMS/email | Persist notification/attempt, retry/escalate by approved channel policy, report pending/failed accurately |
| Payment provider | Do not mark paid/refunded; reconcile later using stable provider reference |
| DVR | Core dispatch/trip remains independent; video/telematics shows unavailable/stale |
| Observability backend | Continue bounded local emission; alert through independent health where possible; never drop business/audit transaction |

Admission control protects core booking/trip/SOS work before optional reports, analytics, DVR, bulk
notifications, and scans consume shared limits.

## 10. Backup and disaster recovery — approval A-12

### 10.1 Proposed targets

| Asset | Proposed recovery objective | Recovery source |
|---|---|---|
| PostgreSQL core state | RPO ≤ 5 minutes; RTO ≤ 60 minutes | Multi-AZ managed service, continuous encrypted PITR, tested snapshots |
| Restricted objects | RPO ≤ 15 minutes; RTO ≤ 4 hours | Versioning/replication consistent with approved Nepal residency, inventory reconciliation |
| Kafka | Restore service within core RTO; retention exceeds maximum repair/replay window | Replicated managed cluster plus PostgreSQL outbox/inbox; Kafka is not sole business truth |
| Redis/BullMQ | RTO ≤ 60 minutes; no loss of authoritative required-work intent | Redis HA/persistence as selected; rebuild queues from PostgreSQL `job_intents` and reconcile |
| Audit archive | No acknowledged audit loss; recovery per legal/security objective | PostgreSQL transaction plus immutable encrypted archive verification |

These values require cost, hosting-region, residency, and business approval. A multi-region design is
not claimed until consistency, provider reachability, failover routing, and data residency are
tested.

### 10.2 Required controls

- Encrypted backups use keys with tested recovery and separation of duties.
- Backup success is insufficient: automated integrity checks and scheduled restore drills rebuild an
  isolated environment, run migrations/checks, and reconcile row/object/audit counts.
- Proposed cadence is quarterly full disaster exercise and more frequent database restore samples;
  operations must approve final cadence.
- Point-in-time recovery is rehearsed around bad deployments/migrations and documented with decision
  authority for failover/failback.
- Object inventory detects missing/orphaned objects without making private objects public.
- Runbooks define DNS/ingress, secrets/KMS, database, Redis, Kafka, workers, providers, and client
  communications. A recovered database does not automatically replay unsafe external effects.

## 11. Proposed retention and privacy schedule — approval A-12

The following is a conservative design proposal, not legal advice. Nepal health, transport,
identity, employment, tax, payment, and incident requirements must be confirmed before migration.
Legal hold overrides ordinary deletion but is itself authorized and audited.

| Data | Proposed active retention | End-of-period action / unresolved point |
|---|---|---|
| Raw OTP/challenge secret | Until short challenge expiry; never recoverable plaintext | Cryptographically erase/purge; retain only minimal security outcome up to 90 days |
| Refresh-token hash/session security metadata | Active session plus 1 year after revocation/expiry | Purge/anonymize IP/device fields unless incident hold requires them |
| API application logs | 30 days searchable, up to 90 days restricted archive | Purge; security logs may require a separately approved period |
| Traces | 7 days full/sampled, up to 30 days selected operational traces | Purge; no payload/PII |
| Idempotency records | At least client retry/business dispute window; proposed 7 days ordinary commands | Financial/high-risk records use longer approved policy without retaining secrets |
| Outbox/inbox/job execution diagnostics | Proposed 30 days hot, 90 days restricted archive | Purge payload/metadata after replay/investigation window |
| Raw high-frequency location points | Proposed 30 days | Aggregate/anonymize or purge; incident/legal hold exceptions |
| Sampled completed-trip route | Proposed 1 year | Legal/product decision; minimize precision and access |
| Notifications/delivery attempts | Proposed 1 year | Purge message bodies earlier where feasible; retain outcome aggregates |
| Support content | Proposed 2 years after closure | Redact/anonymize unless legal hold |
| Documents and extracted identity/compliance data | Active relationship plus statutory/dispute period | Exact period unresolved; delete superseded bytes as early as lawful |
| Booking/trip/cash records | Proposed 7 years for financial/operational record | Confirm tax/health/transport requirements; anonymize non-required PII earlier |
| High-risk audit events | Proposed 7 years in immutable archive | Confirm statutory/security requirement and hash-chain evidence policy |
| Report exports/presigned grants | Hours/days; proposed maximum 7 days for export object | Revoke grant and delete object; audit remains |
| Webhook/provider payload | Minimum needed for verification/dispute; provider-specific | Store normalized result/hash where possible, purge raw restricted payload quickly |

Retention jobs are versioned, dry-run capable, hold-aware, scoped, reconciled, and produce counts,
not deleted content. Account deletion is a workflow that separates immediate access deactivation from
lawful erasure/anonymization.

## 12. Database migrations and releases

### 12.1 Migration policy

- TypeORM migration files are reviewed SQL/TypeScript artifacts and are forward-only in production.
- CI applies every migration from an empty supported PostgreSQL/PostGIS instance and from a snapshot
  of the prior release, then runs schema/invariant/RLS tests.
- A migration job acquires a PostgreSQL advisory lock, verifies expected prior version/checksum,
  records start/end/operator/release, and exits before incompatible application rollout.
- Destructive `DROP`, type rewrite, table rewrite, unbounded backfill, constraint validation, and
  index creation require an online plan, measured lock impact, backup/restore point, and approval.
- Application database roles cannot run DDL. Migration credentials are short-lived and separate.
- `synchronize: false` in all environments that claim migration fidelity.

### 12.2 Expand–migrate–contract

1. **Expand:** add nullable/new table/index concurrently where supported; old and new releases both
   function.
2. **Migrate:** backfill in resumable tenant/time/key ranges with progress/reconciliation and no
   tenant-context leakage.
3. **Switch:** deploy code using the new shape behind an observable flag; compare results.
4. **Enforce:** validate constraints and make required fields non-null after clean reconciliation.
5. **Contract:** remove old reads/writes only after rollback window and client/event compatibility
   evidence; physical deletion is a later release.

Rollback normally means routing or application rollback while the expanded schema remains. Down
migrations are not assumed safe. After a new write contract becomes authoritative, use a forward
fix or an explicitly rehearsed compensating migration rather than restoring an old database over
new emergency trips.

### 12.3 Release sequence

1. Validate config/secrets/provider readiness and backup/restore point.
2. Run compatible migration job and invariant checks.
3. Deploy outbox/worker consumers that tolerate old/new events before new producers.
4. Canary API/worker replicas or selected non-authoritative workloads.
5. Run synthetic booking/offer/trip/authorization and queue/event checks.
6. Increase traffic while monitoring SLIs, business reconciliation, security, and lag.
7. Record release evidence; keep rollback/forward-fix owner present through the observation window.

## 13. Security operations

- Signing/encryption/provider keys live in approved KMS/secrets management with distinct environment
  and purpose, least-privilege workload identity, rotation, access alerting, and break-glass recovery.
- Access-JWT signing rotation is rehearsed: publish verifier key, begin signing, observe, retire after
  maximum token/grace window. Compromise triggers immediate key/session response.
- Database, Redis, Kafka, object, telemetry, and provider credentials rotate without image rebuild.
- Dependency/image/provider advisories have severity-based remediation targets and emergency patch
  process. Lockfiles and artifact signatures are verified in CI/deploy.
- Quarterly access review is the proposed maximum interval for production operators; authority
  grants and break-glass use are reviewed more quickly.
- Penetration testing covers multitenancy, authority grants, mobile/API storage, browser auth/CSRF,
  uploads, WebSockets, provider callbacks, DVR egress, and business races before production.
- Incident response preserves evidence while minimizing copied PII and meets an approved breach
  notification process.

## 14. Jest testing strategy

Jest is the test runner/expectation framework across the NestJS codebase. Real dependencies are used
where their semantics matter; mocks cannot prove PostgreSQL RLS, locks, Redis atomicity, Kafka
delivery, BullMQ retries, object policies, or provider signatures.

| Layer | Scope | Required examples |
|---|---|---|
| Domain unit | Pure entities, value objects, policies, state machines | Money, status transitions, eligibility, delegation ceiling, cancellation |
| Application unit | Use cases against in-memory/fake ports and deterministic clock/IDs | Command orchestration, error mapping, outbox/job intent request |
| Persistence integration | Real supported PostgreSQL/PostGIS and TypeORM migrations | Repositories, composite FKs, constraints, locks, RLS, partitions |
| Infrastructure integration | Real ephemeral Redis, Kafka, BullMQ, S3-compatible test storage | Rate limits, cache invalidation, outbox/inbox, job relay/retry, upload lifecycle |
| Module integration | Nest module with real database and controlled adapters | Transaction boundaries and cross-module ports/events |
| HTTP/realtime e2e | Built application over network boundary | DTO validation, auth/context, permissions, projection, idempotency, sockets |
| Event contract | Producer/consumer fixtures against versioned JSON schemas | Compatibility, redaction, unknown version, duplicate/gap behavior |
| Provider contract | Sandbox/mock server with captured documented cases | Signatures, timeouts, errors, idempotency, callback replay |
| Client contract | Mobile and portal adapters against target DTO fixtures | Status/money mapping, error handling, token refresh, stale/realtime recovery |
| Acceptance | Postman collection executed with Newman | Persona workflows and denials; no Swagger dependency |
| Performance/resilience | Controlled staging stack | Peak/headroom, races, failover, lag, breaker, reconnect, restore |

Test clocks, IDs, randomness, OTP delivery, and provider responses are injectable. Tests do not wait
for wall-clock timers when a deterministic clock or BullMQ scheduler control can advance policy.

## 15. Mandatory correctness and security suites

### 15.1 Tenant/RBAC/RLS

- Two tenants/facilities/users with analogous records cannot read, mutate, subscribe, export, cache-
  hit, or infer each other's resources by ID, filter, cursor, error, timing, object key, or report.
- Facility-scoped assignment cannot widen to its tenant; tenant assignment cannot use another tenant
  header; body/query tenant fields are ignored/rejected.
- Province grant cannot cross geography/resource/action/purpose or view content/PII absent its flags.
- Expired/revoked/not-yet-valid grant and role-profile/assignment change invalidate cache and active
  socket; stale positive cache never permits access.
- Delegator cannot create a role/profile/assignment broader than their own delegable authority.
- Direct SQL under the application role is denied by RLS even if an application guard is bypassed.
- Reused pooled connection starts with no prior request settings; `SET LOCAL` rolls back after every
  success/error/cancellation path.
- Worker/job/event missing or mismatching tenant context fails closed.
- Out-of-scope and nonexistent sensitive IDs return indistinguishable public responses.

### 15.2 Authentication/session

- Issuer/audience/signature/expiry/not-before/key ID/token/session versions and clock skew are
  enforced; algorithm confusion and unsigned/wrong-key tokens fail.
- Key rotation verifies new and grace-period tokens, then rejects retired/compromised keys.
- Concurrent refresh attempts yield one successor; reuse of consumed predecessor revokes the family
  and current successor; logout/all-device revocation takes effect across replicas.
- OTP is single-use, expires, enforces attempts/rates, is enumeration-safe, hashed, and absent from
  logs/traces/audit.
- Browser refresh cookie flags, origin/CSRF controls, CORS allowlist, and mobile secure-storage
  adapter behavior receive platform tests.
- Step-up assurance expires and is required for every catalogued high-risk route.

### 15.3 Booking/dispatch/trip concurrency

- Many simultaneous accepts across replicas produce exactly one accepted offer/assignment and
  supersede all competitors; every loser receives a deterministic conflict.
- Same idempotency key/request returns one result; same key/different hash conflicts; timeout retry
  does not duplicate booking, SOS, trip command, cash record, or provider call.
- Driver and ambulance cannot receive overlapping active assignments, including cross-facility race.
- Offer acceptance at/after database deadline, suspended/expired resource, or stale aggregate
  version fails inside the locking transaction.
- Every allowed lifecycle arrow and every disallowed/terminal/backward arrow is tested for each actor
  class and override policy.
- Completion/cancellation atomically changes booking/trip, releases resources, writes history/audit,
  and creates outbox/job intents. Injected failure rolls all of them back.
- Money uses minor units/NPR, handles boundary/rounding rules deterministically, and never silently
  falls back to USD.

### 15.4 Messaging/jobs/realtime

- DB commit with Kafka down leaves publishable outbox; relay recovery delivers it.
- Crash after Kafka publish/before outbox marker causes a duplicate, and inbox prevents duplicate
  effect.
- Consumer crash before/after DB commit, offset reset, duplicate, unknown schema, poison payload,
  stream/aggregate gap, and DLT replay preserve correctness.
- Redis down leaves durable job intent; recovery/reconciler enqueues once by deterministic job ID.
- Delayed expiry/reminder after state change is a no-op; stalled worker and retry do not repeat
  external effect.
- Socket subscribe/change-context/revocation/expiry is authorized; forged room/resource names and
  cross-tenant Redis fan-out fail.
- Reconnect/version gap forces HTTP refetch; duplicate/out-of-order projection cannot regress UI.
- Telemetry rejects wrong trip/device/crew, inactive state, replayed point, invalid sequence/time/
  coordinate/rate, and reports stale age correctly.

### 15.5 Files/providers/webhooks

- Upload grants bind owner/context/purpose/object path/MIME/size/hash/expiry and cannot be reused or
  changed; magic-byte mismatch, malware, decompression/polyglot risk, and quarantined content block
  review/download.
- Restricted content requires separate permission/step-up and produces audit; signed URLs are short-
  lived, never logged, and cannot cross tenant.
- Opossum timeout/open/half-open/bulkhead and approved fallback behavior is deterministic; retry
  layers do not multiply calls.
- Webhooks validate raw-body signature, timestamp, replay, account/environment, size, schema, and
  provider event ID; duplicate callback applies one effect.
- Provider timeout after acceptance reconciles using stable idempotency/reference and never assumes
  an outcome.
- DVR adapter forbids arbitrary URL/terminal access and sanitizes errors/credentials; real-device
  acceptance is separate from unit/contract success.

## 16. Quality gates

Every pull request for the future backend must pass:

1. formatting, ESLint (including module-boundary rules), and strict TypeScript typecheck;
2. secret/dependency/license/static security scans;
3. domain/application Jest suites and targeted mutation tests for state/RBAC/money rules;
4. migration-from-zero and previous-version migration/RLS/invariant tests;
5. module/API/realtime/event/job integration tests with real ephemeral dependencies;
6. event-schema compatibility and Postman/Newman contract tests;
7. production Docker build, SBOM/signature policy, and startup/config safety tests.

Proposed coverage floor is 90% branch coverage for state machines, authorization, authentication,
idempotency, and money code, and 80% branch/line coverage for other core application code. More
important, every documented invariant and permission/transition matrix cell has an explicit test;
line coverage cannot waive one. Generated DTOs/config and unreachable defensive branches require a
reviewed exclusion, not blanket directory exclusions.

Nightly/pre-release gates add full provider sandbox contracts, dependency scan updates, load/race/
soak, broker/Redis/database failure injection, backup restore, and portal/mobile acceptance. A flaky
test is quarantined only with owner, risk assessment, issue, and expiry; critical isolation/race/auth
tests block releases even if flaky.

## 17. Test data and fixtures

- Deterministic factories create at least two tenants, multiple facilities, province/platform
  grants, every baseline role profile, users, resources, and same-shaped cross-tenant records.
- Fixtures contain synthetic Nepal-formatted but reserved/non-routable phone/email/address values,
  synthetic coordinates, fake documents, and sandbox provider IDs.
- Golden event/Postman fixtures are versioned and redaction-scanned.
- Tests never send SMS/push/email or payment/DVR calls to live endpoints. Environment safeguards
  make production adapter initialization impossible in CI/local.
- Performance data generation preserves referential/tenant distribution without copying real users.
- Failed test artifacts are classified and scrubbed before CI retention/upload.

## 18. Required runbooks and release evidence

Before production, operators must rehearse and own runbooks for:

- booking stuck/search unfulfilled spike and double-assignment alarm;
- active trip stalled/tracking stale and SOS unacknowledged;
- PostgreSQL failover, lock/deadlock, pool exhaustion, PITR, and bad migration;
- Redis/BullMQ outage, stalled jobs, missing job-intent repair;
- Kafka/outbox lag, consumer version gap, DLT triage/replay;
- SMS/push/maps/storage/scanner/payment/DVR provider outage and circuit recovery;
- refresh-token reuse/key compromise, authority abuse, tenant-data exposure, restricted-object leak;
- certificate/secret/signing/encryption key rotation;
- capacity saturation, mass socket reconnect, and safe optional-feature shedding;
- full disaster recovery and failback.

Release evidence includes image digest/SBOM, migration checksum/result, test/Newman reports, security
scan disposition, backup/restore status, SLI/capacity baseline, provider checks, feature/cutover flag
state, approvers, rollback/forward-fix decision, and observation outcome.

Final operational approval criteria are consolidated in
[migration-roadmap-and-approval.md](./migration-roadmap-and-approval.md).
