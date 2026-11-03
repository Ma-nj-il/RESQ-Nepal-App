# Phase 5 transition and actor matrix

- **Evidence state:** implemented contract; dispatch/clinical operations acceptance is pending
- **Applies to:** booking, offer, assignment, trip, tracking, and safety commands
- **Authority rule:** actor class, tenant/facility scope, and resource relationships are resolved on the
  server and rechecked in PostgreSQL. Request bodies cannot select an actor class or widen scope.

All mutations require an authenticated current user. HTTP permission checks are followed by forced
RLS and security-definer functions bound to transaction-local `app.user_id`, tenant/facility claims,
and (where applicable) the active authority grant. `If-Match` supplies the expected aggregate version;
command endpoints also use actor/operation-bound idempotency keys.

## Booking and dispatch

| Current state   | Command / resulting state                                                  | Exposed actor                           | HTTP authorization | Database and race guard                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------- | --------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| none            | create booking → `REQUESTED`                                               | requester                               | self context       | Current user owns the unexpired matching quote; protected patient payload, transition, events, and jobs commit together                                                          |
| `REQUESTED`     | start search → `SEARCHING`                                                 | requester policy in booking transaction | self context       | Booking row lock, expected version, current coverage/provider/facility eligibility, unique offer/coverage arrays, bounded deadlines                                              |
| `SEARCHING`     | accept offer → booking `ACTIVE`, offer `ACCEPTED`, assignment/trip created | tenant dispatcher                       | `dispatch.respond` | **Booking is locked before offer/resources**; facility scope, offer/search deadlines, current provider/driver/document/ambulance eligibility, unique active resource constraints |
| `SEARCHING`     | competing offers → `SUPERSEDED`                                            | same accepting dispatcher transaction   | `dispatch.respond` | All pending competitors close in the winning booking transaction; one accepted offer/assignment is enforced                                                                      |
| `PENDING` offer | decline → `DECLINED`                                                       | scoped tenant user                      | `dispatch.respond` | Offer lock, expected version, exact facility scope, terminal-offer rejection                                                                                                     |
| `PENDING` offer | expire → `EXPIRED`                                                         | system policy worker                    | worker role        | Offer lock and database time; only a still-pending, due offer in the job tenant can change                                                                                       |
| `SEARCHING`     | finish search → `UNFULFILLED`                                              | system policy worker                    | worker role        | Booking lock, database search deadline, no assignment; pending offers expire atomically                                                                                          |

Offer acceptance returns `OFFER_RESOLVED`, `OFFER_EXPIRED`, or a scoped eligibility/conflict result
rather than creating a second assignment. Kafka/BullMQ availability is not part of this transaction;
outbox rows and job intents remain durable in PostgreSQL.

## Trip lifecycle

The HTTP actor must hold `trip.transition` in the trip tenant/facility context. PostgreSQL additionally
requires the actor to be in the exact scoped tenant/facility; the assigned driver relationship is
recognized explicitly. The booking must remain `ACTIVE`.

