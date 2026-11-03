# RESQ Nepal backend rebuild — Phase 0/1 approval package

- **Status:** proposed architecture; implementation is intentionally blocked
- **Baseline audited:** `8c2827a9980f0b292cddc17783ee95e292fc88ab`
- **Prepared:** 2026-11-03
- **Target:** production-grade, multitenant NestJS platform

This directory contains the completed Phase 0 discovery and Phase 1 architecture work. It does
not claim that the target backend exists. No NestJS source, package, database migration,
infrastructure manifest, or generated API artifact has been added in this phase.

## Reading order

1. [Phase 0 discovery](./phase-0-discovery.md)
2. [Phase 0 API and schema inventory](./phase-0-api-schema-inventory.md)
3. [Phase 1 architecture](./phase-1-architecture.md)
4. [Tenancy, RBAC, and security](./phase-1-tenancy-rbac-security.md)
5. [Data model and lifecycles](./phase-1-data-model-and-lifecycles.md)
6. [HTTP and realtime API contract](./phase-1-api-contract.md)
7. [Kafka events, BullMQ jobs, and integrations](./phase-1-events-jobs-integrations.md)
8. [Operations and testing](./phase-1-operations-testing.md)
9. [Migration roadmap and approval gates](./migration-roadmap-and-approval.md)

## Executive recommendation

Build a **modular NestJS platform** with four runtime entry points—stateless API, background worker,
outbox relay, and migration job—from one Clean Architecture codebase. The three long-running roles
scale independently. Keep domain boundaries extractable, but do not reproduce the legacy
repository's nominal 13-service topology before load and team boundaries justify it.

The target stack is:

- NestJS and TypeScript;
- PostgreSQL/PostGIS with TypeORM repositories and forward-only migrations;
- Redis for bounded caching, distributed rate limits, ephemeral coordination, and BullMQ;
- Kafka for durable domain integration, backed by a transactional outbox and consumer inbox;
- BullMQ for delayed and operational work, not as a second domain-event bus;
- Opossum around outbound provider calls;
- Pino structured logging and OpenTelemetry-compatible traces/metrics;
- short-lived asymmetric JWT access tokens with rotating signing keys plus one-time rotating
  refresh-token families;
- custom, data-driven RBAC in the hierarchy **Permissions → Roles → Role Profiles → Users**;
- Jest at every test layer, Docker for reproducible environments, and Postman/Newman for external
  API acceptance tests;
- Markdown and Postman as the API documentation artifacts—**no Swagger or OpenAPI runtime**.

## Proposed tenant model

The tenant root is a **provider organization**. A provider organization owns one or more
facilities (hospitals or operating bases). A hospital is therefore a facility, not automatically
a tenant boundary.

Province and platform operators do not become magical cross-tenant users. They receive explicit,
time-bounded authority grants constrained by geography, resource type, action, and purpose. Every
request still passes permission and scope checks and is audited.

This resolves three incompatible source assumptions:

- the mobile/Supabase model has users, drivers, ambulances, hospitals, and globally visible pending
  bookings, but no provider tenant;
- the Go API exposes broad global/admin data and has no consistent tenant key;
- the portals model hospitals and provinces as isolation boundaries using local/mock enforcement.

## Non-negotiable invariants

1. Tenant identity is derived from authenticated server-side access assignments, never trusted
   from a request body or header alone.
2. Every tenant-owned row has a non-null `tenant_id`; every facility-owned row also has a non-null
   `facility_id` and cross-tenant relationships use composite foreign keys.
3. PostgreSQL row-level security is defense in depth; application guards and scoped repositories
   remain mandatory.
4. Authorization is deny-by-default and evaluates permission, role profile, tenant/facility scope,
   authority grant, resource state, and actor relationship.
5. Booking/trip transitions occur only through named commands in a transaction with optimistic or
   pessimistic concurrency control. Generic status patching is forbidden.
6. State changes, outbox records, and required BullMQ job intents commit atomically. Kafka delivery
   is at-least-once and all consumers/processors are idempotent.
7. Monetary amounts use integer minor units and ISO currency codes. Nepal defaults to `NPR`; no
   production path silently defaults to `USD`.
8. Identity and compliance files are private objects; API responses expose metadata and short-lived
   authorized download URLs only.
9. Portal mock records are workflow evidence, never migration data.
10. TypeORM `synchronize` is disabled in every environment, including tests that exercise
    migrations.

## Approval decisions

Implementation must not begin until the accountable owners decide the following.

| ID | Decision | Recommendation | Required approver |
|---|---|---|---|
| A-01 | Tenant root | Provider organization; hospital as facility | Product + security |
| A-02 | Province/platform access | Explicit authority grants; no global-admin bypass | Security + operations |
| A-03 | Deployment boundary | Modular API, worker, outbox-relay, and migration runtime roles | Engineering |
| A-04 | Source precedence | Canonical target model; no source is copied wholesale | Product + data owner |
| A-05 | Identity migration | Re-authenticate; do not migrate active sessions or passwords | Security + product |
| A-06 | Dispatch lifecycle | Adopt the canonical lifecycle and mappings in the data-model document | Operations + product |
| A-07 | Initial scope | Core emergency dispatch first; defer speculative legacy features | Product |
| A-08 | Maps/routing provider | Production provider and data-processing terms | Product + legal |
| A-09 | SMS/push/storage providers | Select providers and Nepal delivery/residency constraints | Security + operations |
| A-10 | Payments | Cash-first; eSewa/Khalti only after commercial/security approval | Finance + product |
| A-11 | DVR808 | Treat as optional pilot until real-device verification is complete | Operations + security |
| A-12 | Retention/SLO/DR values | Ratify proposed service and data-retention objectives | Operations + legal |
| A-13 | Mobile cutover | Minimum target-API app version plus bounded write freeze/final delta | Mobile + product + operations |
| A-14 | Hosting/residency | Select managed regions/services, KMS, telemetry, and egress controls | Security + legal + operations |
| A-15 | Data conflicts | New IDs/legacy maps; reviewed quarantine, no automatic identity/tenant merge | Data + product + security |

The complete gates and acceptance criteria are in
[migration-roadmap-and-approval.md](./migration-roadmap-and-approval.md).

## Source labels used in this package

| Label | Audited source | Notes |
|---|---|---|
| `MOBILE` | repository root `src/`, `supabase/`, and existing `docs/` | Present in baseline commit |
| `GO` | `backend/` | Present in baseline commit |
| `PROVINCE` | primary working copy `resq-nepal-mobile/Province admin panel/` | Read-only; contains user work not present in this worktree |
| `HOSPITAL` | primary working copy `resq-nepal-mobile/Hospital admin panel/` | Read-only; contains user work not present in this worktree |
| `SUPER` | primary working copy `resq-nepal-mobile/Super admin panel/` | Read-only; contains user work not present in this worktree |

The portal paths are recorded for provenance only. This branch does not copy, normalize, or mutate
those sources.

## Phase boundary

The next permitted action after approval is the foundation slice described in the roadmap. Until
then, the legacy backend, Supabase schema, mobile data path, and all three portals remain unchanged.
