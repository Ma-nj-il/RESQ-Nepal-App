# Backend rebuild delivery status

Evidence date: **2026-11-03**. Implementation and acceptance are tracked separately. Production
client/traffic/data migration is **0%**.

| Phase | Repository delivery                                                                                             | Acceptance gate                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 0–1   | Discovery, architecture, actor/data/operations model and approval roadmap                                       | Historical implementation authorization does not replace missing owner decision records                               |
| 2     | NestJS API/worker/relay/migration foundation, CI, observability and dependency boundaries                       | HOLD: real dependency/image/security/operations evidence                                                              |
| 3     | Identity, OTP/password/MFA, rotating sessions, tenancy/RBAC/authority and RLS                                   | HOLD: full infrastructure/security review and drills                                                                  |
| 4     | Registry/workforce/fleet/documents/readiness and scoped administrative APIs                                     | HOLD: providers, persona/segregation, object/expiry/race acceptance                                                   |
| 5     | Dispatch/trips/cancellation/tracking/safety, jobs/events and recovery                                           | HOLD: real races/outages/capacity/SOS simulation; realtime delivery remains open                                      |
| 6     | Preferences, support, ratings, cash/reconciliation, notification inbox, mobile API/session, secure command recovery and mutation preview | HOLD: complete mobile/portal production flows, provider integrations, device/accessibility/offline/persona acceptance |
| 7     | Strict offline metadata reconciliation, deterministic ID helper, source accounting and evidence tooling         | HOLD: actual extracts/mappings/transforms, durable encrypted ledger, repeated full-volume migrations, client releases |
| 8     | Fail-closed readiness evaluator, one-writer/full-drain checks, controlled-cutover/stabilization runbook         | HOLD: actual authorized execution and stabilization                                                                   |

## Current implementation entry points

- [Mobile API foundation and development build instructions](mobile-api-foundation.md)
- [Phase 6 implementation and evidence](../../backend-v2/docs/phase-6-status.md)
- [Phase 7 executable preparation](../../backend-v2/docs/phase-7-status.md)
- [Phase 8 executable preparation and runbook](../../backend-v2/docs/phase-8-status.md)
- [Roadmap and approval gates](migration-roadmap-and-approval.md)

The available code work does not make every phase complete. External inputs remain necessary;
the phase status documents identify them. Local synthetic checks must not be used as production
acceptance evidence. Git publication is code delivery, not a deployment or cutover.

Remote CI at `9117464` passes mobile validation/exports. At `b05fe8d`, backend quality, all PostgreSQL
migration/dispatch/product/RLS and dependency integration suites, and Newman health pass. Image build,
hardened smoke and SBOM pass; Trivy now runs and blocks vulnerable dependencies in bundled npm.
Runtime-tooling removal and the failing dispatch/product Newman collection are under remediation.
Local durable-command validation passes 128 tests and all development/release exports. Gates remain HOLD.
