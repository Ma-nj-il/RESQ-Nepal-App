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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { RequireAuthorization } from '../../../identity-access/presentation/http/route-authorization.decorator.js';
import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { successResponse } from '../../../shared/presentation/http/success-response.js';
import type {
  FacilityRecord,
  ProviderApplicationRecord,
  ProviderOrganizationRecord,
} from '../../application/ports/provider-operations.repository.js';
import {
  PROVIDER_REGISTRY_SERVICE,
  type ProviderRegistryServiceToken,
} from '../../provider-operations.tokens.js';
import { expectedVersion, idempotencyKey, idempotentResponse } from './command-http.js';
import { ProviderApplicationMutationDto, ReasonDto } from './provider-operations.dto.js';

function applicationJson(record: ProviderApplicationRecord): Readonly<Record<string, unknown>> {
  return {
    id: record.id,
    applicantUserId: record.applicantUserId,
    legalName: record.legalName,
    displayName: record.displayName,
    registrationNumber: record.registrationNumber,
    geographicUnitId: record.geographicUnitId,
    facilityName: record.facilityName,
    facilityType: record.facilityType,
    publicPhone: record.publicPhone ?? null,
    status: record.status,
    version: record.version,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    tenantId: record.tenantId ?? null,
    facilityId: record.facilityId ?? null,
  };
}

function providerJson(record: ProviderOrganizationRecord): Readonly<Record<string, unknown>> {
  return {
    id: record.id,
    legalName: record.legalName,
    displayName: record.displayName,
    registrationNumber: record.registrationNumber ?? null,
    operatingStatus: record.operatingStatus,
    version: record.version,
  };
}

function facilityJson(record: FacilityRecord): Readonly<Record<string, unknown>> {
  return {
    id: record.id,
    tenantId: record.tenantId,
    geographicUnitId: record.geographicUnitId,
    name: record.name,
    facilityType: record.facilityType,
    operatingStatus: record.operatingStatus,
    publicPhone: record.publicPhone ?? null,
    version: record.version,
  };
}

abstract class ProviderDirectoryHttpController {
  protected constructor(
    protected readonly registry: ProviderRegistryServiceToken,
    protected readonly contexts: RequestContextStorage,
  ) {}

  protected async providers(): Promise<unknown> {
    const items = await this.registry.listProviderOrganizations(this.contexts.require());
    return successResponse(this.contexts, { items: items.map(providerJson), nextCursor: null });
  }

  protected async facilities(): Promise<unknown> {
    const items = await this.registry.listFacilities(this.contexts.require());
    return successResponse(this.contexts, { items: items.map(facilityJson), nextCursor: null });
  }
}

@Controller('/api/v1/tenant')
export class TenantProviderDirectoryController extends ProviderDirectoryHttpController {
  constructor(
    @Inject(PROVIDER_REGISTRY_SERVICE) registry: ProviderRegistryServiceToken,
    @Inject(RequestContextStorage) contexts: RequestContextStorage,
  ) {
    super(registry, contexts);
  }

  @Get('/providers')
  @RequireAuthorization({ context: 'TENANT', permission: 'provider.read' })
  providerList(): Promise<unknown> {
    return this.providers();
  }

  @Get('/facilities')
  @RequireAuthorization({ context: 'TENANT', permission: 'facility.read' })
  facilityList(): Promise<unknown> {
    return this.facilities();
  }
}

@Controller('/api/v1/authority')
export class AuthorityProviderDirectoryController extends ProviderDirectoryHttpController {
  constructor(
    @Inject(PROVIDER_REGISTRY_SERVICE) registry: ProviderRegistryServiceToken,
    @Inject(RequestContextStorage) contexts: RequestContextStorage,
  ) {
    super(registry, contexts);
  }

  @Get('/providers')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'provider.read',
    resourceClass: 'provider',
  })
  providerList(): Promise<unknown> {
    return this.providers();
  }

  @Get('/facilities')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'facility.read',
    resourceClass: 'facility',
  })
  facilityList(): Promise<unknown> {
    return this.facilities();
  }
}

