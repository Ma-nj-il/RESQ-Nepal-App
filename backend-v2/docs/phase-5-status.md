# Phase 5 / Gate 5 status

> The local test counts and Docker limitations below are historical. See
> [current infrastructure-backed CI evidence](ci-evidence-2026-11-03.md) for subsequent results.

- **Disposition:** HOLD — implementation is available for review; Gates 2–5 are not passed
- **Evidence date:** 2026-11-03
- **Scope:** coverage/fares, booking/dispatch, trips/cancellation, tracking, safety incidents,
  transactional outbox, durable BullMQ intents, event contracts, and recovery procedures
- **No cutover:** no legacy route, client, data source, provider, topic, queue, or production workflow
  has moved

## Implemented scope

| Area                   | Implementation                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Booking and dispatch   | Coverage and NPR fare quotes, protected booking/search, tenant offers, booking-first contention-safe acceptance, atomic supersession, assignment, deterministic deadlines, and requester projections                        |
| Trips and cancellation | Named forward trip lifecycle, completion evidence, server-resolved cancellation actors, late-trip authority guard, zero-NPR waived fee policy, atomic booking/trip/resource release, matching release events, and timelines |
| Tracking               | Exact driver/device relationship checks, serialized 1–50 point ingestion, point/sequence dedupe, monotonic capture/sequence guards, bounded values/window, and capture-time freshness                                       |
| Safety                 | Encrypted incident details, optional active-trip binding, acknowledgement/escalation/resolution version races, bounded tiers, durable alert/escalation jobs, and stale-work suppression                                     |
| Isolation              | Forced RLS, composite tenant/facility relationships, requester-bound delivery predicates, narrowed generic delivery/job policies, transaction-local claims, and restricted security-definer grants                          |
| Delivery               | Ordered transactional PostgreSQL outbox, at-least-once idempotent Kafka publishing, durable job intents, deterministic BullMQ IDs, claim/retry/terminal-state reconciliation, and no Redis authority                        |
| Contracts              | 24 versioned schemas and canonical examples, routing/consumer/DLT ownership catalog, implementation-to-catalog validation, and a 12-request local Postman collection                                                        |
| Operations             | Transition/actor matrix, delivery-recovery runbook, safety-escalation drill, readiness signals, and fail-closed routing/safety provider behavior                                                                            |

## Executed evidence on this host

| Check                                   | Result                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Format check and ESLint                 | PASS — zero warnings                                                                                                     |
| TypeScript typecheck and build          | PASS                                                                                                                     |
| Unit suites                             | PASS — 18 suites / 69 tests                                                                                              |
| Architecture test                       | PASS — 1 suite / 2 tests                                                                                                 |
| Event contracts                         | PASS — all 24 schemas/examples validate and exactly cover emitted Phase 5 event literals                                 |
| Production dependency audit             | PASS — 0 vulnerabilities                                                                                                 |
| Compose configuration parse             | PASS                                                                                                                     |
| Contract/Postman JSON parse             | PASS — 55 JSON artifacts; the Phase 5 collection contains 12 requests                                                    |
| Integration-suite discovery             | 3 suites / 14 tests discovered and skipped by the explicit `RUN_INTEGRATION` gate                                        |
| Embedded PostgreSQL migration debugging | PASS — all five migration SQL artifacts parse and execute from empty with temporary PGlite 0.5.15 outside the repository |

PGlite required Node's `--no-wasm-tier-up` option on this host. It is SQL debugging evidence only; it
does not prove behavior on the supported PostgreSQL/PostGIS image, production roles, forced RLS,
concurrency, or migration from a prior fixture.

Focused local coverage includes lifecycle matrices, exact freshness boundaries, server-resolved
cancellation actors, cancellation resource-release evidence, fail-closed safety delivery, stale alert
suppression, HTTP DTO/permission contracts, event redaction/schema closure, and migration policy
regressions. The PostgreSQL integration suite additionally defines acceptance/cancellation/SOS races,
tracking replay/freshness, requester trip-delivery RLS, generic Phase 5 delivery/job bypass rejection,
and idempotency lease recovery, but those tests were not executed here.

## Implemented but not executed here

- empty and prior-fixture migration on the supported PostgreSQL/PostGIS image;
- non-owner requester/tenant/authority/worker RLS and security-definer execution with production-like
  role ownership and grants;
- multi-connection and multi-replica offer acceptance, cancellation/SOS, incident, tracking, and
  idempotency races;
- Kafka ordering/duplicate/crash-window, Redis/BullMQ outage/reconnect/stalled-worker, reconciliation,
  retry, and replay/DLT drills;
- infrastructure-backed Phase 5 Newman execution and approved routing/safety provider canaries;
- tracking device lifecycle, retention/privacy, rate, reconnect, sustained load, and approved capacity/
  SLO evidence;
- production image runtime, SBOM, signature, and Trivy evidence;
- operations-led dispatch simulation and safety escalation/fallback drill.

The Docker daemon did not respond within 15 seconds on this host. No local `psql`, Trivy, or Syft
binary is available. Infrastructure-backed checks remain blocked rather than reported as passing.

## External Gate 5 blockers

1. Gates 2–4 must pass on the exact source revision, lockfile, images, migrations, and production-like
   database roles.
2. Independent application/database security review, privacy review, penetration testing, and all
   critical/high finding remediation are required.
3. Operations/security must approve the actor matrix, authority override and cancellation/fee policy,
   tracking device and freshness rules, location retention, incident recipients/deadlines, human
   fallback, DLT/replay authority, and on-call ownership.
4. Approved Nepal routing and safety-delivery providers, KMS/envelope-encryption custody and rotation,
   broker/queue ACLs, topic/retention settings, and outage canaries are absent.
5. Multi-replica race, failure-injection, recovery, sustained tracking load, queue backpressure,
   capacity/SLO, and disaster-recovery evidence must meet owner-approved targets.
6. An operations-led end-to-end dispatch simulation and safety escalation/fallback drill must be
   accepted with evidence attached to the exact release.
7. Production infrastructure, data changes, cutover, and any public emergency claim require separate
   authorization; this implementation does not grant it.

**Recommendation:** keep Gate 5 on hold. Do not route production dispatch, tracking, or safety work to
this backend until every blocked test, provider control, operational drill, and accountable approval
is attached to the exact release.
