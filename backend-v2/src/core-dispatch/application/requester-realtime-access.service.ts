import type { RequestContext } from '../../shared/application/context/request-context.js';
import type { UnitOfWork } from '../../shared/application/persistence/unit-of-work.js';
import type { CoreDispatchRepository } from './ports/core-dispatch.repository.js';
import { resourceNotFound } from './core-dispatch-errors.js';

export class RequesterRealtimeAccessService {
  constructor(
    private readonly repository: CoreDispatchRepository,
    private readonly unit: UnitOfWork,
  ) {}

  bookingVersion(context: RequestContext, bookingId: string): Promise<number> {
    return this.unit.execute(context, async (tx) => {
      const booking = await this.repository.findBooking(tx, bookingId);
      if (
        context.actor?.type !== 'USER' ||
        booking?.requesterUserId !== context.actor.id ||
        context.scope.tenantId !== undefined ||
        context.scope.authorityGrantId !== undefined
      )
        throw resourceNotFound();
      return booking.version;
    });
  }
}
