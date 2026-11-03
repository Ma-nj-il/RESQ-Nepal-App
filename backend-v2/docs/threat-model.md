# Phase 2–5 backend threat model

- **Scope:** `backend-v2/` foundation, identity/access, provider operations, core dispatch, tracking,
  and safety
- **Method:** STRIDE-informed data-flow and abuse-case review
- **Review state:** implementation review complete; independent Gate 2 security/operations approval pending
- **Last updated:** 2026-11-03

## 1. Scope and security boundary

Phase 2 creates runtime, persistence, messaging, observability, migration, and delivery foundations.
Phase 3 adds authentication, sessions, MFA, tenant/facility context resolution, custom RBAC,
authority grants, audit, and idempotency endpoints. Phase 4 adds provider, workforce, fleet, and
private-document contracts. Phase 5 adds booking/dispatch/trip lifecycles, tracking, safety incidents,
the outbox relay, and durable BullMQ processing. Approved production storage/scanner/routing/safety
delivery adapters, provider callbacks, production OTP, and legacy cutover remain unavailable.

The production boundary assumes:

- TLS termination and network policy restrict ingress and operational endpoints;
- workload identities and secrets are injected by an approved platform, never baked into images;
- PostgreSQL, Redis, Kafka, object storage, and telemetry are private services;
- production database roles are provisioned outside Compose and do not own application tables;
- a migration job is separately authorized and cannot be reached through the API runtime.

Local Compose deliberately uses synthetic plaintext credentials and unencrypted loopback ports. Its
configuration is rejected by `NODE_ENV=production` and is not a deployment template.

## 2. Assets and trust boundaries

### Assets

1. Tenant-scoped operational records and future restricted identity, health, location, document, and
   payment data.
2. Authentication/session material and provider credentials introduced in later phases.
3. Database, Redis, Kafka, object-storage, and telemetry credentials.
4. Migration authority, schema history, checksums, and migration-run evidence.
5. Audit, idempotency, outbox, inbox, stream-sequence, and durable job-intent records.
6. Logs, traces, metrics, build artifacts, lockfiles, images, and SBOMs.

### Trust boundaries and flows

```text
untrusted client
  -> ingress/TLS/rate controls (deployment boundary)
  -> API process -> PostgreSQL runtime role
                 -> Redis cache
                 -> telemetry collector

worker process -> PostgreSQL worker role -> isolated BullMQ Redis -> Kafka
relay process  -> PostgreSQL relay role  -> Kafka
migration job  -> separate DDL identity  -> PostgreSQL
CI runner      -> locked npm graph -> tests -> image/SBOM/scanner
```

Every network edge is untrusted until transport authentication, workload authorization, timeout,
size limits, and safe error handling have succeeded. PostgreSQL is the only correctness source;
Redis, Kafka, health, logs, and telemetry cannot declare a business outcome.

## 3. Threat register

