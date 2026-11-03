import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { RequireAuthorization } from '../../../identity-access/presentation/http/route-authorization.decorator.js';
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
import {
  authorityBookingProjection,
  authorityIncidentProjection,
  authorityTripProjection,
} from './core-dispatch.projections.js';

@Controller('/api/v1/authority')
export class AuthorityDispatchController {
  constructor(
    @Inject(BOOKING_DISPATCH_SERVICE) private readonly bookings: BookingDispatchServiceToken,
    @Inject(TRIP_TRACKING_SERVICE) private readonly trips: TripTrackingServiceToken,
    @Inject(SAFETY_SERVICE) private readonly safety: SafetyServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Get('/bookings')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'booking.read',
    resourceClass: 'booking',
  })
  async bookingsList(): Promise<unknown> {
    const records = await this.bookings.listBookings(this.contexts.require());
    return successResponse(this.contexts, {
      items: records.map(authorityBookingProjection),
      nextCursor: null,
    });
  }

  @Get('/bookings/:bookingId')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'booking.read',
    resourceClass: 'booking',
  })
  async booking(
    @Param('bookingId') bookingId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.bookings.booking(this.contexts.require(), bookingId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, authorityBookingProjection(record));
  }

  @Get('/trips')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'trip.read',
    resourceClass: 'trip',
  })
  async tripsList(): Promise<unknown> {
    const records = await this.trips.listTrips(this.contexts.require());
    return successResponse(this.contexts, {
      items: records.map(authorityTripProjection),
      nextCursor: null,
    });
  }

  @Get('/trips/:tripId')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'trip.read',
    resourceClass: 'trip',
  })
  async trip(
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.trips.trip(this.contexts.require(), tripId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, authorityTripProjection(record));
  }

  @Get('/trips/:tripId/tracking')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'tracking.read',
    resourceClass: 'tracking',
  })
  async tracking(@Param('tripId') tripId: string): Promise<unknown> {
    const projection = await this.trips.tracking(this.contexts.require(), tripId);
    return successResponse(this.contexts, projection);
  }

  @Get('/safety-incidents')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'safety.incident.read',
    resourceClass: 'safety_incident',
  })
  async incidents(): Promise<unknown> {
    const records = await this.safety.listIncidents(this.contexts.require());
    return successResponse(this.contexts, {
      items: records.map(authorityIncidentProjection),
      nextCursor: null,
    });
  }

  @Get('/safety-incidents/:incidentId')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'safety.incident.read',
    resourceClass: 'safety_incident',
  })
  async incident(
    @Param('incidentId') incidentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.safety.incident(this.contexts.require(), incidentId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, authorityIncidentProjection(record));
  }
}
