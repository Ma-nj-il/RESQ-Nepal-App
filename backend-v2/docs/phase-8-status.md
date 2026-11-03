# Phase 8 / Gate 8 status

- **Disposition:** HOLD — cutover readiness evaluator/runbook prepared; cutover and stabilization have not executed.
- **Evidence date:** 2026-11-03.
- **Production migration:** 0%. Legacy retirement is a separate approval.

## Readiness evaluator

`npm run readiness -- cutover INPUT.json NEW_REPORT.json` checks the strict contract in
`apps/migration-readiness/cutover.ts`. `test/fixtures/cutover-hold.synthetic.json` intentionally exits
`2`: it has no gate approvals or acceptance evidence.

The evaluator requires exactly one approval for Gates 1–7, a release commit, an incident commander,
fresh evaluation time, and unexpired passing evidence for security, capacity/SLO, providers, restore/DR,
migration rehearsal, final-delta reconciliation, minimum mobile version, portal personas, disabled
direct writes, drained active work, support communications, rollback drill and dispatch/SOS canaries.
It rejects missing/duplicate evidence, undeclared/duplicate writers, missing cohort coverage, future
writer boundaries, active legacy trips, critical/high issues and pre-write rollback after target writes.

The supported preparation path is **full drain**. Protected legacy-controlled resource reservations
and a target-to-legacy compensation bridge are not implemented; neither may be assumed available.
Writer epochs/boundaries are input evidence, not a live distributed write fence. Real policies/ingress
must enforce ownership and be independently verified.

Even complete input produces `READY_FOR_OWNER_REVIEW` and `productionAuthorized: false`. The tool
does not authenticate approvers, verify external signatures/artifact contents, deploy anything, change
feature flags/credentials, or certify that production is safe. Attach signed evidence and obtain the
roadmap's actual gate/go-no-go decisions.

## Controlled execution record

Use the [approved roadmap](../../docs/backend-rebuild/migration-roadmap-and-approval.md), sections 8–9,
as the authority. Before scheduling, fill in owners and artifact references for each row below.

| Order | Operator action                                                                      | Required evidence / stop condition                                                                            |
| ----- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1     | Confirm Gates 1–7, release hash, incident commander and run window                   | Signed decisions; all unresolved critical/high issues cleared                                                 |
| 2     | Communicate write freeze and enforce minimum mobile version                          | Old direct-Supabase writers verified disabled; portal/client versions recorded                                |
| 3     | Drain active legacy work                                                             | Zero active trips and resource conflicts; otherwise HOLD                                                      |
| 4     | Capture boundary positions, final consistent delta and object manifest               | Encrypted immutable exports and hashes; exact one-writer registry                                             |
| 5     | Execute reviewed transforms in isolated migration role                               | Versioned scripts, measured completion, no application-role bypass                                            |
| 6     | Reconcile source/ledger/target/object/finance and run post-load RLS/lifecycle checks | Every zero-tolerance invariant passes; signed exception decisions                                             |
| 7     | Reauthenticate canary users/operators; exercise booking/offer/trip/SOS               | Device/portal/provider evidence, audit/event/job traces and actual outcomes                                   |
| 8     | Obtain go decision and enable the approved target cohort                             | Record epoch/boundary/flag changes; prove one authoritative writer                                            |
| 9     | Monitor/reconcile throughout stabilization                                           | Approved SLO window, authorization failures, assignment/GPS/SOS health, provider outcomes and queue/event lag |
| 10    | Close stabilization and separately review retirement                                 | Owners accept business/security/finance evidence and retention/archive requirements                           |

Before target writes, rollback may restore approved routing/client versions. After target writes,
stop new affected mutations, restore dependencies or roll back compatible application code with the
expanded schema, then forward-fix idempotently. Do not route authoritative work back to legacy or
restore over post-boundary records without the separately rehearsed compensation/DR procedure.

## Gate 8 acceptance still missing

Gates 2–7 are not passed. No cutover authorization, client release, production snapshot, final delta,
canary, stabilization interval, restore/DR drill, independent security review or retirement evidence
was executed here. Infrastructure/credential/data deletion and legacy decommission have not begun.
