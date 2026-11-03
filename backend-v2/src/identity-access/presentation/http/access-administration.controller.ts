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

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import type {
  IdempotentResult,
  JsonValue,
} from '../../../shared/application/idempotency/idempotency.js';
import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { successResponse } from '../../../shared/presentation/http/success-response.js';
import {
  ACCESS_ADMINISTRATION_SERVICE,
  type AccessAdministrationServiceToken,
} from '../../identity-access.tokens.js';
import {
  AssignmentCreationDto,
  AuthorityGrantCreationDto,
  RetirementDto,
  RevocationDto,
  RoleMutationDto,
  RoleProfileMutationDto,
} from './access-administration.dto.js';
import { RequireAuthorization } from './route-authorization.decorator.js';

function expectedVersion(ifMatch: string | undefined): number {
  if (ifMatch === undefined) {
    throw new ApplicationError({
      code: 'REQUEST.PRECONDITION_REQUIRED',
      message: 'An If-Match version is required.',
      status: 428,
    });
  }
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(ifMatch.trim());
  const version = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ApplicationError({
      code: 'REQUEST.IF_MATCH_INVALID',
      message: 'The If-Match version is invalid.',
      status: 400,
      details: [{ field: 'If-Match', code: 'INVALID' }],
    });
  }
  return version;
}

function idempotencyKey(value: string | undefined): string {
  return value ?? '';
}

@Controller('/api/v1')
export class AccessAdministrationController {
  constructor(
    @Inject(ACCESS_ADMINISTRATION_SERVICE)
    private readonly administration: AccessAdministrationServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Get('/access/permissions')
  @RequireAuthorization({ context: 'TENANT', permission: 'access.role.read' })
  async permissions(): Promise<unknown> {
    const items = await this.administration.listPermissions(this.contexts.require());
    return successResponse(this.contexts, { items, nextCursor: null });
  }

  @Get('/tenant/access/roles')
  @RequireAuthorization({ context: 'TENANT', permission: 'access.role.read' })
  async roles(): Promise<unknown> {
    const items = await this.administration.listRoles(this.contexts.require());
    return successResponse(this.contexts, { items, nextCursor: null });
  }

  @Get('/tenant/access/roles/:roleId')
  @RequireAuthorization({ context: 'TENANT', permission: 'access.role.read' })
  async role(
    @Param('roleId') roleId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const role = await this.administration.role(this.contexts.require(), roleId);
    response.setHeader('ETag', `"${String(role.version)}"`);
    return successResponse(this.contexts, role);
  }

  @Post('/tenant/access/roles')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'access.role.manage',
    minimumAssurance: 'AAL2',
  })
  @HttpCode(201)
  async createRole(
    @Body() body: RoleMutationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.createRole(
      this.contexts.require(),
      idempotencyKey(key),
      body,
    );
    return this.idempotentResponse(result, response);
  }

  @Patch('/tenant/access/roles/:roleId')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'access.role.manage',
    minimumAssurance: 'AAL2',
  })
  async updateRole(
    @Param('roleId') roleId: string,
    @Body() body: RoleMutationDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.updateRole(
      this.contexts.require(),
      idempotencyKey(key),
      roleId,
      {
        expectedVersion: expectedVersion(ifMatch),
        name: body.name,
        description: body.description,
        permissionCodes: body.permissionCodes,
        reason: body.reason,
      },
    );
    return this.idempotentResponse(result, response);
  }

  @Post('/tenant/access/roles/:roleId/retirement')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'access.role.manage',
    minimumAssurance: 'AAL2',
  })
  async retireRole(
    @Param('roleId') roleId: string,
    @Body() body: RetirementDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.retireRole(
      this.contexts.require(),
      idempotencyKey(key),
      roleId,
      expectedVersion(ifMatch),
      body.reason,
    );
    return this.idempotentResponse(result, response);
  }

  @Get('/tenant/access/role-profiles')
  @RequireAuthorization({ context: 'TENANT', permission: 'access.role.read' })
  async roleProfiles(): Promise<unknown> {
    const items = await this.administration.listRoleProfiles(this.contexts.require());
    return successResponse(this.contexts, { items, nextCursor: null });
  }

  @Get('/tenant/access/role-profiles/:profileId')
  @RequireAuthorization({ context: 'TENANT', permission: 'access.role.read' })
  async roleProfile(
    @Param('profileId') profileId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const profile = await this.administration.roleProfile(this.contexts.require(), profileId);
    response.setHeader('ETag', `"${String(profile.version)}"`);
    return successResponse(this.contexts, profile);
  }

  @Post('/tenant/access/role-profiles')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'access.role.manage',
    minimumAssurance: 'AAL2',
  })
  @HttpCode(201)
  async createRoleProfile(
    @Body() body: RoleProfileMutationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.createRoleProfile(
      this.contexts.require(),
      idempotencyKey(key),
      body,
    );
    return this.idempotentResponse(result, response);
  }

  @Patch('/tenant/access/role-profiles/:profileId')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'access.role.manage',
    minimumAssurance: 'AAL2',
  })
  async updateRoleProfile(
    @Param('profileId') profileId: string,
    @Body() body: RoleProfileMutationDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.updateRoleProfile(
      this.contexts.require(),
      idempotencyKey(key),
      profileId,
      {
        expectedVersion: expectedVersion(ifMatch),
        name: body.name,
        description: body.description,
        scopeCeiling: body.scopeCeiling,
        roleIds: body.roleIds,
        reason: body.reason,
      },
    );
    return this.idempotentResponse(result, response);
  }

  @Post('/tenant/access/role-profiles/:profileId/retirement')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'access.role.manage',
    minimumAssurance: 'AAL2',
  })
  async retireRoleProfile(
    @Param('profileId') profileId: string,
    @Body() body: RetirementDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.retireRoleProfile(
      this.contexts.require(),
      idempotencyKey(key),
      profileId,
      expectedVersion(ifMatch),
      body.reason,
    );
    return this.idempotentResponse(result, response);
  }

  @Get('/tenant/access/assignments')
  @RequireAuthorization({ context: 'TENANT', permission: 'access.assignment.read' })
  async assignments(): Promise<unknown> {
    const items = await this.administration.listAssignments(this.contexts.require());
    return successResponse(this.contexts, { items, nextCursor: null });
  }

  @Get('/tenant/access/assignments/:assignmentId')
  @RequireAuthorization({ context: 'TENANT', permission: 'access.assignment.read' })
  async assignment(@Param('assignmentId') assignmentId: string): Promise<unknown> {
    const assignment = await this.administration.assignment(this.contexts.require(), assignmentId);
    return successResponse(this.contexts, assignment);
  }

  @Post('/tenant/access/assignments')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'access.assignment.manage',
    minimumAssurance: 'AAL2',
  })
  @HttpCode(201)
  async createAssignment(
    @Body() body: AssignmentCreationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.createAssignment(
      this.contexts.require(),
      idempotencyKey(key),
      {
        userId: body.userId,
        roleProfileId: body.roleProfileId,
        scopeType: body.scopeType,
        facilityIds: body.facilityIds,
        validFrom: new Date(body.validFrom),
        validUntil: new Date(body.validUntil),
        reason: body.reason,
      },
    );
    return this.idempotentResponse(result, response);
  }

  @Post('/tenant/access/assignments/:assignmentId/revocation')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'access.assignment.manage',
    minimumAssurance: 'AAL2',
  })
  async revokeAssignment(
    @Param('assignmentId') assignmentId: string,
    @Body() body: RevocationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.revokeAssignment(
      this.contexts.require(),
      idempotencyKey(key),
      assignmentId,
      body.reason,
    );
    return this.idempotentResponse(result, response);
  }

  private idempotentResponse(result: IdempotentResult<JsonValue>, response: Response): unknown {
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return successResponse(this.contexts, result.value);
  }
}

