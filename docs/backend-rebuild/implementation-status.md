# Backend rebuild delivery status

Evidence date: **2026-11-04**. Implementation and acceptance are tracked separately. Production
client/traffic/data migration is **0%**.

| Phase | Repository delivery                                                                                             | Acceptance gate                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 0–1   | Discovery, architecture, actor/data/operations model and approval roadmap                                       | Historical implementation authorization does not replace missing owner decision records                               |
| 2     | NestJS API/worker/relay/migration foundation, CI, observability and dependency boundaries                       | HOLD: capacity, restore, operational and independent security acceptance                                               |
| 3     | Identity, OTP/password/MFA, rotating sessions, tenancy/RBAC/authority and RLS                                   | HOLD: full infrastructure/security review and drills                                                                  |
| 4     | Registry/workforce/fleet/documents/readiness, scoped APIs, execution-bound document/compliance workers and S3/ClamAV adapters | HOLD: provider deployment, persona/segregation, object/expiry/race acceptance |
| 5     | Dispatch/trips/cancellation/tracking/safety, jobs/events, consistent recovery and requester realtime delivery | HOLD: real races/outages/capacity/SOS simulation; other realtime audiences remain open |
| 6     | Preferences, support, ratings, cash/reconciliation, notification inbox, mobile API/session, secure command recovery and mutation preview | HOLD: complete mobile/portal production flows, provider integrations, device/accessibility/offline/persona acceptance |
| 7     | Strict metadata reconciliation, deterministic IDs, encrypted checkpoint ledger and independent-rerun comparison | HOLD: actual extracts/mappings/transforms, managed KMS/transaction-bound execution ledger, full-volume migrations, client releases |
| 8     | Fail-closed readiness evaluator, one-writer/full-drain checks, controlled-cutover/stabilization runbook         | HOLD: actual authorized execution and stabilization                                                                   |

## Current implementation entry points

- [Infrastructure-backed CI evidence](../../backend-v2/docs/ci-evidence-2026-11-03.md)
- [Document workers, S3/ClamAV adapters, and acceptance boundaries](../../backend-v2/docs/document-workers.md)
- [Consistent requester recovery snapshots and mobile lifecycle recovery](../../backend-v2/docs/dispatch-recovery.md)
- [Requester realtime delivery and deployment boundaries](../../backend-v2/docs/requester-realtime.md)
- [Mobile API foundation and development build instructions](mobile-api-foundation.md)
- [Memory-only mobile MFA enrollment](mobile-mfa-enrollment.md)
- [Password/TOTP mobile sign-in and cancellation](mobile-password-sign-in.md)
- [Authenticated mobile MFA step-up](mobile-mfa-step-up.md)
- [Phase 6 implementation and evidence](../../backend-v2/docs/phase-6-status.md)
- [Phase 7 executable preparation](../../backend-v2/docs/phase-7-status.md)
- [Phase 8 executable preparation and runbook](../../backend-v2/docs/phase-8-status.md)
- [Roadmap and approval gates](migration-roadmap-and-approval.md)

The available code work does not make every phase complete. External inputs remain necessary;
the phase status documents identify them. Local synthetic checks must not be used as production
acceptance evidence. Git publication is code delivery, not a deployment or cutover.

All backend and mobile CI jobs pass at `75759cc`, including corrected Kafka startup/two-replica
fanout, supported-PostgreSQL integration, Newman, image checks and all-platform mobile exports.
That revision has 196 backend / 179 mobile tests. Password/TOTP sign-in adds strict AAL2/mobile
decoding, secret-free state, lifecycle cancellation and storage/listener fencing. Authenticated
step-up now has component-owned challenges, expiry, cancellation and definitive code correction
without unintended logout; its local mobile suite passes 179 tests, lint and typecheck.
The next backend slice adds eight real-service PostgreSQL identity cases and migration 0007 for
truthful authentication-method preservation. Backend run 41765374995 passes all three jobs at
`ed95b06`, including migration/dependency/Newman and image evidence. Provider
acceptance, managed storage/KMS, production clients and source-specific execution remain open.
Gates remain HOLD.