| ID    | Threat / abuse case                                                                       | Foundation controls and evidence                                                                                                                                                                                                                                                            | Residual risk / required owner                                                                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TM-01 | A caller spoofs a user, tenant, facility, or authority scope through headers/body fields. | Phase 2 request middleware creates only an unprivileged correlation context. Transaction scope is applied through parameterized `set_config(..., true)` calls. No business route consumes caller scope.                                                                                     | Authentication and server-resolved scope are Gate 3 blockers; API/security owners must prove header/body values cannot widen scope.                                                                                                                                                      |
| TM-02 | A pooled PostgreSQL connection leaks the prior request's tenant context.                  | Unit of work starts a transaction and uses transaction-local settings; commit/rollback and runner release occur in `finally`. RLS tables use `FORCE ROW LEVEL SECURITY`.                                                                                                                    | Gate 3 needs success/error/cancellation pool-reuse tests and repositories that cannot execute outside the unit of work.                                                                                                                                                                  |
| TM-03 | An application or relay identity bypasses RLS or performs DDL.                            | Local roles are `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, and `NOBYPASSRLS`; runtime grants are table-specific. Migration credentials are separate. RLS integration test uses the non-owner API role.                                                                                    | Production grants require database/security review. Local `resq_migrator` is a Compose bootstrap superuser and must never be reused.                                                                                                                                                     |
| TM-04 | Concurrent, replayed, or unexpected migrations corrupt schema.                            | Startup never migrates; `synchronize` and `migrationsRun` are false. The migration entry point takes a stable advisory lock, checks an expected prior version when supplied, applies all migrations transactionally, and records release/operator/checksums/result. Down migrations reject. | Production release automation must supply expected prior version, short-lived DDL credentials, backup evidence, and approval. Schema checksum attestation/signing remains a deployment control.                                                                                          |
| TM-05 | SQL or configuration injection changes claims or migration behavior.                      | Runtime claims and evidence inserts are parameterized. Migration SQL is static, reviewed, checksummed source. Environment keys are allowlisted and unknown `RESQ_*` keys fail startup.                                                                                                      | Future dynamic filters and repositories require injection tests and bounded query construction.                                                                                                                                                                                          |
| TM-06 | Duplicate/out-of-order events or jobs apply an effect twice.                              | Unique event IDs, stream sequences, inbox keys, deterministic job IDs, aggregate versions, and state-shape constraints exist in PostgreSQL. Phase 5 writes outbox/job intent atomically, preserves stream order, reconciles queue jobs, and re-reads state before effects.                  | Kafka consumers/DLT replay are not implemented; real crash windows, broker gaps, and multi-replica recovery remain Gate 5 evidence.                                                                                                                                                      |
| TM-07 | Redis loss or poisoning changes authoritative state.                                      | Cache and BullMQ URLs must differ in production; Redis is lazy and readiness fails closed. Production URLs require authenticated `rediss://`. Durable job intent remains in PostgreSQL and deterministic reconciliation cannot demote active `RUNNING` work.                                | Real queue outage/reconnect/stalled-worker/replay tests and approved operational thresholds remain blocked.                                                                                                                                                                              |
| TM-08 | A rogue broker reads, forges, or replays Kafka traffic.                                   | Production requires TLS plus complete SASL credentials; missing/partial settings fail startup. Kafka clients use bounded connection/request timeouts and no startup correctness dependency.                                                                                                 | Topic ACLs, credential rotation, schemas, inbox processing, and replay/DLT authorization require platform review before events ship.                                                                                                                                                     |
| TM-09 | Dependency outage causes crash loops, hangs, or false readiness.                          | Clients are lazy, probes have timeouts, liveness has no network dependency, readiness returns only bounded component names/states, and database startup failure is nonfatal. Unit and Postman outage checks cover public behavior.                                                          | Real Compose outage tests and horizontal failover evidence remain required; local execution is blocked when Docker is unavailable.                                                                                                                                                       |
| TM-10 | Secrets, PII, location, tokens, SQL, or payloads leak to logs/traces.                     | Pino uses an explicit denylist and minimal request serializer; public errors are allowlisted and omit stacks/internal causes. OTel instrumentations are allowlisted to HTTP/Express/Nest; SQL, Redis, Pino, filesystem, explicit header capture, and payload capture are excluded.          | HTTP instrumentation can still emit URL/network attributes. Before a business route accepts sensitive query/path data, tracing hooks or collector processors must prove route-template normalization and attribute scrubbing. Future DTO/provider spans need data-classification review. |
| TM-11 | Health or metrics reveal topology/data or become an unauthenticated operational oracle.   | Health returns role, timestamp, and bounded names/states only. Metric labels use route templates and configured provider/operation names, never IDs.                                                                                                                                        | `/metrics` is currently an application route and must be private at ingress/service-network level before deployment; platform owner must prove that policy.                                                                                                                              |
| TM-12 | Request IDs create log injection or unbounded metric cardinality.                         | Caller IDs must match a bounded 16–128 character character set; otherwise UUIDv7 is generated. Metrics use route templates and unmatched fallback, not raw URLs or IDs.                                                                                                                     | Trace baggage and future correlation headers need equivalent limits.                                                                                                                                                                                                                     |
| TM-13 | Malformed/oversized input exhausts CPU, memory, connections, or provider capacity.        | Strict DTO validation, dependency timeouts, finite pools, circuit-breaker capacity, container limits/hooks, and a maximum 50-point tracking batch bound request work.                                                                                                                       | Ingress body/rate/query limits, per-device tracking rate controls, queue backpressure, and approved load targets are required before public workflows.                                                                                                                                   |
| TM-14 | A provider endpoint or object URL enables SSRF.                                           | Production object/routing/safety adapters are unavailable; local routing performs no outbound call. Production endpoint configuration requires HTTPS and Opossum factory enforces bounded labels/policies.                                                                                  | Approved adapters still require endpoint/DNS/IP/redirect allowlists, raw webhook verification, and egress policy.                                                                                                                                                                        |
| TM-15 | A compromised runtime modifies host/image or escalates privileges.                        | Runtime image is non-root, multi-stage, production-pruned, read-only in Compose, drops all capabilities, uses `no-new-privileges`, and writes only to bounded tmpfs.                                                                                                                        | CI image scan/SBOM is defined but needs an available Docker runner. Deployment seccomp, network policy, signature verification, and workload identity remain platform controls.                                                                                                          |
| TM-16 | Dependency or CI compromise executes attacker-controlled tooling.                         | Exact lockfile, `npm ci`, production-only blocking audit, image scan, and SBOM gates exist. CI uses repository-owned synthetic fixtures only. Patched overrides remove known high/critical development advisories.                                                                          | Remaining moderate development advisories require recurring review. Actions must be organization-allowlisted or SHA-pinned by the CI owner.                                                                                                                                              |
| TM-17 | Audit evidence is changed or deleted.                                                     | Audit rows are append-only by trigger, hash fields are constrained, and runtime roles lack update/delete. Migration evidence is stored in a restricted governance schema.                                                                                                                   | Partition archival, external immutability/WORM, hash-chain verification, clock trust, and privileged-operator monitoring require later operational approval.                                                                                                                             |
| TM-18 | Predictable or colliding identifiers enable enumeration/corruption.                       | IDs use injectable UUIDv7 generation and database uniqueness. Public sensitive-ID not-found equivalence is specified for later modules.                                                                                                                                                     | UUIDs are not authorization. Gate 3 must prove scope before lookup and indistinguishable denial behavior.                                                                                                                                                                                |
| TM-19 | Telemetry export exfiltrates data or blocks service.                                      | Production requires an HTTPS OTLP endpoint; exports are asynchronous and instrumentation is allowlisted.                                                                                                                                                                                    | Collector identity/mTLS, endpoint allowlist, sampling, retention, and failure budgets require hosting approval.                                                                                                                                                                          |
| TM-20 | Synthetic local credentials or plaintext services escape into production.                 | Production validation rejects localhost, plaintext PostgreSQL/Redis/object/OTLP, shared Redis, pretty logs, wildcard/non-HTTPS CORS, unauthenticated Kafka, and the default release. Container/local files are labelled synthetic.                                                          | Secret scanning and environment admission policy must independently prevent deployment of local files.                                                                                                                                                                                   |

