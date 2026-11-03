# RESQ Nepal backend v2 — Phase 2 foundation

This directory is an isolated NestJS/TypeScript foundation. It does **not** cut over a legacy route
or implement a business workflow. Gate 2 review is required before Phase 3 begins.

## Runtime roles

| Role          | Entry point                 |            Health port |
| ------------- | --------------------------- | ---------------------: |
| API           | `apps/api/main.ts`          |       HTTP port `3000` |
| Worker        | `apps/worker/main.ts`       |                 `3001` |
| Outbox relay  | `apps/outbox-relay/main.ts` |                 `3002` |
| Migration job | `apps/migration/main.ts`    | exits after migrations |

The worker and relay currently provide lifecycle, dependency readiness, and observability plumbing;
they intentionally process no business messages in Phase 2.

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

See `docs/phase-2-status.md` and `docs/threat-model.md` for Gate 2 evidence and known limitations.
