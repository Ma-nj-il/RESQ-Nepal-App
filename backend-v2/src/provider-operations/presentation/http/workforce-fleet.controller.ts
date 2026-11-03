import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { RequireAuthorization } from '../../../identity-access/presentation/http/route-authorization.decorator.js';
import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { successResponse } from '../../../shared/presentation/http/success-response.js';
import type {
  AmbulanceRecord,
  DriverApplicationRecord,
  DriverRecord,
  MaintenanceRecord,
} from '../../application/ports/provider-operations.repository.js';
import {
  WORKFORCE_FLEET_SERVICE,
  type WorkforceFleetServiceToken,
} from '../../provider-operations.tokens.js';
import { expectedVersion, idempotencyKey, idempotentResponse } from './command-http.js';
import {
  AmbulanceComplianceReviewDto,
  AmbulanceMutationDto,
  AmbulanceOperationalStatusChangeDto,
  AmbulanceUpdateDto,
  DriverAccountStatusChangeDto,
  DriverApplicationCreationDto,
  DriverDutyStatusChangeDto,
  EquipmentUpsertDto,
  MaintenanceCreationDto,
  ReasonDto,
} from './provider-operations.dto.js';

function driverApplicationJson(record: DriverApplicationRecord): Readonly<Record<string, unknown>> {
  return {
    ...record,
    submittedAt: record.submittedAt?.toISOString() ?? null,
  };
}

function driverJson(record: DriverRecord): Readonly<Record<string, unknown>> {
  return {
    ...record,
    eligible: record.eligibilityReasons.length === 0,
    facilityIds: [...record.facilityIds],
    eligibilityReasons: [...record.eligibilityReasons],
  };
}

function ambulanceJson(record: AmbulanceRecord): Readonly<Record<string, unknown>> {
  return { ...record, readinessReasons: [...record.readinessReasons] };
}

function maintenanceJson(record: MaintenanceRecord): Readonly<Record<string, unknown>> {
  return { ...record, scheduledFor: record.scheduledFor.toISOString() };
}

