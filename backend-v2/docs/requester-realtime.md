# Requester realtime delivery

## Transport decision

The requester recovery channel uses Socket.IO 4, WebSocket transport only, with
Engine.IO path **`/realtime`** and Socket.IO namespace **`/realtime`**. HTTP remains
the lifecycle command and recovery interface. Enable the API with
`RESQ_REALTIME_ENABLED=true`; the default is false. Provision the booking, dispatch
and trip Kafka topics first. Every API replica uses the same environment-scoped
Kafka client ID, consumer group and Redis channel; separate deployments need
distinct client IDs and broker/Redis ACLs.

A shared Kafka consumer group projects 15 allowlisted booking, assignment and trip
lifecycle events into `{ eventId, bookingId }` invalidations. It checks topic, key,
producer, aggregate and stream relationships before publishing. Redis fanout gives
each API replica those invalidations. Each replica reauthorizes individual recipients
before emission. This explicit fanout replaces the proposed room-based Redis adapter
for this recovery-only channel. Business payloads, actor identity, tenant metadata,
patient data and tracking coordinates are never copied into the fanout channel.

## Authentication and subscription

Send `{ token: accessToken }` in handshake `auth`, never a URL. Only SELF context is
implemented here; selector fields are rejected. The existing authorization service
verifies token, active session/account, assurance and token version. Subscription and
delivery also perform an application-role RLS read plus explicit requester ownership.
The requester projection remains unavailable to assigned crew and other users.

The client emits `subscribe` with `{ type: "booking", id: bookingId }`. One booking
is selected per socket; `unsubscribe` drops it. A successful acknowledgement is
`{ accepted: true, bookingId }`. The server emits `recovery.hint`:

```json
{
  "eventId": "018f0000-0000-7000-8000-000000000011",
  "sequence": 1,
  "resource": {
    "type": "booking",
    "id": "018f0000-0000-7000-8000-000000000103",
    "version": 4
  }
}
```

`sequence` is connection-local delivery order, not a durable broker cursor. The
version is an authorized current booking version. Trip/assignment events invalidate
the associated booking recovery even when its booking version is unchanged. Clients
must fetch the consistent HTTP snapshot after subscription/reconnection, every hint,
or a sequence gap. Hints can be coalesced or dropped; they never patch business state.
The initial subscription emits a synthetic invalidation with a fresh event ID.

## Bounded operation and recovery

- 256 Engine.IO connections per process, four connected sockets per session, one
  booking per socket, 16 outstanding authorization operations, and a 4-second
  operation deadline. Timed-out database work retains its capacity slot until settled.
- Live authorization/ownership checks before every hint and scheduled every five
  seconds for idle sockets. A ten-second authorization lease disconnects sockets
  whose checks cannot complete. Subscription admission fails under saturation;
  existing sockets coalesce work into bounded timers.
- 16 KiB incoming messages, 12 subscription credits replenished at one per five
  seconds, 128 recent event IDs per socket, and one pending coalesced hint. Volatile
  emission avoids an unbounded socket replay queue. Compression and connection-state
  replay are disabled. Unsupported origins and URL parameters are rejected.
- Redis subscriber failure, failed publication, or Kafka consumer crash marks the
  component unavailable and disconnects local clients. API readiness includes the
  realtime component when enabled. A failed component requires a replica restart;
  this implementation does not claim seamless broker/Redis recovery.
- Mobile socket ownership follows authenticated user/session, selected booking and
  AppState. Backgrounding, selection changes and cleanup cancel pending auth and
  timers. Reconnect uses five bounded attempts with exponential backoff and jitter;
  foregrounding/reselection with a new owner can start another budget. Handshake
  access tokens share the HTTP session's single-flight refresh and are sent only
  after its successor is persisted. Server rejection triggers HTTP recovery, which
  handles stale/expired/revoked credentials through the existing session owner.

## Evidence and remaining acceptance

Installed Socket.IO wire tests cover handshake/context/origin restrictions, foreign
resources, current-version-only projection, revocation, asynchronous cancellation,
authorization timeout and source loss. Contract examples exercise all 15 accepted
event types. Mobile tests cover socket cleanup, late callbacks, secure origin
validation and refresh concurrency. An infrastructure integration case exercises a
shared Kafka group and two Redis replica subscribers; requester/crew isolation is
also covered on supported PostgreSQL. Exact CI outcomes are recorded separately.

Local checks pass: backend **30 suites / 186 tests**, lint, typecheck, build and
formatting; mobile **143 tests**, lint and typecheck. Backend production dependency
audit reports zero vulnerabilities. Mobile's configured HIGH gate passes with five
MODERATE findings in Expo build tooling dependencies. The new infrastructure fanout
case remains pending CI at publication time.

Development exports for Android, iOS and web pass with the Socket.IO dependency.
Final review adds concurrent-handshake capacity enforcement, terminal startup failure,
subscription fencing, and handshake waiting for an HTTP-triggered stale-token refresh.
Release exports and clean Linux installation await the published revision's mobile CI.

Tenant queues, authority resources, notification subscriptions, live tracking and
production screen adoption remain open. Multi-replica load, proxy idle/upgrade
configuration, TLS/ACL acceptance, Redis/broker outage drills and device lifecycle
acceptance remain required. This channel is an invalidation aid, not reliable
emergency notification delivery. Gates 2–8 remain HOLD.
