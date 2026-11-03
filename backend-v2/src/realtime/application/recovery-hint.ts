import { z } from 'zod';

const bookingEvents = new Set([
  'booking.requested.v1',
  'booking.search-started.v1',
  'booking.cancelled.v1',
  'booking.unfulfilled.v1',
  'booking.completed.v1',
]);
const assignmentEvents = new Set([
  'dispatch.assignment.created.v1',
  'dispatch.assignment.released.v1',
]);
const tripEvents = new Set([
  'trip.preparation-started.v1',
  'trip.departed-to-pickup.v1',
  'trip.arrived-at-pickup.v1',
  'trip.patient-boarded.v1',
  'trip.departed-to-destination.v1',
  'trip.arrived-at-destination.v1',
  'trip.completed.v1',
  'trip.cancelled.v1',
]);
const envelope = z.object({
  eventId: z.uuid(),
  eventType: z.string(),
  schemaVersion: z.literal(1),
  producer: z.enum(['core-dispatch', 'core-dispatch-worker']),
  aggregate: z.object({
    type: z.string(),
    id: z.uuid(),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  stream: z.object({
    type: z.string(),
    id: z.uuid(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  data: z.object({ bookingId: z.uuid().optional() }),
});

export const recoveryHint = z.object({ eventId: z.uuid(), bookingId: z.uuid() }).strict();
export type RecoveryHint = z.infer<typeof recoveryHint>;

/** All broker data is discarded except the invalidation identity. No business payload crosses Redis. */
export function projectRecoveryHint(
  topic: string,
  key: string,
  input: unknown,
): RecoveryHint | undefined {
  const result = envelope.safeParse(input);
  if (!result.success) return undefined;
  const event = result.data;
  if (key !== event.stream.id) return undefined;
  if (
    bookingEvents.has(event.eventType) &&
    topic === 'resq.booking.events.v1' &&
    event.aggregate.type === 'booking' &&
    event.stream.type === 'bookingDispatch' &&
    event.stream.id === event.aggregate.id
  )
    return { eventId: event.eventId, bookingId: event.aggregate.id };
  if (
    assignmentEvents.has(event.eventType) &&
    topic === 'resq.dispatch.events.v1' &&
    event.aggregate.type === 'assignment' &&
    event.stream.type === 'bookingDispatch' &&
    (event.data.bookingId === undefined || event.stream.id === event.data.bookingId)
  )
    return { eventId: event.eventId, bookingId: event.stream.id };
  if (
    tripEvents.has(event.eventType) &&
    topic === 'resq.trip.events.v1' &&
    event.aggregate.type === 'trip' &&
    event.stream.type === 'trip' &&
    event.stream.id === event.aggregate.id &&
    event.data.bookingId !== undefined
  )
    return { eventId: event.eventId, bookingId: event.data.bookingId };
  return undefined;
}

export interface RecoveryHintSource {
  ready(): boolean;
  subscribe(hint: (value: RecoveryHint) => void, unavailable: () => void): () => void;
}
