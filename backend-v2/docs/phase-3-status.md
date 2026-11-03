# Phase 3 / Gate 3 status

> The local test counts and Docker limitations below are historical. See
> [current infrastructure-backed CI evidence](ci-evidence-2026-11-03.md) for subsequent results.

- **Disposition:** HOLD — implementation is available for review; Gate 2 and Gate 3 are not passed
- **Evidence date:** 2026-11-03
- **Scope:** identity, tenancy foundations, custom RBAC, authority grants, sessions/MFA, RLS, audit,
  idempotency, HTTP contracts, and local Postman contracts
- **No cutover:** no legacy route, client, data source, or production identity path has moved

## Implemented scope

| Area       | Implementation                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity   | Users/profiles/identities, Nepal phone normalization, OTP challenge and registration/login                                                              |
| Sessions   | Ed25519 access tokens/JWKS, opaque HMAC-digested refresh families, one-time rotation, reuse/family revocation, idle/absolute expiry                     |
| MFA        | Argon2 administrative password verification, encrypted TOTP enrollment, monotonic replay guard, login challenge, time-bounded AAL2 step-up              |
| Tenancy    | Provider organization/facility/geography foundations and active memberships                                                                             |
| RBAC       | Permission catalog → roles → role profiles → expiring user assignments, delegation ceilings, optimistic versions                                        |
| Authority  | Explicit province/platform grants, geography/resource/data capabilities, active ancestor chain, dual approval, revocation, root-grant runtime rejection |
| Isolation  | Forced RLS, composite ownership keys, transaction-local context, caller/target-bound security-definer functions, narrowed function grants               |
| Governance | Transactional audit writes, idempotent command records, stable HTTP errors and success envelopes                                                        |
| Contracts  | Authentication, self/session/access-context, tenant access administration, and authority grant controllers; no Swagger/OpenAPI runtime                  |

Production OTP delivery intentionally remains unavailable until an approved provider is configured.
Public OTP supports only `REGISTRATION_OR_LOGIN`; recovery and standalone OTP step-up are not exposed.

## Executed evidence on this host

| Check                                   | Result                                                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format check and ESLint                 | PASS — zero warnings                                                                                                                                                  |
| TypeScript typecheck and build          | PASS                                                                                                                                                                  |
| Unit suites                             | PASS — 13 suites / 42 tests covering identity/session, AAL2, refresh reuse/race, TOTP replay, delegation, authority dual control, idempotency, HTTP, and JWT rotation |
| Architecture test                       | PASS — 1 suite / 2 tests                                                                                                                                              |
| Production dependency audit             | PASS — 0 vulnerabilities                                                                                                                                              |
| Compose configuration parse             | PASS                                                                                                                                                                  |
| Postman artifacts                       | PASS — health, identity/access, and local environment parse as JSON                                                                                                   |
| Embedded PostgreSQL migration debugging | PASS — all three migration SQL artifacts parse and execute from empty using temporary PGlite tooling outside the repository                                           |

Embedded PostgreSQL is syntax/DDL debugging evidence only. It does not emulate production roles,
forced RLS behavior, supported PostGIS, concurrency, or the Docker/CI environment and therefore does
not satisfy Gate 2 or Gate 3 migration evidence.

## Implemented but not executed here

- migration from empty and prior fixture on the supported PostgreSQL/PostGIS image;
- non-owner identity/tenant cross-scope RLS, transaction-claim reset, internal function privilege,
  and parentless-authority rejection integration tests;
- healthy-stack identity Newman flow;
- refresh and access-revocation races on real PostgreSQL connections;
- image build/runtime, SBOM, and Trivy evidence.

The Docker daemon is unavailable on this host. These checks remain blocked rather than reported as
passing.

## External Gate 3 blockers

1. Gate 2 must pass on the exact source revision and lockfile.
2. Independent application/database security review and penetration-test remediation are required.
3. Production database roles and all `SECURITY DEFINER` ownership/execute grants require review.
4. JWT signing, refresh/OTP HMAC, and MFA encryption key custody and rotation drills require an
   approved secrets/KMS platform.
5. Production OTP provider, abuse controls, delivery status, privacy, and Nepal coverage require
   approval and sandbox/live evidence.
6. Browser/mobile secure token storage, CSRF/origin behavior, account recovery, and administrator
   enrollment require client/security acceptance.
7. The first parentless authority grant requires the reviewed bootstrap process and named approvers.
8. No critical/high security finding may remain unresolved.

**Recommendation:** keep Gate 3 on hold and do not use this implementation for production identity
or authority until all blocked and external evidence is attached and approved.