## 4. Security invariants for Phase 2

- No business or legacy route is registered.
- No caller-provided tenant/facility/authority value is authoritative.
- No runtime starts TypeORM synchronization or automatic migrations.
- No application role owns governance tables or has `BYPASSRLS`.
- No queue/event/provider result is authoritative without a PostgreSQL transaction.
- No dependency failure makes liveness false or readiness true.
- No stack, credential, URL, SQL text, payload, or raw exception is returned publicly.
- No request/resource identifier becomes a metrics label.
- No production process accepts the local plaintext/default configuration.

## 5. Verification and Gate 2 disposition

| Control                                              | Evidence                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| Configuration fail-closed behavior                   | `test/unit/configuration.spec.ts`                          |
| Redaction                                            | `test/unit/log-redaction.spec.ts`                          |
| Dependency-independent liveness and failed readiness | `test/unit/http-foundation.spec.ts` and Postman collection |
| Stable error envelope                                | unit and Postman checks                                    |
| Clean Architecture direction                         | ESLint restrictions and `test/unit/architecture.spec.ts`   |
| RLS/non-owner role, empty and prior migration        | `test/integration/migrations.integration.spec.ts`          |
| Real Redis/Kafka/BullMQ/object-store reachability    | `test/integration/dependency-stack.integration.spec.ts`    |
| Supply chain and image                               | `.github/workflows/backend-v2.yml`                         |

