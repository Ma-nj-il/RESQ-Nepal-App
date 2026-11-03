# Phase 2 foundation threat model

- **Scope:** `backend-v2/` foundation only
- **Method:** STRIDE-informed data-flow and abuse-case review
- **Review state:** implementation review complete; independent Gate 2 security/operations approval pending
- **Last updated:** 2026-11-03

## 1. Scope and security boundary

Phase 2 creates runtime, persistence, messaging, observability, migration, and delivery foundations.
It exposes health and metrics endpoints only. It does **not** implement authentication, RBAC, tenant
selection, a business command/query, a provider callback, an object-storage operation, or a legacy
route. Those controls and their threat-model extensions are mandatory before later gates.

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
| TM-06 | Duplicate/out-of-order events or jobs apply an effect twice.                              | Unique event IDs, stream sequences, inbox keys, deterministic job IDs, aggregate versions, and state-shape constraints exist in PostgreSQL. Outbox and job intent originate in the same future business transaction.                                                                        | No relay/consumer/processor exists yet. Crash-window, gap, DLT, retry, and reconciliation behavior is Gate 5 work.                                                                                                                                                                       |
| TM-07 | Redis loss or poisoning changes authoritative state.                                      | Cache and BullMQ URLs must differ in production; Redis is lazy and readiness fails closed. Production URLs require authenticated `rediss://`. Durable job intent remains in PostgreSQL.                                                                                                     | Cache key scoping, queue relays, rate limits, and outage recovery are later-phase tests.                                                                                                                                                                                                 |
| TM-08 | A rogue broker reads, forges, or replays Kafka traffic.                                   | Production requires TLS plus complete SASL credentials; missing/partial settings fail startup. Kafka clients use bounded connection/request timeouts and no startup correctness dependency.                                                                                                 | Topic ACLs, credential rotation, schemas, inbox processing, and replay/DLT authorization require platform review before events ship.                                                                                                                                                     |
| TM-09 | Dependency outage causes crash loops, hangs, or false readiness.                          | Clients are lazy, probes have timeouts, liveness has no network dependency, readiness returns only bounded component names/states, and database startup failure is nonfatal. Unit and Postman outage checks cover public behavior.                                                          | Real Compose outage tests and horizontal failover evidence remain required; local execution is blocked when Docker is unavailable.                                                                                                                                                       |
| TM-10 | Secrets, PII, location, tokens, SQL, or payloads leak to logs/traces.                     | Pino uses an explicit denylist and minimal request serializer; public errors are allowlisted and omit stacks/internal causes. OTel instrumentations are allowlisted to HTTP/Express/Nest; SQL, Redis, Pino, filesystem, explicit header capture, and payload capture are excluded.          | HTTP instrumentation can still emit URL/network attributes. Before a business route accepts sensitive query/path data, tracing hooks or collector processors must prove route-template normalization and attribute scrubbing. Future DTO/provider spans need data-classification review. |
| TM-11 | Health or metrics reveal topology/data or become an unauthenticated operational oracle.   | Health returns role, timestamp, and bounded names/states only. Metric labels use route templates and configured provider/operation names, never IDs.                                                                                                                                        | `/metrics` is currently an application route and must be private at ingress/service-network level before deployment; platform owner must prove that policy.                                                                                                                              |
| TM-12 | Request IDs create log injection or unbounded metric cardinality.                         | Caller IDs must match a bounded 16–128 character character set; otherwise UUIDv7 is generated. Metrics use route templates and unmatched fallback, not raw URLs or IDs.                                                                                                                     | Trace baggage and future correlation headers need equivalent limits.                                                                                                                                                                                                                     |
| TM-13 | Malformed/oversized input exhausts CPU, memory, connections, or provider capacity.        | Strict DTO validation, dependency timeouts, finite pools, circuit-breaker capacity, and container limits/hooks are available foundations. There are no business payloads in Phase 2.                                                                                                        | Ingress body limits, rate limits, query cost limits, queue backpressure, and load targets are required before public workflows.                                                                                                                                                          |
| TM-14 | A provider endpoint or object URL enables SSRF.                                           | No provider/object adapter exists. Production endpoint configuration requires HTTPS; Opossum factory enforces bounded labels/policies.                                                                                                                                                      | Endpoint allowlists, DNS/IP controls, redirect policy, raw webhook verification, and egress policy are later-gate blockers.                                                                                                                                                              |
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
image scan results, and named reviewer signoff are recorded in `phase-2-status.md`. Any later route,
data class, identity mechanism, provider, or deployment topology changes this model and requires an
updated review.
