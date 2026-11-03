# Phase 5–6 event contracts

These are the versioned Kafka facts emitted by core dispatch and product services. They are
JSON Schema contracts, not HTTP/OpenAPI models. No schema or example contains patient narrative,
precise tracking coordinates, credentials, tokens, document locations, or provider URLs.

## Layout and validation

- `_shared/envelope/v1/schema.json` defines the common immutable envelope.
- `<domain>/<event-type>/v1/schema.json` narrows the envelope to one event and payload.
- `<domain>/<event-type>/v1/example.json` is the canonical producer fixture.
- `catalog.json` records topic routing, producers, intended consumers, and operational ownership.
- `npm run contracts:events` validates every schema/example, rejects orphan contracts and restricted
  fixture fields, and checks that the catalog exactly covers implemented Phase 5–6 event literals.

Within a `v1` event, producers may add only backward-compatible optional fields after consumer
review. Removing, renaming, narrowing, or changing the meaning of a field requires a new event type
version. Kafka delivery is at least once; `eventId` is the deduplication key and `stream.sequence` is
the business ordering position.

## Implemented catalog

| Topic                     | Event types                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resq.booking.events.v1`  | `booking.requested.v1`, `booking.search-started.v1`, `booking.cancelled.v1`, `booking.unfulfilled.v1`, `booking.completed.v1`                                                                                                      |
| `resq.dispatch.events.v1` | `dispatch.offer.created.v1`, `dispatch.offer.accepted.v1`, `dispatch.offer.declined.v1`, `dispatch.offer.expired.v1`, `dispatch.offer.superseded.v1`, `dispatch.assignment.created.v1`, `dispatch.assignment.released.v1`          |
| `resq.trip.events.v1`     | `trip.preparation-started.v1`, `trip.departed-to-pickup.v1`, `trip.arrived-at-pickup.v1`, `trip.patient-boarded.v1`, `trip.departed-to-destination.v1`, `trip.arrived-at-destination.v1`, `trip.completed.v1`, `trip.cancelled.v1` |
| `resq.safety.events.v1`   | `safety.incident.created.v1`, `safety.incident.acknowledged.v1`, `safety.incident.escalated.v1`, `safety.incident.resolved.v1`                                                                                                     |

Validated location points use the separately restricted telemetry path described in the architecture
documents. They are deliberately absent from this ordinary domain-event catalog.

Product services adds `communication.preferences.replaced.v1`, `support.rating.recorded.v1`,
`billing.cash.recorded.v1`, `support.ticket.created.v1`, `support.ticket.replied.v1`, and
`support.ticket.transitioned.v1`, routed to the corresponding `resq.<domain>.events.v1` topic.
The `product.<resource_type>` streams are reserved for database command functions. Their payloads
contain only resource ID/version; consumers refetch separately authorized projections. Cataloged
intended consumers do not imply deployed consumers or external delivery. See the
[product API contract](../../docs/phase-6-product-api.md).