| Command                 | Allowed from                      | Result                    | Additional evidence/effect                                                                                          |
| ----------------------- | --------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PREPARE`               | `ASSIGNED`                        | `PREPARING_TO_DEPART`     | reason code; optional reason/odometer                                                                               |
| `DEPART_TO_PICKUP`      | `ASSIGNED`, `PREPARING_TO_DEPART` | `EN_ROUTE_TO_PICKUP`      | records `startedAt`; driver/ambulance become on-trip/dispatched                                                     |
| `ARRIVE_AT_PICKUP`      | `EN_ROUTE_TO_PICKUP`              | `ARRIVED_AT_PICKUP`       | immutable timeline transition                                                                                       |
| `BOARD_PATIENT`         | `ARRIVED_AT_PICKUP`               | `PATIENT_ON_BOARD`        | immutable timeline transition                                                                                       |
| `DEPART_TO_DESTINATION` | `PATIENT_ON_BOARD`                | `EN_ROUTE_TO_DESTINATION` | immutable timeline transition                                                                                       |
| `ARRIVE_AT_DESTINATION` | `EN_ROUTE_TO_DESTINATION`         | `ARRIVED_AT_DESTINATION`  | immutable timeline transition                                                                                       |
| `COMPLETE`              | `ARRIVED_AT_DESTINATION`          | `COMPLETED`               | distance, nonnegative fare, `NPR`, and fare provenance required; booking completes and resources release atomically |

Skipped, reversed, repeated, stale-version, or post-terminal transitions are rejected. Every accepted
transition appends immutable trip evidence and an outbox fact in the same transaction.

## Cancellation policy

The application asks PostgreSQL for the current actor class; it never accepts one from the client.

| Resolved class | Relationship required                                                      | Before patient on board      | Patient on board or later         |
| -------------- | -------------------------------------------------------------------------- | ---------------------------- | --------------------------------- |
| `REQUESTER`    | current user owns booking; self context has no tenant/authority selector   | allowed                      | rejected with `OVERRIDE_REQUIRED` |
| `PROVIDER`     | current tenant/facility owns selected assignment                           | allowed                      | rejected with `OVERRIDE_REQUIRED` |
| `CREW`         | provider scope plus current user is the assigned driver                    | allowed                      | rejected with `OVERRIDE_REQUIRED` |
| `AUTHORITY`    | active grant permits `dispatch.override` for the exact assignment facility | allowed by database function | allowed by database function      |

Phase 5 HTTP exposes requester and tenant cancellation only. No authority mutation route is exposed;
an authority override therefore remains unavailable until operations/security approve its API and
step-up policy. This is a Gate 5 blocker, not an instruction to bypass the function.

An accepted cancellation locks the booking before assignment/trip, terminalizes linked state,
withdraws pending offers, releases resources, and records append-only cancellation evidence. The
current unapproved fee policy always records zero NPR and `feeWaived=true`; clients cannot set a fee.

## Tracking

| Operation     | Actor/read audience                                                                                                          | Guard                                                                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| publish batch | exact assigned driver using their user ID as source, or active device binding for the assigned ambulance; `tracking.publish` | tenant/facility relationship, nonterminal trip, trip-row serialization, 1–50 DTO bound, per-source point/sequence dedupe, monotonic sequence, non-regressing capture time, coordinate/accuracy/speed/time bounds |
| read latest   | requester, exact tenant/facility, or authority grant with `tracking.read` for booking geography                              | relationship-bound forced RLS; no caller-selected tenant grants access                                                                                                                                           |

Freshness is calculated from **capture time** at read time: `LIVE` before 30 seconds, `STALE` from 30
seconds, and `UNAVAILABLE` from 120 seconds by the current policy. A later-received older capture
cannot replace the current state. Raw points are not ordinary outbox events.

## Safety incidents

| Current state                             | Command                       | Exposed actor                                                | Result/guard                                                                                   |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| none                                      | create                        | authenticated requester or scoped trip participant           | `OPEN`, tier 0; optional trip binding must match one active booking/trip/tenant/facility tuple |
| `OPEN` or `ESCALATED`                     | acknowledge                   | exact incident tenant/facility with `safety.incident.manage` | `ACKNOWLEDGED`; expected version serializes against automatic escalation                       |
| any nonresolved state                     | escalate                      | same scoped manager                                          | `ESCALATED`; target tier must strictly increase and cannot exceed 5                            |
| any nonresolved state                     | resolve                       | same scoped manager                                          | `RESOLVED` with outcome code                                                                   |
| `OPEN` or `ESCALATED`, never acknowledged | automatic deadline escalation | system policy worker                                         | exact expected version/tier; stale jobs become no-op; tier cannot exceed 5                     |

Incident narratives are encrypted and absent from events/projections. Alert delivery re-reads exact
incident version, tier, severity, tenant, and open status before attempting delivery. The production
adapter is intentionally unavailable until an approved channel exists; no job may claim delivery in
that state. Unbound incidents are durable and can auto-escalate, but have no tenant responder route;
their routing/response policy requires operations approval before public use.

## Required acceptance evidence

Operations/security must approve this matrix and attach: multi-replica acceptance and cancellation/
SOS race results, authority-override policy, tracking device and freshness policy, SOS recipients and
deadlines, approved alert fallback, and named DLT/replay/on-call owners. Implementation alone does not
pass Gate 5.
