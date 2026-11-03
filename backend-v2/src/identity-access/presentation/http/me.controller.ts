import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { successResponse } from '../../../shared/presentation/http/success-response.js';
import {
  AUTHENTICATION_SERVICE,
  AUTHORIZATION_SERVICE,
  type AuthenticationServiceToken,
  type AuthorizationServiceToken,
} from '../../identity-access.tokens.js';
import { SessionRevocationsDto } from './authentication.dto.js';
import { RequireAuthorization } from './route-authorization.decorator.js';

@Controller('/api/v1/me')
@RequireAuthorization({ context: 'SELF' })
export class MeController {
  constructor(
    @Inject(AUTHENTICATION_SERVICE) private readonly authentication: AuthenticationServiceToken,
    @Inject(AUTHORIZATION_SERVICE) private readonly authorization: AuthorizationServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Get()
  async me(@Res({ passthrough: true }) response: Response): Promise<unknown> {
    const profile = await this.authorization.profile(this.contexts.require());
    response.setHeader('ETag', `"${String(profile.version)}"`);
    return successResponse(this.contexts, {
      id: profile.id,
      status: profile.status,
      displayName: profile.displayName ?? null,
      phoneMasked: profile.phoneMasked ?? null,
      locale: profile.locale,
      version: profile.version,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    });
  }

  @Get('/access-contexts')
  async accessContexts(): Promise<unknown> {
    const contexts = await this.authorization.accessContexts(this.contexts.require());
    return successResponse(this.contexts, {
      tenantAssignments: contexts.tenantAssignments.map((assignment) => ({
        ...assignment,
        validUntil: assignment.validUntil.toISOString(),
      })),
      authorityGrants: contexts.authorityGrants.map((grant) => ({
        ...grant,
        expiresAt: grant.expiresAt.toISOString(),
      })),
    });
  }

  @Get('/sessions')
  async sessions(): Promise<unknown> {
    const sessions = await this.authentication.listSessions(this.contexts.require());
    return successResponse(this.contexts, {
      items: sessions.map((session) => ({
        id: session.sessionId,
        clientType: session.clientType,
        deviceLabel: session.deviceLabel ?? null,
        assurance: session.assurance,
        current: session.current,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
        revokedAt: session.revokedAt?.toISOString() ?? null,
      })),
      nextCursor: null,
    });
  }

  @Delete('/sessions/:sessionId')
  @HttpCode(204)
  async revokeSession(@Param('sessionId') sessionId: string): Promise<void> {
    await this.authentication.revokeOwnedSession(this.contexts.require(), sessionId);
  }

  @Post('/session-revocations')
  @HttpCode(200)
  async revokeSessions(@Body() body: SessionRevocationsDto): Promise<unknown> {
    const revokedCount = await this.authentication.revokeSessions(
      this.contexts.require(),
      body.scope === 'ALL',
    );
    return successResponse(this.contexts, { revokedCount });
  }
}
