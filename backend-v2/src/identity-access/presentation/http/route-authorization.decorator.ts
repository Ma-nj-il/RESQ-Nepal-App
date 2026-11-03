import { SetMetadata } from '@nestjs/common';

import type { RouteAuthorizationRequirement } from '../../application/authorization.service.js';

export const ROUTE_AUTHORIZATION = Symbol('ROUTE_AUTHORIZATION');

export const RequireAuthorization = (
  requirement: RouteAuthorizationRequirement,
): ReturnType<typeof SetMetadata> => SetMetadata(ROUTE_AUTHORIZATION, Object.freeze(requirement));
