# Safety incident escalation drill

## Purpose and safety boundary

This drill proves incident creation, version/tier races, durable intents, stale-job suppression,
projection isolation, and truthful delivery failure. It does **not** prove emergency contact delivery
until an approved provider, recipient policy, and human fallback are configured.

Run only in an approved nonproduction environment with synthetic users, trip data, phone numbers, and
narratives. Never trigger real emergency services or use production patient/location data. Name the
exercise controller, dispatch operations lead, security observer, platform operator, and abort owner.

## Preconditions

- exact source revision, migration checksum, environment, time window, and cleanup owner recorded;
- supported PostgreSQL/PostGIS, isolated Redis queue, Kafka topics/ACLs, API, worker, and relay healthy;
- one active synthetic booking/trip with exact tenant/facility, requester, assigned driver, ambulance,
  responder permission, and tracking relationships;
- clocks synchronized and observers able to inspect safe outbox/job/audit metadata;
- current expected outcome explicitly states that alert provider delivery fails closed;
- no production endpoint, credential, device binding, phone, email, or push token is present.

Abort if environment identity is ambiguous, any real recipient could be contacted, tenant isolation
fails, a second assignment appears, or logs/events expose narrative or coordinates.

## Exercise

1. Record the active trip/booking/tenant/facility IDs and versions. Submit one bound synthetic `SOS`,
   `CRITICAL` incident with a unique idempotency key.
2. Repeat the same request/key and prove one incident, one initial transition, a replayed response, one
   deterministic tier-0 alert intent, and one version-bound escalation intent.
3. Verify the incident event contains type/severity/status/tier only; it must not contain the protected
   narrative, patient data, coordinates, contact details, token, or provider URL.
4. Race a scoped responder acknowledgement at version 1 against the due automatic escalation for
   version 1/tier 0. Exactly one version-changing action may win. The loser must be stale/no-op.
5. In a second synthetic incident, allow the automatic deadline to advance tier 0 → 1, then verify a
   new deterministic alert intent and next version-bound escalation intent are committed.
6. Resolve that incident while an older alert/escalation job is delayed. On release, both stale jobs
   must re-read state and return `NO_OP_CURRENT_STATE`; they must not contact a provider or reopen it.
7. Confirm the unavailable provider produces a retryable failure and never an `ALERT_DELIVERED` result.
   After bounded attempts, evidence must remain linked to the durable intent for operator review.
8. As an unrelated user, tenant, facility, and authority grant, attempt incident/tracking reads. Each
   must be denied with not-found equivalence or a scoped authorization denial and no payload leakage.
9. Confirm creator, exact tenant/facility, and correctly scoped authority projections expose only their
   approved fields. Resolve all synthetic incidents and retain/delete drill data only under policy.

## Pass criteria

- idempotency creates one incident and stable replay;
- acknowledgement/escalation race has one winner and monotonic version/tier;
- tier never decreases or exceeds 5; resolved state is terminal;
- stale alert/escalation work is a no-op after acknowledgement/resolution/version change;
- every business change has matching append-only incident, audit, outbox, and job-intent evidence;
- no cross-scope read and no restricted data in events/logs/traces;
- unavailable delivery is visibly failed/retryable, never represented as delivered;
- measured creation, queue, escalation, projection, and recovery latency is captured without claiming
  an SLO that has not been approved.

## Evidence record

```text
Exercise/change ID and environment:
Exact revision and migration checksum:
Controller / operations / security / platform / abort owners:
Synthetic booking/trip/incident IDs:
Creation and idempotency result:
Ack/escalation race result:
Tier progression and stale-job results:
Outbox/job-intent reconciliation:
Unavailable-provider result:
Cross-scope negative results:
Restricted-data inspection:
Measured latency/backlog:
Findings and owners:
Decision: PASS FOR IMPLEMENTATION | HOLD | ABORTED
```

A successful implementation drill is only one Gate 5 artifact. Production provider canaries,
recipient/fallback approval, capacity testing, penetration/security review, and an operations-led live
simulation remain separately required.