Gate 2 may approve the foundation, not production use. Open infrastructure-backed evidence, SBOM/
image scan results, and named reviewer signoff are recorded in `phase-2-status.md`. Gate 3 evidence is
tracked in `phase-3-status.md`.

## 6. Phase 3 threat extension

| ID    | Threat / abuse case                                                                  | Implemented controls                                                                                                                                                                                      | Residual risk / required evidence                                                                                                           |
| ----- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| TM-21 | OTP enumeration, guessing, replay, or delivery abuse                                 | Generic responses, phone normalization, HMAC digests, one-time challenge consumption, attempt ceilings, Redis IP/subject buckets, short expiry, and public-purpose restriction                            | Production delivery/provider, carrier-abuse controls, Redis outage behavior, and penetration evidence are pending                           |
| TM-22 | Access or refresh token theft creates a durable session                              | Short-lived Ed25519 JWTs, server-side session/token-version checks, HMAC-digested opaque refresh tokens, one-time rotation, idle/absolute expiry, family reuse revocation, and no-store responses         | Managed-key rotation drill, device secure-storage acceptance, browser CSRF review, and concurrent real-PostgreSQL race evidence are pending |
| TM-23 | Password or MFA bypass/replay enables administrator access                           | Argon2 verification, mandatory verified TOTP for administrative login, encrypted TOTP secrets, atomic monotonic time-step consumption, challenge/session binding, attempt limits, and bounded AAL2        | Recovery-code/WebAuthn scope is not implemented; KMS custody, account recovery policy, and independent review are pending                   |
| TM-24 | Caller-controlled tenant/facility/authority headers widen access                     | Bearer verification followed by server-side session and assignment/grant resolution; selectors only choose among resolved contexts; transaction-local claims drive forced RLS                             | Docker-backed cross-tenant tests, pool cancellation/reuse tests, and database-role review remain Gate 3 blockers                            |
| TM-25 | A tenant administrator delegates permissions, scope, or validity they do not possess | Permissions → Roles → Role Profiles → Users hierarchy, permission subset checks, scope ceilings, facility subsets, mandatory expiry, TTL limits, self-elevation rejection, optimistic versions, and audit | Policy-owner acceptance and full repository/RLS concurrency evidence are pending                                                            |
| TM-26 | A province/platform authority becomes an implicit global administrator               | Explicit resource, geography, purpose, data-capability, AAL2, and expiry bounds; active ancestor chain; independently approved grants; no bypass role; target-bound RLS                                   | Root grant requires a separately reviewed bootstrap migration; independent security review and revocation drill are pending                 |
| TM-27 | `SECURITY DEFINER` functions bypass RLS or accept forged subjects                    | Fixed `pg_catalog` search path, caller identity bound to transaction claims, function-specific execute grants, migration-owner-only internal policies, target claims, and public execute revocation       | Must be inspected on the exact production roles and supported PostgreSQL version; Docker execution is blocked locally                       |
| TM-28 | Retried commands duplicate privilege changes or reuse a key for another request      | Actor/tenant/operation/key identity, canonical request hash, in-progress lease, stored status/body replay, and transactional completion/audit                                                             | Timeout/crash recovery against real PostgreSQL and operational retention review remain pending                                              |
| TM-29 | Revoked assignment/grant remains usable through an old token/session                 | Authorization resolves current rows for every protected request; revocation invalidates affected credentials; assignment/grant expiry is mandatory                                                        | Socket/cache invalidation and multi-replica revocation latency are later integration work                                                   |
| TM-30 | Authentication or authorization evidence leaks secrets/PII                           | No OTP/refresh/MFA secret in responses, logs, audit safe context, or JWTs; masked phone projection; restricted audit RLS; private key omitted from JWKS                                                   | Trace/collector field review and production log sampling are pending                                                                        |

