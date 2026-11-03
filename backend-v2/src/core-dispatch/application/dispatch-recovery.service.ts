import type { RequestContext } from '../../shared/application/context/request-context.js';
import type { UnitOfWork } from '../../shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../shared/domain/clock.js';
import { authenticationRequired, resourceNotFound } from './core-dispatch-errors.js';
import type {
  AssignmentRecord,
  BookingRecord,
  CoreDispatchRepository,
  TimelineRecord,
  TripRecord,
} from './ports/core-dispatch.repository.js';

export interface RequesterRecoverySnapshot {
  readonly observedAt: Date;
  readonly booking: BookingRecord;
  readonly assignment?: AssignmentRecord;
  readonly trip?: TripRecord;
  readonly timeline: readonly TimelineRecord[];
  readonly timelineTruncated: boolean;
}

/** A recovery read is one database snapshot, never an assembly of independently timed HTTP reads. */
export class DispatchRecoveryService {
  constructor(
    private readonly repository: CoreDispatchRepository,
    private readonly unit: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  requesterSnapshot(
    context: RequestContext,
    bookingId: string,
  ): Promise<RequesterRecoverySnapshot> {
    if (context.actor?.type !== 'USER') throw authenticationRequired();
    const userId = context.actor.id;
    return this.unit.execute(
      context,
      async (transaction) => {
        const observedAt = this.clock.now();
        const booking = await this.repository.findBooking(transaction, bookingId);
        // SELF RLS also supports crew relationships; this projection is exclusively for the requester.
        if (
          booking === undefined ||
          booking.requesterUserId !== userId ||
          context.scope.tenantId !== undefined ||
          context.scope.authorityGrantId !== undefined
        )
          throw resourceNotFound();
        const assignment = await this.repository.findAssignmentByBooking(transaction, bookingId);
        const trip = await this.repository.findTripByBooking(transaction, bookingId);
        const timeline = await this.repository.listBookingTimeline(transaction, bookingId, 201);
        return {
          observedAt,
          booking,
          ...(assignment === undefined ? {} : { assignment }),
          ...(trip === undefined ? {} : { trip }),
          timeline: timeline.slice(0, 200),
          timelineTruncated: timeline.length > 200,
        };
      },
      'READ_ONLY_SNAPSHOT',
    );
  }
}
