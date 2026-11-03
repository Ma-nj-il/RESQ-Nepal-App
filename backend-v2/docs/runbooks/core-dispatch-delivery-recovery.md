# Core dispatch delivery recovery runbook

## Purpose and boundary

Use this runbook when committed dispatch state is not reaching Kafka or BullMQ, or a core worker is
not completing durable job intents. PostgreSQL business state, outbox rows, and job intents remain the
correctness source. Kafka offsets and Redis queue state never authorize a booking, trip, resource
release, or safety outcome.

This document is not approval to change production data. Do not delete/rewrite outbox rows, advance
stream sequences, edit job-intent state, retry safety delivery manually, purge queues, disable RLS, or
replay a DLT without an approved incident/change record and owning-team review.

## Detect and classify

Record release/commit, environment, incident ID, first detection time, affected workflow and tenants,
dependency health, and on-call roles. Do not copy event payloads, patient data, coordinates, tokens,
or provider credentials into the incident record.

Use a separately authorized read-only operational identity for bounded metadata queries:

```sql
SELECT event_type, count(*) AS pending,
       min(occurred_at) AS oldest_occurred_at,
       max(publish_attempts) AS max_attempts
  FROM governance.outbox_events
 WHERE published_at IS NULL
 GROUP BY event_type
 ORDER BY oldest_occurred_at;

SELECT queue_name, job_type, state, count(*) AS intents,
       min(run_at) AS oldest_run_at, max(enqueue_attempts) AS max_enqueue_attempts
  FROM governance.job_intents
 WHERE state NOT IN ('SUCCEEDED','CANCELLED')
 GROUP BY queue_name, job_type, state
 ORDER BY oldest_run_at;
```

Classify independently:

1. **Kafka/relay:** unpublished outbox age/count grows; domain transactions still commit.
2. **Redis/job relay:** `PENDING`/expired `ENQUEUEING` grows; intent remains durable.
3. **Worker:** due `ENQUEUED`/stale `RUNNING` grows or attempts fail.
4. **Provider:** worker runs but approved external delivery fails; safety delivery is currently
   expected to fail closed because no provider is configured.
5. **Database:** API/worker/relay cannot establish their least-privilege connections; treat as the
   highest-severity dependency incident and stop claiming workflow availability.

Thresholds and paging windows remain pending the approved capacity/SLO decision. Do not invent them
during an incident.

## Containment

- Preserve PostgreSQL and broker evidence. Pause a consumer/replay only through the platform's
  approved deployment control and record the exact time and owner.
- If assignment/trip correctness is uncertain, stop new affected commands through the approved
  ingress/capability control; do not route writes to legacy or a second database.
- Keep liveness separate from readiness. Never mark readiness healthy to suppress an alert.
- For safety delivery degradation, follow the approved human fallback only. No fallback is approved
  in this revision, so the system must continue reporting failure/retry rather than contact success.

## Recovery by path

### Kafka/outbox

1. Restore broker reachability, topic ACLs, and producer authentication through platform controls.
2. Confirm all four Phase 5 topics exist and automatic creation remains disabled.
3. Restart/restore the outbox relay normally. It claims bounded rows and preserves per-stream order.
4. Expect possible duplicate publication if Kafka acknowledged before the publish marker committed;
   consumers must deduplicate by `eventId`.
5. Verify pending age/count returns to the pre-incident baseline and stream sequences have no
   unpublished predecessor blocking a later event.

### Redis/BullMQ/job intents

1. Restore the isolated queue Redis and normal worker/job-relay deployments.
2. Let reconciliation recover `PENDING`, expired `ENQUEUEING`, due stale `ENQUEUED`, and stale
   `RUNNING` intents using deterministic BullMQ IDs. Reconciliation deliberately does not demote
   active `RUNNING` state while registering a matching queue job.
3. Confirm BullMQ job name, ID, queue, and `jobIntentId` match the PostgreSQL intent. Any mismatch is
   a security/correctness incident; do not replace the row or job by hand.
4. Delayed processors re-read current state. `NO_OP_CURRENT_STATE` is a valid terminal result for
   obsolete expiry/escalation work.
5. A `FAILED` intent needs an audited, designed retry path; direct state edits are prohibited.

### Safety provider

The checked-in provider intentionally throws retryable `SAFETY.ALERT_PROVIDER_UNAVAILABLE`. Restore
only an independently approved adapter/configuration. Constructor success or a synthetic response is
not delivery evidence. Validate a provider acknowledgement and the approved escalation/fallback drill
before enabling live safety traffic.

## Verification and closure

- Reconcile booking/offer/assignment/trip state in PostgreSQL before checking projections.
- Verify each affected stream publishes in sequence and consumers deduplicate any repeats.
- Verify each due intent is terminal, safely delayed, or explicitly owned; stale work must not mutate
  terminal bookings/trips/incidents.
- Run synthetic booking/acceptance/trip and bound-SOS checks in the approved nonproduction
  environment, then observe backlog recovery under normal replicas.
- Record timeline, cause, affected IDs/counts (not payloads), maximum lag, duplicate/no-op counts,
  recovery revision, owner decisions, and follow-up actions.

```text
Incident/change ID:
Environment and exact revision:
Detection and recovery timestamps:
Affected topics/queues/job types:
Oldest/max backlog and attempts:
Containment owner/action:
Recovery owner/action:
State/event/intent reconciliation:
Synthetic verification:
Security/operations review:
Decision: RECOVERED | HOLD | ESCALATE
```