### Phase 3 invariants

- A JWT never establishes tenant, facility, permission, or authority scope by itself.
- AAL2 is server-timed and downgrades after expiry; a stale AAL2 JWT is rejected.
- Refresh tokens are stored only as HMAC digests and each token can rotate once.
- A tenant assignment and an authority grant always expire.
- A delegator cannot grant a permission, facility, geography, capability, resource class, or duration
  beyond the resolved parent context.
- Authority issuance and approval are performed by distinct users; neither may be the subject.
- An application runtime cannot create a parentless authority grant.
- RLS is forced and database claims are transaction-local.

## 7. Phase 4 threat extension

| ID    | Threat / abuse case                                                                          | Implemented controls                                                                                                                                                                                                    | Residual risk / required evidence                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| TM-31 | An applicant reviews or approves their own provider, driver, ambulance, or document evidence | Service checks, database-bound caller/grant checks, append-only reviews, province recommendation plus separate platform final authority, and optimistic versions                                                        | Independent policy-owner review and supported-PostgreSQL race tests remain required                                                  |
| TM-32 | A province grant for one facility exposes another province or tenant                         | Facility-geography and driver-affiliation authority functions evaluate the exact resource; provider, fleet, document, and projection tables force RLS                                                                   | Docker-backed cross-geography and multi-facility provider tests plus production-role review remain blocked                           |
| TM-33 | A malicious upload bypasses private storage, size/hash/type checks, or malware quarantine    | Private object keys, bounded MIME/size allowlist, declared and provider metadata comparison, immutable hash, asynchronous scan states, quarantine, short grants, and audited content access                             | Storage/scanner provider, bucket policy, encryption/KMS, content-disposition, malware corpus, and egress tests are external blockers |
| TM-34 | Expired or incomplete evidence leaves a driver or ambulance dispatchable                     | Eligibility/readiness are derived from independent compliance, document, equipment, maintenance, operational, and assignment dimensions; review/expiry emits durable recalculation intent                               | Worker processing, expiry race tests on supported PostgreSQL, retention policy, and operations acceptance remain Gate 4 blockers     |
| TM-35 | Provider activation creates partial tenant or privilege state                                | Final approval is one security-definer transaction with caller/grant/level/version/self-review checks and creates organization, facility, membership, assignment, review, status, audit, and outbox evidence atomically | Exact production role/function ownership and rollback/failure injection require independent review                                   |
| TM-36 | A provider outage is represented as successful upload or clean evidence                      | Production-default storage and scanner adapters fail closed with retryable 503 errors; no synthetic clean result or public object fallback exists                                                                       | Approved providers and truthful sandbox/live canaries are required before enabling uploads                                           |

### Phase 4 invariants

- Provider final approval requires platform authority and cannot be performed by the applicant or the
  reviewer who recorded the province recommendation.
- Authority reads are constrained by the exact facility geography or active driver affiliation; a
  matching tenant alone is not sufficient for business projections.
- Document bytes never transit the API, object keys remain private, and content grants are short-lived
  and audited.
- A document cannot be reviewed until upload metadata matches and malware scanning reports clean.
- Expired, rejected, quarantined, missing, or incomplete evidence never counts toward readiness.
- Storage and scanner absence is a visible failure, not a mock success.

## 8. Phase 5 threat extension

