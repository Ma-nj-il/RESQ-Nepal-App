import type { AuditWriter } from '../../shared/application/audit/audit-writer.js';
import type { RequestContext } from '../../shared/application/context/request-context.js';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type {
  IdempotencyExecutor,
  IdempotentResult,
  JsonValue,
} from '../../shared/application/idempotency/idempotency.js';
import type { DeliveryWriter } from '../../shared/application/messaging/delivery-writer.js';
import type { UnitOfWork } from '../../shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import { trackingFreshness, type TripCommand } from '../domain/core-dispatch.js';
import { auditEvidence } from './core-dispatch-evidence.js';
import {
  authenticationRequired,
  dispatchResultError,
  resourceNotFound,
} from './core-dispatch-errors.js';
import { trackingJson, tripJson } from './core-dispatch-json.js';
import type { CoreDispatchPolicy } from './core-dispatch.policy.js';
import type {
  CoreDispatchRepository,
  TrackingStateRecord,
  TripRecord,
} from './ports/core-dispatch.repository.js';

export interface TripTransitionInput {
  readonly reasonCode: string;
  readonly reason?: string;
  readonly pickupOdometerMeters?: bigint;
  readonly completionOdometerMeters?: bigint;
  readonly distanceMeters?: bigint;
  readonly finalFareMinor?: bigint;
  readonly finalFareCurrency?: 'NPR';
  readonly finalFareProvenance?: string;
}

export interface LocationPointInput {
  readonly pointId: string;
  readonly sequence: bigint;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
  readonly headingDegrees?: number;
  readonly speedMetersPerSecond?: number;
  readonly quality: 'GOOD' | 'REDUCED' | 'POOR';
  readonly capturedAt: Date;
}

const EVENT_FOR_COMMAND: Readonly<Record<TripCommand, string>> = Object.freeze({
  PREPARE: 'trip.preparation-started.v1',
  DEPART_TO_PICKUP: 'trip.departed-to-pickup.v1',
  ARRIVE_AT_PICKUP: 'trip.arrived-at-pickup.v1',
  BOARD_PATIENT: 'trip.patient-boarded.v1',
  DEPART_TO_DESTINATION: 'trip.departed-to-destination.v1',
  ARRIVE_AT_DESTINATION: 'trip.arrived-at-destination.v1',
  COMPLETE: 'trip.completed.v1',
});

export class TripTrackingService {
  constructor(
    private readonly repository: CoreDispatchRepository,
    private readonly policy: CoreDispatchPolicy,
    private readonly idempotency: IdempotencyExecutor,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly delivery: DeliveryWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  listTrips(context: RequestContext): Promise<readonly TripRecord[]> {
    this.requireUser(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listTrips(transaction),
    );
  }

  async trip(context: RequestContext, tripId: string): Promise<TripRecord> {
    this.requireUser(context);
    const trip = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findTrip(transaction, tripId),
    );
    if (trip === undefined) throw resourceNotFound();
    return trip;
  }

