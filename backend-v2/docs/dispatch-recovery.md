# Requester booking recovery

`GET /api/v1/bookings/:bookingId/recovery` uses the HTTP SELF authorization guard,
forced relationship RLS, and an additional requester-ownership check. Assigned crew
cannot use this requester projection. UUID validation runs before repository access;
successful responses carry `Cache-Control: private, no-store`.

The normal response envelope contains `observedAt`, `booking`, optional `assignment`
and `trip`, and `timeline: { items, truncated }`. These use the existing requester
projections. All reads share one read-only PostgreSQL `REPEATABLE READ` transaction.
`observedAt` is the application observation time, not an event cursor or commit
watermark. Tracking is fetched separately with its capture-time freshness contract.

Timeline reads fetch at most 201 rows and return the earliest 200 in chronological
order, with deterministic aggregate/version/ID tie-breakers. `truncated` means the
history is incomplete; the current booking/assignment/trip remain authoritative for
that database snapshot. The existing timeline endpoint retains its previous behavior.

## Mobile recovery

The development dispatch preview uses a memory-only `BookingRecovery` owner. Its
decoder checks booking/assignment/trip relationships, duplicate transition IDs,
timeline bounds and transition versions. Session or selection replacement fences
late responses; background/blur aborts reads, and foreground refetches. Authorization
loss drops displayed data and requires explicit selection to try again.

Reads are fresh for at most 15 seconds from request start, including network time.
Clock rollback, version regression, lost connection, and invalidation make the
snapshot stale. Cancellation checks freshness again at press time and retains the
observed optimistic version through the existing durable-command owner. Recovery
never dispatches lifecycle commands or replays durable intents.

Transport-independent hint handling is prepared for booking/trip invalidations.
Hints cannot patch state; old connection callbacks and unrelated resources are
ignored, duplicates are suppressed, and gaps trigger HTTP recovery. Catch-up is
bounded to two immediate read passes; a lagging response remains stale until a
later hint or explicit refresh. The preview now connects the
[requester realtime invalidation channel](requester-realtime.md).

## Verification and acceptance

Mobile tests cover canonical projection decoding, cancelable reads, session and
selection races, invalidation bursts, gaps/duplicates, background/foreground,
freshness/clock rollback, lost access and command/version regression. Supported
PostgreSQL cases cover concurrent commits, requester-only access and read-only
transaction cleanup. Exact remote outcomes are recorded in the CI evidence file;
new cases are pending CI until that revision is published and verified.

Production mobile integration, realtime delivery, load/outage acceptance and device
lifecycle/accessibility checks remain required. Gates 2–8 remain HOLD.
