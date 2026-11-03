# RESQ Nepal backend v2

This directory contains the isolated NestJS/TypeScript rebuild. The platform foundation, Phase 3
identity/access slice, and Phase 4 provider registry, workforce, fleet, and private-document slice
are present. No legacy route or production workflow has been cut over. Gates 2–4 remain **HOLD**
until the blocked infrastructure-backed, provider, and independent review evidence is approved.

## Runtime roles

| Role          | Entry point                 |            Health port |
| ------------- | --------------------------- | ---------------------: |
| API           | `apps/api/main.ts`          |       HTTP port `3000` |
| Worker        | `apps/worker/main.ts`       |                 `3001` |
| Outbox relay  | `apps/outbox-relay/main.ts` |                 `3002` |
| Migration job | `apps/migration/main.ts`    | exits after migrations |

The worker and relay currently provide lifecycle, dependency readiness, and observability plumbing;
durable document/compliance job intents are written, but no business processor is enabled yet.

## Implemented API surface

- OTP registration/login, administrative password + TOTP challenge, TOTP enrollment and step-up;
- Ed25519 access JWT/JWKS, rotating opaque refresh-token families, reuse detection, and session
  revocation;
- self profile, session, and resolved access-context reads;
- tenant permission, role, role-profile, and time-bounded assignment administration;
- province/platform authority grant creation, independent approval, revocation, and bounded scope;
- PostgreSQL RLS for identity, tenant, assignment, authority, audit, and idempotency data.
- provider application review with province recommendation, separate platform approval, and atomic
  organization/facility activation;
- driver affiliation/verification, independent account/duty dimensions, ambulance compliance,
  equipment, maintenance, and computed readiness;
- private document upload/finalization/scan/review/download/expiry contracts with storage and malware
  providers deliberately unavailable until approved adapters are configured;
- tenant and authority provider/facility/workforce/fleet projections with facility-exact RLS.

Public OTP accepts only `REGISTRATION_OR_LOGIN`. Local development uses the synthetic fixed code
configured in `docker/local.env`; production rejects a fixed code and delivery remains fail-closed
until an approved provider adapter is installed.

## Local verification

Requires Node 24 and Docker:

```bash
npm ci
docker compose up -d --wait
npm run migration:run:local
npm run dev:api:local
```

In another terminal:

```bash
npm run postman:health
npm run postman:identity
npm run postman:provider-operations
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:unit
RUN_INTEGRATION=1 node --env-file=docker/local.env --experimental-vm-modules \
  ./node_modules/jest/bin/jest.js --selectProjects integration --runInBand
```

Use `npm run postman:health:outage` while dependencies are unavailable to verify that liveness stays
up and readiness fails closed. Newman is launched through a narrow compatibility preload because its
current Postman SDK pins a vulnerable Faker 5 API; the lockfile instead forces patched Faker 10. The
versioned collection uses no Faker dynamic variables, and unsupported legacy generators fail closed.

Local credentials in `docker/local.env` are synthetic and must never be reused outside local/CI.
Production configuration rejects plaintext dependencies, localhost, wildcard CORS, shared Redis
cache/queue URLs, pretty logs, and a migration without an expected prior version and operator.

## Architecture boundaries

- `domain` imports no framework or infrastructure package.
- `application` depends on domain and declared ports only.
- TypeORM, Redis, Kafka, Opossum, Pino, and HTTP implementations remain in `infrastructure` or
  `presentation`.
- Architecture is enforced by targeted ESLint rules and `test/unit/architecture.spec.ts`.
- TypeORM synchronization and automatic migration-on-start are disabled in every runtime.

See `docs/phase-2-status.md`, `docs/phase-3-status.md`, `docs/phase-4-status.md`, and
`docs/threat-model.md` for gate evidence, blocked checks, and known limitations. Root authority
creation is restricted to the reviewed process in `docs/runbooks/authority-root-bootstrap.md`.
