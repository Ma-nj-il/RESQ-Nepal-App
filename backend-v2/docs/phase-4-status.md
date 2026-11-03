# Phase 4 / Gate 4 status

> The local test counts and Docker limitations below are historical. See
> [current infrastructure-backed CI evidence](ci-evidence-2026-11-03.md) for subsequent results.

- **Disposition:** HOLD — implementation is available for review; Gates 2–4 are not passed
- **Evidence date:** 2026-11-03
- **Scope:** provider registry, organization/facility activation, workforce, fleet/readiness, private
  documents, transactional event/job intent, and administrative projections
- **No cutover:** no legacy route, client, data source, object bucket, or production workflow has moved

## Implemented scope

The subsequent [document-worker implementation](document-workers.md) adds migration 0006,
shared execution fencing, restricted personal/tenant document access, scan/expiry/readiness
processors, S3/ClamAV adapters, and targeted PostgreSQL/concurrency tests. The tables below retain
historical Phase 4 evidence; consult the linked worker notes and exact-revision CI results for the
new work. Provider/staging acceptance and Gate 4 remain open.

| Area              | Implementation                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider registry | Applicant draft/submission/withdrawal, province information/recommendation/rejection, separate platform approval, atomic organization/facility/membership/admin activation |
| Workforce         | Driver applications, independent review, tenant affiliation, verification/account/duty dimensions, eligibility reasons                                                     |
| Fleet             | Ambulance registration, authority compliance review, operational status, equipment, maintenance, readiness reasons, assignment-safe status guards                          |
| Documents         | Private grant contract, provider metadata verification, scan/quarantine state, independent review, short audited download grant, expiry and readiness job intent           |
| Isolation         | Forced RLS, composite tenant ownership, exact facility-geography/driver-affiliation authority checks, append-only review evidence                                          |
| Delivery          | Domain events and deterministic durable job intents are written in the same PostgreSQL transaction as business state                                                       |
| Projections       | Tenant and authority provider/facility, driver, ambulance, application, and document HTTP projections                                                                      |
| Providers         | Production-default object storage and malware scanner adapters fail closed until approved implementations are configured                                                   |

## Executed evidence on this host

| Check                                   | Result                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Format check and ESLint                 | PASS — zero warnings                                                                                                      |
| TypeScript typecheck and build          | PASS                                                                                                                      |
| Jest suites                             | PASS — 15 suites / 54 tests; 2 Docker integration suites / 7 tests skipped by explicit gate                               |
| Architecture test                       | PASS — 1 suite / 2 tests                                                                                                  |
| Production dependency audit             | PASS — 0 vulnerabilities                                                                                                  |
| Compose configuration parse             | PASS                                                                                                                      |
| Postman artifacts                       | PASS — health, identity/access, provider operations, and local environment parse as JSON                                  |
| Embedded PostgreSQL migration debugging | PASS — all four migration SQL artifacts parse and execute from empty with temporary PGlite tooling outside the repository |

Embedded PGlite execution is SQL debugging evidence only. Node 24.12 requires
`--no-wasm-tier-up` for this temporary run because its default WebAssembly tier-up crashes inside V8;
all four migrations execute with tier-up disabled. PGlite does not prove supported PostgreSQL roles,
forced RLS, PostGIS, or concurrency.

Focused Phase 4 unit coverage includes lifecycle matrices, readiness dimensions, document currentness,
provider and document segregation of duties, platform-only final approval, fail-closed providers,
immutable upload metadata mismatch, and authority-grant audit binding.

## Implemented but not executed here

- supported PostgreSQL/PostGIS migration from empty and prior fixtures;
- non-owner cross-tenant, cross-facility, cross-geography, and document-content RLS integration suite;
- provider approval, document expiry/readiness, and concurrent version races on real PostgreSQL;
- healthy-stack provider-operations Newman flow;
- object policy, immutable upload, malware corpus, quarantine, content-disposition, and grant-expiry tests;
- image build/runtime, SBOM, and Trivy evidence.

The Docker daemon is unavailable on this host. These checks remain blocked rather than reported as
passing.

## External Gate 4 blockers

1. Gates 2 and 3 must pass on the exact source revision and production database roles.
2. Security, legal/privacy, and operations must approve object storage, malware scanning, encryption/
   KMS, residency, retention, deletion/legal-hold, MIME/content-disposition, and provider egress.
3. Segregation-of-duty policy, required evidence catalog, ambulance equipment baseline, and readiness
   rules need accountable operations/security approval.
4. Production provider/facility organization grouping and province/platform reviewer authority need
   owner-supplied evidence; implementation must not infer them from names.
5. Initial administrative clients need persona acceptance and must not add UI-side authorization.
6. No critical/high application, database, object-policy, or provider finding may remain unresolved.

**Recommendation:** keep Gate 4 on hold. Do not enable production document upload or provider
activation until every blocked test and accountable approval is attached to the exact release.
