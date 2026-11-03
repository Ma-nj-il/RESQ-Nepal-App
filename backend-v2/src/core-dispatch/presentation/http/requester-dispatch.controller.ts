import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { RequireAuthorization } from '../../../identity-access/presentation/http/route-authorization.decorator.js';
import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { successResponse } from '../../../shared/presentation/http/success-response.js';
import { fareQuoteJson } from '../../application/core-dispatch-json.js';
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
  BookingCreationDto,
  DispatchListQueryDto,
  CoverageCheckDto,
  FareQuoteCreationDto,
  ReasonCommandDto,
  SafetyIncidentCreationDto,
} from './core-dispatch.dto.js';
import {
  involvedTimelineProjection,
  dispatchPage,
  requesterAssignmentProjection,
  requesterBookingProjection,
  requesterIncidentProjection,
  requesterTripProjection,
  serviceCoverageProjection,
} from './core-dispatch.projections.js';

@Controller('/api/v1')
@RequireAuthorization({ context: 'SELF' })
export class RequesterDispatchController {
  constructor(
    @Inject(BOOKING_DISPATCH_SERVICE) private readonly bookings: BookingDispatchServiceToken,
    @Inject(TRIP_TRACKING_SERVICE) private readonly trips: TripTrackingServiceToken,
    @Inject(SAFETY_SERVICE) private readonly safety: SafetyServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Post('/service-coverage-checks')
  async coverage(@Body() body: CoverageCheckDto): Promise<unknown> {
    const records = await this.bookings.coverage(this.contexts.require(), body.serviceCategory, {
      latitude: body.pickupLatitude,
      longitude: body.pickupLongitude,
    });
    return successResponse(this.contexts, serviceCoverageProjection(body.serviceCategory, records));
  }

  @Post('/fare-quotes')
  @HttpCode(201)
  async createFareQuote(@Body() body: FareQuoteCreationDto): Promise<unknown> {
    const record = await this.bookings.createFareQuote(this.contexts.require(), {
      serviceCategory: body.serviceCategory,
      pickup: { latitude: body.pickupLatitude, longitude: body.pickupLongitude },
      destination: {
        latitude: body.destinationLatitude,
        longitude: body.destinationLongitude,
      },
    });
    return successResponse(this.contexts, fareQuoteJson(record));
  }

  @Post('/bookings')
  @HttpCode(201)
  async createBooking(
    @Body() body: BookingCreationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.bookings.createBooking(this.contexts.require(), idempotencyKey(key), {
      fareQuoteId: body.fareQuoteId,
      serviceCategory: body.serviceCategory,
      pickupGeographicUnitId: body.pickupGeographicUnitId,
      ...(body.destinationGeographicUnitId === undefined
        ? {}
        : { destinationGeographicUnitId: body.destinationGeographicUnitId }),
      urgency: body.urgency,
      pickup: { latitude: body.pickupLatitude, longitude: body.pickupLongitude },
      destination: {
        latitude: body.destinationLatitude,
        longitude: body.destinationLongitude,
      },
      patient: {
        name: body.patientName,
        ...(body.patientPhone === undefined ? {} : { phone: body.patientPhone }),
        pickupContactName: body.pickupContactName,
        pickupContactPhone: body.pickupContactPhone,
        ...(body.assistanceNotes === undefined ? {} : { assistanceNotes: body.assistanceNotes }),
      },
      consentFlags: {
        emergencyTransport: body.emergencyTransportConsent,
        locationSharing: body.locationSharingConsent,
      },
    });
    return idempotentResponse(this.contexts, result, response);
  }

  @Get('/bookings')
  async listBookings(@Query() query: DispatchListQueryDto = {}): Promise<unknown> {
    const records = await this.bookings.listBookings(this.contexts.require(), query.afterId);
    return successResponse(this.contexts, dispatchPage(records, requesterBookingProjection));
  }

  @Get('/bookings/:bookingId')
  async booking(
    @Param('bookingId') bookingId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.bookings.booking(this.contexts.require(), bookingId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, requesterBookingProjection(record));
  }

  @Get('/bookings/:bookingId/timeline')
  async timeline(@Param('bookingId') bookingId: string): Promise<unknown> {
    const records = await this.bookings.timeline(this.contexts.require(), bookingId);
    return successResponse(this.contexts, {
      items: records.map(involvedTimelineProjection),
      nextCursor: null,
    });
  }

  @Get('/bookings/:bookingId/assignment')
  async assignment(@Param('bookingId') bookingId: string): Promise<unknown> {
    const record = await this.bookings.assignment(this.contexts.require(), bookingId);
    return successResponse(this.contexts, requesterAssignmentProjection(record));
  }

  @Post('/bookings/:bookingId/cancellation')
  async cancelBooking(
    @Param('bookingId') bookingId: string,
    @Body() body: ReasonCommandDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.bookings.cancelBooking(
      this.contexts.require(),
      idempotencyKey(key),
      bookingId,
      expectedVersion(ifMatch),
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Get('/trips')
  async listTrips(@Query() query: DispatchListQueryDto = {}): Promise<unknown> {
    const records = await this.trips.listTrips(this.contexts.require(), query.afterId);
    return successResponse(this.contexts, dispatchPage(records, requesterTripProjection));
  }

  @Get('/trips/:tripId')
  async trip(
    @Param('tripId') tripId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.trips.trip(this.contexts.require(), tripId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, requesterTripProjection(record));
  }

  @Get('/trips/:tripId/tracking')
  async tracking(@Param('tripId') tripId: string): Promise<unknown> {
    const projection = await this.trips.tracking(this.contexts.require(), tripId);
    return successResponse(this.contexts, projection);
  }

  @Post('/safety-incidents')
  @HttpCode(201)
  async createIncident(
    @Body() body: SafetyIncidentCreationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.safety.createIncident(this.contexts.require(), idempotencyKey(key), {
      ...(body.tripId === undefined ? {} : { tripId: body.tripId }),
      incidentType: body.incidentType,
      severity: body.severity,
      details: { narrative: body.details },
    });
    return idempotentResponse(this.contexts, result, response);
  }

  @Get('/safety-incidents/:incidentId')
  async incident(
    @Param('incidentId') incidentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.safety.incident(this.contexts.require(), incidentId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, requesterIncidentProjection(record));
  }
}
