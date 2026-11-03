import type { Request } from 'express';

export function requestRouteTemplate(request: Request): string {
  const route: unknown = request.route;
  if (
    typeof route !== 'object' ||
    route === null ||
    !('path' in route) ||
    typeof route.path !== 'string'
  ) {
    return 'unmatched';
  }

  return `${request.baseUrl}${route.path}` || 'unmatched';
}
