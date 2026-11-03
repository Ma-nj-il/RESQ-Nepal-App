import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import {
  AUTHORIZATION_SERVICE,
  type AuthorizationServiceToken,
} from '../../identity-access.tokens.js';
import type { RouteAuthorizationRequirement } from '../../application/authorization.service.js';
import { ROUTE_AUTHORIZATION } from './route-authorization.decorator.js';

function bearerToken(request: Request): string {
  const authorization = request.header('authorization');
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization ?? '');
  if (match?.[1] === undefined) {
    throw new ApplicationError({
      code: 'AUTH.AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.',
      status: 401,
    });
  }
  return match[1];
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
    @Inject(AUTHORIZATION_SERVICE) private readonly authorization: AuthorizationServiceToken,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<RouteAuthorizationRequirement | undefined>(
      ROUTE_AUTHORIZATION,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    if (requirement === undefined) return true;
    const request = executionContext.switchToHttp().getRequest<Request>();
    const tenantId = request.header('x-tenant-id');
    const facilityId = request.header('x-facility-id');
    const authorityGrantId = request.header('x-authority-grant-id');
    const resolved = await this.authorization.authorize(
      this.contexts.require(),
      bearerToken(request),
      {
        ...(tenantId === undefined ? {} : { tenantId }),
        ...(facilityId === undefined ? {} : { facilityId }),
        ...(authorityGrantId === undefined ? {} : { authorityGrantId }),
      },
      requirement,
    );
    this.contexts.replace(resolved);
    return true;
  }
}