@Controller('/api/v1/provider-applications')
@RequireAuthorization({ context: 'SELF' })
export class ProviderApplicationsController {
  constructor(
    @Inject(PROVIDER_REGISTRY_SERVICE) private readonly registry: ProviderRegistryServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: ProviderApplicationMutationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.registry.createApplication(
      this.contexts.require(),
      idempotencyKey(key),
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Get('/:applicationId')
  async application(
    @Param('applicationId') applicationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.registry.application(this.contexts.require(), applicationId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, applicationJson(record));
  }

  @Patch('/:applicationId')
  async update(
    @Param('applicationId') applicationId: string,
    @Body() body: ProviderApplicationMutationDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.registry.updateApplication(
      this.contexts.require(),
      idempotencyKey(key),
      applicationId,
      expectedVersion(ifMatch),
      body,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Post('/:applicationId/submission')
  async submit(
    @Param('applicationId') applicationId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.registry.submit(
      this.contexts.require(),
      idempotencyKey(key),
      applicationId,
      expectedVersion(ifMatch),
    );
    return idempotentResponse(this.contexts, result, response);
  }

  @Post('/:applicationId/withdrawal')
  async withdraw(
    @Param('applicationId') applicationId: string,
    @Body() body: ReasonDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.registry.withdraw(
      this.contexts.require(),
      idempotencyKey(key),
      applicationId,
      expectedVersion(ifMatch),
      body.reason,
    );
    return idempotentResponse(this.contexts, result, response);
  }
}

@Controller('/api/v1/authority/provider-applications')
export class AuthorityProviderApplicationsController {
  constructor(
    @Inject(PROVIDER_REGISTRY_SERVICE) private readonly registry: ProviderRegistryServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Get()
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'provider.review',
    resourceClass: 'provider',
  })
  async applications(): Promise<unknown> {
    const records = await this.registry.listForAuthority(this.contexts.require());
    return successResponse(this.contexts, {
      items: records.map(applicationJson),
      nextCursor: null,
    });
  }

  @Get('/:applicationId')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'provider.review',
    resourceClass: 'provider',
  })
  async application(
    @Param('applicationId') applicationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const record = await this.registry.application(this.contexts.require(), applicationId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, applicationJson(record));
  }

  @Post('/:applicationId/information-requests')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'provider.review',
    resourceClass: 'provider',
    minimumAssurance: 'AAL2',
  })
  informationRequest(
    @Param('applicationId') applicationId: string,
    @Body() body: ReasonDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.reviewCommand('INFORMATION', applicationId, body, ifMatch, key, response);
  }

  @Post('/:applicationId/recommendations')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'provider.review',
    resourceClass: 'provider',
    minimumAssurance: 'AAL2',
  })
  recommendation(
    @Param('applicationId') applicationId: string,
    @Body() body: ReasonDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.reviewCommand('RECOMMEND', applicationId, body, ifMatch, key, response);
  }

  @Post('/:applicationId/rejections')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'provider.review',
    resourceClass: 'provider',
    minimumAssurance: 'AAL2',
  })
  rejection(
    @Param('applicationId') applicationId: string,
    @Body() body: ReasonDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.reviewCommand('REJECT', applicationId, body, ifMatch, key, response);
  }

  @Post('/:applicationId/approvals')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'provider.review',
    resourceClass: 'provider',
    minimumAssurance: 'AAL2',
  })
  async approval(
    @Param('applicationId') applicationId: string,
    @Body() body: ReasonDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.registry.approve(
      this.contexts.require(),
      idempotencyKey(key),
      applicationId,
      expectedVersion(ifMatch),
      body.reason,
    );
    return idempotentResponse(this.contexts, result, response);
  }

  private async reviewCommand(
    command: 'INFORMATION' | 'RECOMMEND' | 'REJECT',
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
        ? await this.registry.requestInformation(
            context,
            idempotency,
            applicationId,
            version,
            body.reason,
          )
        : command === 'RECOMMEND'
          ? await this.registry.recommend(context, idempotency, applicationId, version, body.reason)
          : await this.registry.reject(context, idempotency, applicationId, version, body.reason);
    return idempotentResponse(this.contexts, result, response);
  }
}