@Controller('/api/v1/authority')
export class AuthorityGrantAdministrationController {
  constructor(
    @Inject(ACCESS_ADMINISTRATION_SERVICE)
    private readonly administration: AccessAdministrationServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Get('/grants')
  @RequireAuthorization({ context: 'AUTHORITY', permission: 'access.authority.grant' })
  async grants(): Promise<unknown> {
    const items = await this.administration.listAuthorityGrants(this.contexts.require());
    return successResponse(this.contexts, { items, nextCursor: null });
  }

  @Post('/grants')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'access.authority.grant',
    minimumAssurance: 'AAL2',
  })
  @HttpCode(201)
  async createGrant(
    @Body() body: AuthorityGrantCreationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.createAuthorityGrant(
      this.contexts.require(),
      idempotencyKey(key),
      {
        subjectUserId: body.subjectUserId,
        roleProfileId: body.roleProfileId,
        level: body.level,
        nationalScope: body.nationalScope,
        purpose: body.purpose,
        humanReason: body.humanReason,
        validFrom: new Date(body.validFrom),
        expiresAt: new Date(body.expiresAt),
        permissionCodes: body.permissionCodes,
        resourceClasses: body.resourceClasses,
        geographicUnitIds: body.geographicUnitIds,
        allowsPii: body.allowsPii,
        allowsDocumentContent: body.allowsDocumentContent,
        allowsExport: body.allowsExport,
        allowsIntervention: body.allowsIntervention,
      },
    );
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return successResponse(this.contexts, result.value);
  }

  @Post('/grants/:grantId/approval')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'access.authority.grant',
    minimumAssurance: 'AAL2',
  })
  async approveGrant(
    @Param('grantId') grantId: string,
    @Body() body: RevocationDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.approveAuthorityGrant(
      this.contexts.require(),
      idempotencyKey(key),
      grantId,
      expectedVersion(ifMatch),
      body.reason,
    );
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return successResponse(this.contexts, result.value);
  }

  @Post('/grants/:grantId/revocation')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'access.authority.grant',
    minimumAssurance: 'AAL2',
  })
  async revokeGrant(
    @Param('grantId') grantId: string,
    @Body() body: RevocationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.administration.revokeAuthorityGrant(
      this.contexts.require(),
      idempotencyKey(key),
      grantId,
      body.reason,
    );
    response.status(result.status);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return successResponse(this.contexts, result.value);
  }
}