| ID    | Threat / abuse case                                                                        | Implemented controls                                                                                                                                                                                                               | Residual risk / required evidence                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TM-37 | Two tenants accept competing offers or reuse the same driver/ambulance                     | Booking-first row lock, offer/version/deadline checks, current provider/driver/document/ambulance eligibility, unique accepted assignment and active-resource constraints, atomic supersession                                     | Supported-PostgreSQL multi-replica race, timeout/crash, failover, and approved capacity evidence remain required                                          |
| TM-38 | Caller forges requester/provider/crew/authority cancellation identity or fee               | Actor class is resolved from transaction claims and current relationships; selected class mismatch fails; booking is locked before trip; late-trip cancellation requires exact authority override; fee is fixed at waived zero NPR | Authority override HTTP/step-up is intentionally absent; operations must approve late emergency intervention and fee policy                               |
| TM-39 | Forged/replayed/out-of-order GPS overwrites current tracking or leaks another trip         | Exact assigned-driver/active-device binding, tenant/facility relationship, trip lock, unique point/sequence, monotonic source sequence and capture time, bounded values/window, forced RLS, capture-time freshness                 | Device identity lifecycle, per-device rate/load/reconnect tests, retention/legal approval, and production authority negative suite are pending            |
| TM-40 | SOS acknowledgement, escalation, cancellation, or resolution races produce unsafe state    | Booking/incident locks, expected version/tier, monotonic tier ≤5, terminal resolution, version-bound deterministic jobs, and stale alert/escalation re-read/no-op                                                                  | Operations-led race/drill and recipient/deadline/fallback acceptance are pending; unbound incident responder routing is not approved                      |
| TM-41 | Unavailable alert channel is presented as delivered                                        | Production-default safety adapter fails with retryable 503; jobs retain durable intent; delivery revalidates incident version/tier/severity/tenant/open state                                                                      | No provider or human fallback is approved, so live safety delivery remains unavailable and Gate 5 stays on hold                                           |
| TM-42 | Kafka/Redis dual-write, crash windows, or poisoned queue jobs lose/repeat work             | Business state, event, and job intent share one PostgreSQL transaction; ordered outbox uses at-least-once delivery; BullMQ IDs are deterministic; worker verifies intent/queue/job identity and records terminal state             | Kafka consumers/inbox/DLT tooling, outage/reconnect tests, operator retry, dashboards/pages, and production ACL review remain pending                     |
| TM-43 | Event payloads disclose patient narrative, contact, coordinates, documents, or credentials | Versioned schemas allow only minimal status/reference facts; Ajv validation checks all examples and rejects restricted fixture keys/unknown payload fields; tracking uses a separate restricted path                               | Broker ACL/retention, consumer fixtures, schema compatibility history, payload inspection, and independent privacy/security review are pending            |
| TM-44 | Patient or incident details leak from database/projections/logs                            | AES-GCM application protection, key-version metadata, private projections, body-free request logs, and events without protected narratives                                                                                         | Current application-managed key material needs approved KMS/envelope encryption, rotation/reencryption, backup, access, and compromise drills             |
| TM-45 | Development routing or mixed currency is mistaken for a production quote                   | Route quality/source and policy version are persisted; development estimate is labelled; coverage and quotes enforce current eligibility; all fare/cancellation/completion currency constraints require NPR                        | Nepal routing provider quality/privacy/capacity and finance fare/cancellation policy are unapproved; development routing must not serve production claims |

### Phase 5 invariants

- One booking can have one winning offer/assignment, and one active driver/ambulance cannot serve two
  assignments prohibited by policy.
- Database time and locks decide deadlines and lifecycle outcomes; delayed jobs are wake-up signals.
- Actor class, ownership, facility, authority, driver, ambulance, and device relationships are
  server-resolved and bound to transaction claims.
- Tracking freshness derives from capture time; stale/replayed points cannot replace current state.
- Safety tier is monotonic and bounded; resolved incidents are terminal and stale delivery work is a
  no-op.
- No event contains protected narrative, precise tracking points, credentials, tokens, or provider
  URLs.
- No unavailable route, broker, queue, or safety provider may be represented as successful.
- PostgreSQL business state/outbox/job intent remains authoritative over Kafka and Redis.