@Controller('/api/v1/me/driver-applications')
@RequireAuthorization({ context: 'SELF' })
export class DriverApplicationsController {
  constructor(
    @Inject(WORKFORCE_FLEET_SERVICE) private readonly operations: WorkforceFleetServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: DriverApplicationCreationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.createDriverApplication(
      this.contexts.require(),
      idempotencyKey(key),
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Get()
  async applications(): Promise<unknown> {
    const items = await this.operations.listOwnDriverApplications(this.contexts.require());
    return successResponse(this.contexts, {
      items: items.map(driverApplicationJson),
      nextCursor: null,
    });
  }

  @Post('/:applicationId/submission')
  async submit(
    @Param('applicationId') applicationId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.submitDriverApplication(
      this.contexts.require(),
      idempotencyKey(key),
      applicationId,
      expectedVersion(ifMatch),
    );
    return idempotentResponse(this.contexts, result, response);
  }
}

@Controller('/api/v1/tenant')
export class TenantWorkforceFleetController {
  constructor(
    @Inject(WORKFORCE_FLEET_SERVICE) private readonly operations: WorkforceFleetServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Get('/driver-applications')
  @RequireAuthorization({ context: 'TENANT', permission: 'driver.verify' })
  async driverApplications(): Promise<unknown> {
    const items = await this.operations.listTenantDriverApplications(this.contexts.require());
    return successResponse(this.contexts, {
      items: items.map(driverApplicationJson),
      nextCursor: null,
    });
  }

  @Post('/driver-applications/:applicationId/information-requests')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'driver.verify',
    minimumAssurance: 'AAL2',
  })
  requestDriverInformation(
    @Param('applicationId') applicationId: string,
    @Body() body: ReasonDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.driverReview('INFORMATION', applicationId, body, ifMatch, key, response);
  }

  @Post('/driver-applications/:applicationId/rejections')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'driver.verify',
    minimumAssurance: 'AAL2',
  })
  rejectDriver(
    @Param('applicationId') applicationId: string,
    @Body() body: ReasonDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.driverReview('REJECT', applicationId, body, ifMatch, key, response);
  }

  @Post('/driver-applications/:applicationId/approvals')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'driver.verify',
    minimumAssurance: 'AAL2',
  })
  async approveDriver(
    @Param('applicationId') applicationId: string,
    @Body() body: ReasonDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.approveDriverApplication(
      this.contexts.require(),
      idempotencyKey(key),
      applicationId,
      expectedVersion(ifMatch),
      body.reason,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Get('/drivers')
  @RequireAuthorization({ context: 'TENANT', permission: 'driver.read' })
  async drivers(): Promise<unknown> {
    const items = await this.operations.listDrivers(this.contexts.require());
    return successResponse(this.contexts, { items: items.map(driverJson), nextCursor: null });
  }

  @Get('/drivers/:driverId')
  @RequireAuthorization({ context: 'TENANT', permission: 'driver.read' })
  async driver(
    @Param('driverId') driverId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.operations.driver(this.contexts.require(), driverId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, driverJson(record));
  }

  @Post('/drivers/:driverId/account-status-changes')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'driver.suspend',
    minimumAssurance: 'AAL2',
  })
  async changeDriverAccountStatus(
    @Param('driverId') driverId: string,
    @Body() body: DriverAccountStatusChangeDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.changeDriverAccountStatus(
      this.contexts.require(),
      idempotencyKey(key),
      driverId,
      expectedVersion(ifMatch),
      body.status,
      body.reason,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Post('/drivers/:driverId/duty-status-changes')
  @RequireAuthorization({ context: 'TENANT', permission: 'driver.manage' })
  async changeDriverDutyStatus(
    @Param('driverId') driverId: string,
    @Body() body: DriverDutyStatusChangeDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.changeDriverDutyStatus(
      this.contexts.require(),
      idempotencyKey(key),
      driverId,
      expectedVersion(ifMatch),
      body.status,
      body.reason,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Get('/ambulances')
  @RequireAuthorization({ context: 'TENANT', permission: 'ambulance.read' })
  async ambulances(): Promise<unknown> {
    const items = await this.operations.listAmbulances(this.contexts.require());
    return successResponse(this.contexts, { items: items.map(ambulanceJson), nextCursor: null });
  }

  @Post('/ambulances')
  @RequireAuthorization({ context: 'TENANT', permission: 'ambulance.manage' })
  @HttpCode(201)
  async createAmbulance(
    @Body() body: AmbulanceMutationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.createAmbulance(
      this.contexts.require(),
      idempotencyKey(key),
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Get('/ambulances/:ambulanceId')
  @RequireAuthorization({ context: 'TENANT', permission: 'ambulance.read' })
  async ambulance(
    @Param('ambulanceId') ambulanceId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.operations.ambulance(this.contexts.require(), ambulanceId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, ambulanceJson(record));
  }

  @Patch('/ambulances/:ambulanceId')
  @RequireAuthorization({ context: 'TENANT', permission: 'ambulance.manage' })
  async updateAmbulance(
    @Param('ambulanceId') ambulanceId: string,
    @Body() body: AmbulanceUpdateDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.updateAmbulance(
      this.contexts.require(),
      idempotencyKey(key),
      ambulanceId,
      expectedVersion(ifMatch),
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Post('/ambulances/:ambulanceId/operational-status-changes')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'ambulance.status.change',
    minimumAssurance: 'AAL2',
  })
  async changeAmbulanceStatus(
    @Param('ambulanceId') ambulanceId: string,
    @Body() body: AmbulanceOperationalStatusChangeDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.changeAmbulanceOperationalStatus(
      this.contexts.require(),
      idempotencyKey(key),
      ambulanceId,
      expectedVersion(ifMatch),
      body.status,
      body.reason,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Get('/ambulances/:ambulanceId/maintenance-records')
  @RequireAuthorization({ context: 'TENANT', permission: 'maintenance.read' })
  async maintenance(@Param('ambulanceId') ambulanceId: string): Promise<unknown> {
    const items = await this.operations.listMaintenance(this.contexts.require(), ambulanceId);
    return successResponse(this.contexts, { items: items.map(maintenanceJson), nextCursor: null });
  }

  @Post('/ambulances/:ambulanceId/maintenance-records')
  @RequireAuthorization({ context: 'TENANT', permission: 'maintenance.manage' })
  @HttpCode(201)
  async createMaintenance(
    @Param('ambulanceId') ambulanceId: string,
    @Body() body: MaintenanceCreationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.createMaintenance(
      this.contexts.require(),
      idempotencyKey(key),
      ambulanceId,
      {
        maintenanceType: body.maintenanceType,
        status: body.status,
        scheduledFor: new Date(body.scheduledFor),
        ...(body.odometerMeters === undefined ? {} : { odometerMeters: body.odometerMeters }),
        notes: body.notes,
      },
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Put('/ambulances/:ambulanceId/equipment')
  @RequireAuthorization({ context: 'TENANT', permission: 'ambulance.manage' })
  async upsertEquipment(
    @Param('ambulanceId') ambulanceId: string,
    @Body() body: EquipmentUpsertDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.upsertEquipment(
      this.contexts.require(),
      idempotencyKey(key),
      ambulanceId,
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  private async driverReview(
    command: 'INFORMATION' | 'REJECT',
    applicationId: string,
    body: ReasonDto,
    ifMatch: string | undefined,
    key: string | undefined,
    response: Response,
  ): Promise<unknown> {
    const context = this.contexts.require();
    const version = expectedVersion(ifMatch);
    const idempotency = idempotencyKey(key);
    const result =
      command === 'INFORMATION'
        ? await this.operations.requestDriverInformation(
            context,
            idempotency,
            applicationId,
            version,
            body.reason,
          )
        : await this.operations.rejectDriverApplication(
            context,
            idempotency,
            applicationId,
            version,
            body.reason,
          );
    return idempotentResponse(this.contexts, result, response);
  }
}

@Controller('/api/v1/authority')
export class AuthorityWorkforceFleetController {
  constructor(
    @Inject(WORKFORCE_FLEET_SERVICE) private readonly operations: WorkforceFleetServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Get('/drivers')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'driver.read',
    resourceClass: 'driver',
  })
  async drivers(): Promise<unknown> {
    const items = await this.operations.listDrivers(this.contexts.require());
    return successResponse(this.contexts, { items: items.map(driverJson), nextCursor: null });
  }

  @Get('/ambulances')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'ambulance.read',
    resourceClass: 'ambulance',
  })
  async ambulances(): Promise<unknown> {
    const items = await this.operations.listAmbulances(this.contexts.require());
    return successResponse(this.contexts, { items: items.map(ambulanceJson), nextCursor: null });
  }

  @Post('/ambulances/:ambulanceId/compliance-reviews')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'document.review',
    resourceClass: 'ambulance',
    minimumAssurance: 'AAL2',
  })
  async reviewAmbulanceCompliance(
    @Param('ambulanceId') ambulanceId: string,
    @Body() body: AmbulanceComplianceReviewDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.operations.reviewAmbulanceCompliance(
      this.contexts.require(),
      idempotencyKey(key),
      ambulanceId,
      expectedVersion(ifMatch),
      body.status,
      body.reason,
    );
    return idempotentResponse(this.contexts, result, response);
  }
}
