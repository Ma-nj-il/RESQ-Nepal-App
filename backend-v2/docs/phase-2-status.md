# Phase 2 / Gate 2 status

- **Disposition:** HOLD — foundation implementation is ready for review, but Gate 2 is not yet passed
- **Evidence date:** 2026-11-03
- **Scope:** `backend-v2/` only; no Phase 3 or legacy cutover work
- **Test host:** macOS, Node `v24.12.0`, npm `11.6.2`

## 1. Scope lock

Phase 2 adds only platform foundations: API, worker, outbox-relay, and migration entry points;
configuration, logging, telemetry, health, context, errors, persistence/resilience primitives;
forward-only governance migrations; local dependency infrastructure; tests; Postman/Newman; and CI
gates. The API registers only health and metrics controllers. It contains no authentication, RBAC,
tenant administration, provider, booking, dispatch, payment, migration/cutover, business, or legacy
route.

## 2. Deliverables

| Gate 2 deliverable                   | Implementation                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Isolated NestJS/TypeScript workspace | `backend-v2/`, strict ESM TypeScript, exact lockfile                                                                                                                     |
| Clean Architecture boundaries        | Layered source, ESLint restrictions, AST architecture test                                                                                                               |
| Runtime entry points                 | `apps/api`, `apps/worker`, `apps/outbox-relay`, `apps/migration`                                                                                                         |
| Local/CI dependencies                | PostgreSQL/PostGIS, isolated Redis cache/queue, Kafka, MinIO Compose services                                                                                            |
| Runtime foundation                   | Fail-closed config, Pino redaction, allowlisted OTel, metrics, probes, request context, stable errors, UUIDv7/clock, unit of work, lazy clients, Opossum factory         |
| Migration foundation                 | Explicit advisory-locked runner, `synchronize: false`, expected-version precondition, checksums/evidence, forward-only governance/RLS/outbox/inbox/job-intent migrations |
| Delivery gates                       | Jest, Postman/Newman, production Dockerfile, dependency audit, CI integration/image/SBOM/Trivy jobs                                                                      |
| Security review input                | `docs/threat-model.md`                                                                                                                                                   |

## 3. Executed evidence

| Check                                              | Result                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm ci --ignore-scripts`                          | PASS — clean lockfile install, 745 packages audited                                             |
| `npm run format:check`                             | PASS                                                                                            |
| `npm run lint`                                     | PASS, zero warnings                                                                             |
| `npm run typecheck`                                | PASS                                                                                            |
| `npm run build`                                    | PASS                                                                                            |
| `npm run test:unit`                                | PASS — 6 suites, 18 tests                                                                       |
| `npm run architecture`                             | PASS — 1 suite, 2 tests                                                                         |
| `npm run security:audit`                           | PASS — production graph has 0 vulnerabilities                                                   |
| Complete `npm audit`                               | REVIEWED — 4 low, 35 moderate, 0 high, 0 critical; all findings are in development/test tooling |
| `npm run docker:config`                            | PASS                                                                                            |
| Source API bootstrap with dependencies unavailable | PASS — process starts, liveness is 200, readiness is 503                                        |
| Compiled API bootstrap                             | PASS — built entry point returns API liveness 200                                               |
| Source worker and relay bootstrap                  | PASS — role-specific liveness returns 200 on ports 3001/3002                                    |
| `npm run postman:health:outage`                    | PASS — 5 requests, 11 assertions, 0 failures                                                    |
| Postman artifacts                                  | PASS — collection/environment parse as JSON; no credentials or production data                  |

The source bootstrap originally depended on emitted constructor metadata that `tsx` does not
provide. Every Nest-managed constructor now declares explicit injection tokens, and the API, worker,
and relay source entry points were exercised successfully.

Newman currently depends on a Postman SDK that pins vulnerable Faker 5. The lockfile forces patched
Faker 10, while `tools/newman-faker-compat.cjs` supplies a narrow load-time compatibility layer. The
Gate 2 collection uses no Faker dynamic variables; unsupported legacy generators throw. This keeps
the full graph free of high/critical advisories without hiding a broken Newman run. The remaining
moderate/low findings are transitive ESLint, Jest, and Newman toolchain advisories and require routine
upgrade review; none is present in the production dependency graph.

## 4. Blocked mandatory evidence

The Docker client and Compose parser are installed, but the daemon is unavailable:

```text
Cannot connect to the Docker daemon at unix:///Users/manjilbhandari/.docker/run/docker.sock.
Is the docker daemon running?
```

Consequently, these Gate 2 checks are implemented but **not executed on this host**:

1. migrations from an empty database;
2. upgrade from the prior migration fixture and retained-data check;
3. RLS enforcement under the non-owner API identity;
4. real PostgreSQL, isolated Redis, Kafka, BullMQ, and MinIO integration;
5. healthy-readiness Newman run;
6. production image build/runtime verification, SPDX SBOM generation, and Trivy image scan.

`.github/workflows/backend-v2.yml` defines these jobs for a Docker-capable GitHub runner. A successful
workflow run and retained reports/digests must be attached before Gate 2 approval; workflow
definition is not evidence of execution.

## 5. Gate 2 decision matrix

| Criterion                             | State                                                     |
| ------------------------------------- | --------------------------------------------------------- |
| Clean build/lint/typecheck/unit tests | PASS                                                      |
| Architecture tests                    | PASS                                                      |
| Dependency-failure behavior           | PASS                                                      |
| Migration from zero and prior fixture | BLOCKED — Docker daemon unavailable                       |
| Real dependency and RLS integration   | BLOCKED — Docker daemon unavailable                       |
| Image scan and SBOM                   | BLOCKED — Docker daemon unavailable                       |
| No business/legacy route cutover      | PASS                                                      |
| Threat model                          | PREPARED — independent security/operations review pending |

## 6. Review conditions and residual risks

Gate 2 remains on hold until:

- every blocked Docker/CI check passes on the exact lockfile and source revision;
- high/critical dependency and image findings remain zero or receive explicit blocking disposition;
- security and operations reviewers approve `docs/threat-model.md` and the database-role/migration
  model;
- evidence identifies the image digest, SBOM, migration result/checksums, Newman report, and scan
  results.

The following are explicit later controls, not claims made by this foundation: production hosting,
residency, retention, SLO/DR, secrets/workload identity, ingress restriction for `/metrics`, OTel URL
attribute scrubbing before sensitive routes, Kafka/topic ACLs, provider approvals, and all Phase 3+
identity/business/cutover controls.

**Recommendation:** do not begin Phase 3 and do not approve Gate 2 until the blocked evidence and
named reviews are complete.