  transition(
    context: RequestContext,
    key: string,
    tripId: string,
    expectedVersion: number,
    command: TripCommand,
    input: TripTransitionInput,
  ): Promise<IdempotentResult<JsonValue>> {
    const actorUserId = this.requireTenant(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `trip.${command.toLowerCase()}:${tripId}`,
        request: {
          tripId,
          expectedVersion,
          command,
          reasonCode: input.reasonCode,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.pickupOdometerMeters === undefined
            ? {}
            : { pickupOdometerMeters: input.pickupOdometerMeters.toString() }),
          ...(input.completionOdometerMeters === undefined
            ? {}
            : { completionOdometerMeters: input.completionOdometerMeters.toString() }),
          ...(input.distanceMeters === undefined
            ? {}
            : { distanceMeters: input.distanceMeters.toString() }),
          ...(input.finalFareMinor === undefined
            ? {}
            : { finalFareMinor: input.finalFareMinor.toString() }),
          ...(input.finalFareCurrency === undefined
            ? {}
            : { finalFareCurrency: input.finalFareCurrency }),
          ...(input.finalFareProvenance === undefined
            ? {}
            : { finalFareProvenance: input.finalFareProvenance }),
        },
        successStatus: 200,
      },
      async (transaction) => {
        const current = await this.repository.findTrip(transaction, tripId);
        if (current === undefined) throw resourceNotFound();
        const result = await this.repository.transitionTrip(transaction, {
          tripId,
          expectedVersion,
          transitionId: this.ids.generate(),
          actorUserId,
          command,
          commandId: context.requestId,
          reasonCode: input.reasonCode,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.pickupOdometerMeters === undefined
            ? {}
            : { pickupOdometerMeters: input.pickupOdometerMeters }),
          ...(input.completionOdometerMeters === undefined
            ? {}
            : { completionOdometerMeters: input.completionOdometerMeters }),
          ...(input.distanceMeters === undefined ? {} : { distanceMeters: input.distanceMeters }),
          ...(input.finalFareMinor === undefined ? {} : { finalFareMinor: input.finalFareMinor }),
          ...(input.finalFareCurrency === undefined
            ? {}
            : { finalFareCurrency: input.finalFareCurrency }),
          ...(input.finalFareProvenance === undefined
            ? {}
            : { finalFareProvenance: input.finalFareProvenance }),
        });
        if (
          [
            'NOT_FOUND',
            'NOT_AUTHORIZED',
            'STALE_VERSION',
            'INVALID_TRANSITION',
            'COMPLETION_EVIDENCE_REQUIRED',
          ].includes(result)
        ) {
          throw dispatchResultError(result as Parameters<typeof dispatchResultError>[0]);
        }
        const changed = await this.repository.findTrip(transaction, tripId);
        if (changed === undefined) throw new Error('Transitioned trip disappeared');
        const occurredAt = changed.updatedAt;
        await this.delivery.appendEvent(transaction, context, {
          eventId: this.ids.generate(),
          eventType: EVENT_FOR_COMMAND[command],
          producer: 'core-dispatch',
          aggregateType: 'trip',
          aggregateId: tripId,
          aggregateVersion: changed.version,
          streamType: 'trip',
          streamId: tripId,
          tenantId: changed.tenantId,
          facilityId: changed.facilityId,
          occurredAt,
          data: {
            bookingId: changed.bookingId,
            fromStatus: current.status,
            status: changed.status,
          },
        });
        if (command === 'COMPLETE') {
          const assignment = await this.repository.findAssignmentByBooking(
            transaction,
            changed.bookingId,
          );
          const booking = await this.repository.findBooking(transaction, changed.bookingId);
          if (assignment !== undefined) {
            await this.delivery.appendEvent(transaction, context, {
              eventId: this.ids.generate(),
              eventType: 'dispatch.assignment.released.v1',
              producer: 'core-dispatch',
              aggregateType: 'assignment',
              aggregateId: assignment.id,
              aggregateVersion: assignment.version,
              streamType: 'bookingDispatch',
              streamId: assignment.bookingId,
              tenantId: assignment.tenantId,
              facilityId: assignment.facilityId,
              occurredAt,
              data: { reasonCode: 'TRIP_COMPLETED' },
            });
          }
          if (booking !== undefined) {
            await this.delivery.appendEvent(transaction, context, {
              eventId: this.ids.generate(),
              eventType: 'booking.completed.v1',
              producer: 'core-dispatch',
              aggregateType: 'booking',
              aggregateId: booking.id,
              aggregateVersion: booking.version,
              streamType: 'bookingDispatch',
              streamId: booking.id,
              tenantId: changed.tenantId,
              facilityId: changed.facilityId,
              occurredAt,
              data: { tripId, status: 'COMPLETED' },
            });
          }
        }
        await this.audit.append(
          transaction,
          auditEvidence(context, {
            id: this.ids.generate(),
            occurredAt,
            tenantId: changed.tenantId,
            action: `trip.${command.toLowerCase()}`,
            resourceType: 'trip',
            resourceId: tripId,
            reasonCode: input.reasonCode,
            safeContext: { fromStatus: current.status, toStatus: changed.status },
          }),
        );
        return tripJson(changed);
      },
    );
  }

  async ingestLocations(
    context: RequestContext,
    tripId: string,
    sourceDeviceId: string,
    points: readonly LocationPointInput[],
  ): Promise<readonly Readonly<{ pointId: string; result: string }>[]> {
    this.requireTenant(context);
    if (points.length === 0 || points.length > 50) {
      throw new ApplicationError({
        code: 'TRACKING.BATCH_SIZE_INVALID',
        message: 'A tracking batch must contain between 1 and 50 points.',
        status: 400,
      });
    }
    return this.unitOfWork.execute(context, async (transaction) => {
      const results: { pointId: string; result: string }[] = [];
      for (const point of points) {
        const result = await this.repository.ingestLocationPoint(transaction, {
          id: this.ids.generate(),
          tripId,
          sourceDeviceId,
          pointId: point.pointId,
          sequence: point.sequence,
          latitude: point.latitude,
          longitude: point.longitude,
          accuracyMeters: point.accuracyMeters,
          ...(point.headingDegrees === undefined ? {} : { headingDegrees: point.headingDegrees }),
          ...(point.speedMetersPerSecond === undefined
            ? {}
            : { speedMetersPerSecond: point.speedMetersPerSecond }),
          quality: point.quality,
          capturedAt: point.capturedAt,
        });
        results.push({ pointId: point.pointId, result });
      }
      return results;
    });
  }

  async tracking(context: RequestContext, tripId: string): Promise<JsonValue> {
    this.requireUser(context);
    const state = await this.unitOfWork.execute(context, async (transaction) => {
      if (!(await this.repository.canReadTracking(transaction, tripId))) {
        throw resourceNotFound();
      }
      return this.repository.findTrackingState(transaction, tripId);
    });
    if (state === undefined) return { tripId, freshness: 'UNAVAILABLE' };
    const evaluatedAt = this.clock.now();
    return trackingJson(
      state,
      trackingFreshness(
        state.capturedAt,
        evaluatedAt,
        this.policy.trackingStaleAfterMs,
        this.policy.trackingUnavailableAfterMs,
      ),
      evaluatedAt,
    );
  }

  private requireUser(context: RequestContext): string {
    if (context.actor?.type !== 'USER') throw authenticationRequired();
    return context.actor.id;
  }

  private requireTenant(context: RequestContext): string {
    const userId = this.requireUser(context);
    if (context.scope.tenantId === undefined) throw resourceNotFound();
    return userId;
  }
}

export const tripTrackingJson = Object.freeze({
  trip: tripJson,
  tracking: (
    state: TrackingStateRecord,
    freshness: 'LIVE' | 'STALE' | 'UNAVAILABLE',
    now: Date,
  ): JsonValue => trackingJson(state, freshness, now),
});
