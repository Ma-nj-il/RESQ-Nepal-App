import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { RequireAuthorization } from '../../../identity-access/presentation/http/route-authorization.decorator.js';
import type { TripCommand } from '../../domain/core-dispatch.js';
import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { successResponse } from '../../../shared/presentation/http/success-response.js';
import {
  BOOKING_DISPATCH_SERVICE,
  SAFETY_SERVICE,
  TRIP_TRACKING_SERVICE,
  type BookingDispatchServiceToken,
  type SafetyServiceToken,
  type TripTrackingServiceToken,
} from '../../core-dispatch.tokens.js';
import { expectedVersion, idempotencyKey, idempotentResponse } from './command-http.js';
import {
  LocationPointBatchDto,
  DispatchListQueryDto,
  OfferAcceptanceDto,
  ReasonCommandDto,
  SafetyIncidentTransitionDto,
  TripCancellationDto,
  TripCompletionDto,
  TripTransitionDto,
} from './core-dispatch.dto.js';
import {
  involvedTimelineProjection,
  dispatchPage,
  tenantBookingProjection,
  tenantDispatchOfferProjection,
  tenantIncidentProjection,
  tenantTripProjection,
} from './core-dispatch.projections.js';

@Controller('/api/v1/tenant')
export class TenantDispatchController {
  constructor(
    @Inject(BOOKING_DISPATCH_SERVICE) private readonly bookings: BookingDispatchServiceToken,
    @Inject(TRIP_TRACKING_SERVICE) private readonly trips: TripTrackingServiceToken,
    @Inject(SAFETY_SERVICE) private readonly safety: SafetyServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Get('/dispatch-offers')
  @RequireAuthorization({ context: 'TENANT', permission: 'dispatch.offer.read' })
  async offers(): Promise<unknown> {
    const records = await this.bookings.listOfferDetails(this.contexts.require());
    return successResponse(this.contexts, {
      items: records.map(({ offer, booking }) => tenantDispatchOfferProjection(offer, booking)),
      nextCursor: null,
    });
  }

  @Get('/dispatch-offers/:offerId')
  @RequireAuthorization({ context: 'TENANT', permission: 'dispatch.offer.read' })
  async offer(
    @Param('offerId') offerId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const { offer, booking } = await this.bookings.offerDetail(this.contexts.require(), offerId);
    response.setHeader('ETag', `"${String(offer.version)}"`);
    return successResponse(this.contexts, tenantDispatchOfferProjection(offer, booking));
  }

  @Post('/dispatch-offers/:offerId/acceptance')
  @RequireAuthorization({ context: 'TENANT', permission: 'dispatch.respond' })
  async acceptOffer(
    @Param('offerId') offerId: string,
    @Body() body: OfferAcceptanceDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.bookings.acceptOffer(
      this.contexts.require(),
      idempotencyKey(key),
      offerId,
      expectedVersion(ifMatch),
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Post('/dispatch-offers/:offerId/decline')
  @RequireAuthorization({ context: 'TENANT', permission: 'dispatch.respond' })
  async declineOffer(
    @Param('offerId') offerId: string,
    @Body() body: ReasonCommandDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.bookings.declineOffer(
      this.contexts.require(),
      idempotencyKey(key),
      offerId,
      expectedVersion(ifMatch),
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Get('/bookings')
  @RequireAuthorization({ context: 'TENANT', permission: 'booking.read' })
  async listBookings(@Query() query: DispatchListQueryDto = {}): Promise<unknown> {
    const records = await this.bookings.listBookings(this.contexts.require(), query.afterId);
    return successResponse(this.contexts, dispatchPage(records, tenantBookingProjection));
  }

  @Get('/bookings/:bookingId')
  @RequireAuthorization({ context: 'TENANT', permission: 'booking.read' })
  async booking(
    @Param('bookingId') bookingId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.bookings.booking(this.contexts.require(), bookingId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, tenantBookingProjection(record));
  }

  @Get('/bookings/:bookingId/timeline')
  @RequireAuthorization({ context: 'TENANT', permission: 'booking.read' })
  async timeline(@Param('bookingId') bookingId: string): Promise<unknown> {
    const records = await this.bookings.timeline(this.contexts.require(), bookingId);
    return successResponse(this.contexts, {
      items: records.map(involvedTimelineProjection),
      nextCursor: null,
    });
  }

  @Get('/trips')
  @RequireAuthorization({ context: 'TENANT', permission: 'trip.read' })
  async listTrips(@Query() query: DispatchListQueryDto = {}): Promise<unknown> {
    const records = await this.trips.listTrips(this.contexts.require(), query.afterId);
    return successResponse(this.contexts, dispatchPage(records, tenantTripProjection));
  }

  @Get('/trips/:tripId')
  @RequireAuthorization({ context: 'TENANT', permission: 'trip.read' })
  async trip(
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.trips.trip(this.contexts.require(), tripId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, tenantTripProjection(record));
  }

  @Post('/trips/:tripId/preparation')
  @RequireAuthorization({ context: 'TENANT', permission: 'trip.transition' })
  prepare(
    @Param('tripId') tripId: string,
    @Body() body: TripTransitionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transition('PREPARE', tripId, body, ifMatch, key, response);
  }

  @Post('/trips/:tripId/departure-to-pickup')
  @RequireAuthorization({ context: 'TENANT', permission: 'trip.transition' })
  departToPickup(
    @Param('tripId') tripId: string,
    @Body() body: TripTransitionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transition('DEPART_TO_PICKUP', tripId, body, ifMatch, key, response);
  }

  @Post('/trips/:tripId/arrival-at-pickup')
  @RequireAuthorization({ context: 'TENANT', permission: 'trip.transition' })
  arriveAtPickup(
    @Param('tripId') tripId: string,
    @Body() body: TripTransitionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transition('ARRIVE_AT_PICKUP', tripId, body, ifMatch, key, response);
  }

  @Post('/trips/:tripId/patient-boarding')
  @RequireAuthorization({ context: 'TENANT', permission: 'trip.transition' })
  boardPatient(
    @Param('tripId') tripId: string,
    @Body() body: TripTransitionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transition('BOARD_PATIENT', tripId, body, ifMatch, key, response);
  }

  @Post('/trips/:tripId/departure-to-destination')
  @RequireAuthorization({ context: 'TENANT', permission: 'trip.transition' })
  departToDestination(
    @Param('tripId') tripId: string,
    @Body() body: TripTransitionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transition('DEPART_TO_DESTINATION', tripId, body, ifMatch, key, response);
  }

  @Post('/trips/:tripId/arrival-at-destination')
  @RequireAuthorization({ context: 'TENANT', permission: 'trip.transition' })
  arriveAtDestination(
    @Param('tripId') tripId: string,
    @Body() body: TripTransitionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transition('ARRIVE_AT_DESTINATION', tripId, body, ifMatch, key, response);
  }

  @Post('/trips/:tripId/completion')
  @RequireAuthorization({ context: 'TENANT', permission: 'trip.transition' })
  complete(
    @Param('tripId') tripId: string,
    @Body() body: TripCompletionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transition(
      'COMPLETE',
      tripId,
      {
        reasonCode: body.reasonCode,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
        ...(body.pickupOdometerMeters === undefined
          ? {}
          : { pickupOdometerMeters: BigInt(body.pickupOdometerMeters) }),
        ...(body.completionOdometerMeters === undefined
          ? {}
          : { completionOdometerMeters: BigInt(body.completionOdometerMeters) }),
        distanceMeters: BigInt(body.distanceMeters),
        finalFareMinor: BigInt(body.finalFareMinor),
        finalFareCurrency: body.finalFareCurrency,
        finalFareProvenance: body.finalFareProvenance,
      },
      ifMatch,
      key,
      response,
    );
  }

  @Post('/trips/:tripId/cancellation')
  @RequireAuthorization({ context: 'TENANT', permission: 'trip.cancel' })
  async cancelTrip(
    @Param('tripId') tripId: string,
    @Body() body: TripCancellationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const trip = await this.trips.trip(this.contexts.require(), tripId);
    const result = await this.bookings.cancelBooking(
      this.contexts.require(),
      idempotencyKey(key),
      trip.bookingId,
      body.expectedBookingVersion,
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Post('/trips/:tripId/location-point-batches')
  @RequireAuthorization({ context: 'TENANT', permission: 'tracking.publish' })
  async ingestLocations(
    @Param('tripId') tripId: string,
    @Body() body: LocationPointBatchDto,
  ): Promise<unknown> {
    const items = await this.trips.ingestLocations(
      this.contexts.require(),
      tripId,
      body.sourceDeviceId,
      body.points.map((point) => ({
        pointId: point.pointId,
        sequence: BigInt(point.sequence),
        latitude: point.latitude,
        longitude: point.longitude,
        accuracyMeters: point.accuracyMeters,
        ...(point.headingDegrees === undefined ? {} : { headingDegrees: point.headingDegrees }),
        ...(point.speedMetersPerSecond === undefined
          ? {}
          : { speedMetersPerSecond: point.speedMetersPerSecond }),
        quality: point.quality,
        capturedAt: new Date(point.capturedAt),
      })),
    );
    return successResponse(this.contexts, { items });
  }

  @Get('/trips/:tripId/tracking')
  @RequireAuthorization({ context: 'TENANT', permission: 'tracking.read' })
  async tracking(@Param('tripId') tripId: string): Promise<unknown> {
    const projection = await this.trips.tracking(this.contexts.require(), tripId);
    return successResponse(this.contexts, projection);
  }

  @Get('/safety-incidents')
  @RequireAuthorization({ context: 'TENANT', permission: 'safety.incident.read' })
  async incidents(): Promise<unknown> {
    const records = await this.safety.listIncidents(this.contexts.require());
    return successResponse(this.contexts, {
      items: records.map(tenantIncidentProjection),
      nextCursor: null,
    });
  }

  @Get('/safety-incidents/:incidentId')
  @RequireAuthorization({ context: 'TENANT', permission: 'safety.incident.read' })
  async incident(
    @Param('incidentId') incidentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.safety.incident(this.contexts.require(), incidentId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, tenantIncidentProjection(record));
  }

  @Post('/safety-incidents/:incidentId/acknowledgements')
  @RequireAuthorization({ context: 'TENANT', permission: 'safety.incident.manage' })
  acknowledgeIncident(
    @Param('incidentId') incidentId: string,
    @Body() body: SafetyIncidentTransitionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transitionIncident('ACKNOWLEDGE', incidentId, body, ifMatch, key, response);
  }

  @Post('/safety-incidents/:incidentId/escalations')
  @RequireAuthorization({ context: 'TENANT', permission: 'safety.incident.manage' })
  escalateIncident(
    @Param('incidentId') incidentId: string,
    @Body() body: SafetyIncidentTransitionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transitionIncident('ESCALATE', incidentId, body, ifMatch, key, response);
  }

  @Post('/safety-incidents/:incidentId/resolution')
  @RequireAuthorization({ context: 'TENANT', permission: 'safety.incident.manage' })
  resolveIncident(
    @Param('incidentId') incidentId: string,
    @Body() body: SafetyIncidentTransitionDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transitionIncident('RESOLVE', incidentId, body, ifMatch, key, response);
  }

  private async transition(
    command: TripCommand,
    tripId: string,
    body: {
      readonly reasonCode: string;
      readonly reason?: string;
      readonly pickupOdometerMeters?: bigint | string;
      readonly completionOdometerMeters?: bigint;
      readonly distanceMeters?: bigint;
      readonly finalFareMinor?: bigint;
      readonly finalFareCurrency?: 'NPR';
      readonly finalFareProvenance?: string;
    },
    ifMatch: string | undefined,
    key: string | undefined,
    response: Response,
  ): Promise<unknown> {
    const pickupOdometerMeters = body.pickupOdometerMeters;
    const result = await this.trips.transition(
      this.contexts.require(),
      idempotencyKey(key),
      tripId,
      expectedVersion(ifMatch),
      command,
      {
        reasonCode: body.reasonCode,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
        ...(pickupOdometerMeters === undefined
          ? {}
          : {
              pickupOdometerMeters:
                typeof pickupOdometerMeters === 'string'
                  ? BigInt(pickupOdometerMeters)
                  : pickupOdometerMeters,
            }),
        ...(body.completionOdometerMeters === undefined
          ? {}
          : { completionOdometerMeters: body.completionOdometerMeters }),
        ...(body.distanceMeters === undefined ? {} : { distanceMeters: body.distanceMeters }),
        ...(body.finalFareMinor === undefined ? {} : { finalFareMinor: body.finalFareMinor }),
        ...(body.finalFareCurrency === undefined
          ? {}
          : { finalFareCurrency: body.finalFareCurrency }),
        ...(body.finalFareProvenance === undefined
          ? {}
          : { finalFareProvenance: body.finalFareProvenance }),
      },
    );
    return idempotentResponse(this.contexts, result, response);
  }

  private async transitionIncident(
    action: 'ACKNOWLEDGE' | 'ESCALATE' | 'RESOLVE',
    incidentId: string,
    body: SafetyIncidentTransitionDto,
    ifMatch: string | undefined,
    key: string | undefined,
    response: Response,
  ): Promise<unknown> {
    const result = await this.safety.transition(
      this.contexts.require(),
      idempotencyKey(key),
      incidentId,
      expectedVersion(ifMatch),
      action,
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }
}
