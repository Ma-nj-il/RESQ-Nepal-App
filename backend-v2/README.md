# RESQ Nepal backend v2

This directory contains the isolated NestJS/TypeScript rebuild. The platform foundation, Phase 3
identity/access, Phase 4 provider operations, Phase 5 core dispatch/safety, and the initial Phase 6
product-services slices are present. No legacy route or production workflow has been cut over.
Gates 2–6 remain **HOLD** until the blocked
infrastructure-backed, provider, capacity, operations, and independent review evidence is approved.

Offline migration reconciliation and cutover-readiness tooling are now available. See
[Phase 7](docs/phase-7-status.md), [Phase 8](docs/phase-8-status.md), and the
[overall delivery status](../docs/backend-rebuild/implementation-status.md). Gates 7–8 also remain
HOLD; these tools do not authorize or perform production migration.

## Runtime roles

| Role          | Entry point                 |            Health port |
| ------------- | --------------------------- | ---------------------: |
| API           | `apps/api/main.ts`          |       HTTP port `3000` |
| Worker        | `apps/worker/main.ts`       |                 `3001` |
| Outbox relay  | `apps/outbox-relay/main.ts` |                 `3002` |
| Migration job | `apps/migration/main.ts`    | exits after migrations |

The relay publishes ordered transactional outbox events to Kafka. The worker reconciles durable job
intents into BullMQ and processes offer/search deadlines and safety alert/escalation policy. Document/
compliance processors remain unavailable. Redis/Kafka state is never authoritative over PostgreSQL.

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
- coverage checks and NPR fare quotes, protected booking creation/search, tenant offers,
  contention-safe acceptance, assignment, and server-resolved cancellation actors;
- every named trip milestone, completion evidence, atomic resource release, timeline projections,
  serialized location ingestion, capture-time freshness, and relationship-bound tracking reads;
- encrypted SOS/safety incidents, acknowledgement/escalation/resolution races, durable safety jobs,
  ordered outbox publication, and stale-job suppression;
- 24 versioned Phase 5 event schemas/examples plus local requester/safety Postman contracts.
- notification preferences, requester ratings, encrypted support messages and named ticket transitions;
- exact-fare NPR cash collections, requester receipts, scoped completion-cohort cash reports, and
  owner-only in-app notifications;
- six product-service outbox schemas/examples (30 total) and additional local product Newman cases.

Public OTP accepts only `REGISTRATION_OR_LOGIN`. Local development uses the synthetic fixed code
configured in `docker/local.env`; production rejects a fixed code and delivery remains fail-closed
until an approved provider adapter is installed.

Routing uses a labelled development estimate unless an approved production implementation is added.
Safety alert delivery deliberately returns a retryable unavailable result; it never fabricates contact
success. Neither path is approved for production emergency operations.

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
npm run postman:core-dispatch
npm run contracts:events
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

See `docs/phase-2-status.md` through `docs/phase-6-status.md`, `docs/phase-6-product-api.md`, `docs/threat-model.md`, and
`docs/phase-5-transition-actor-matrix.md` for gate evidence, actor rules, blocked checks, and known
limitations. Root authority creation and dispatch/safety recovery are restricted to the reviewed
processes under `docs/runbooks/`.
