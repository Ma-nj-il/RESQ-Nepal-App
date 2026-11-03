import { Inject, Injectable } from '@nestjs/common';

import type {
  Coordinate,
  RouteEstimate,
  RoutingProvider,
} from '../../application/ports/routing-provider.js';
import { straightLineDistanceMeters } from '../../domain/core-dispatch.js';
import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../../shared/infrastructure/config/application-config.js';

@Injectable()
export class DevelopmentRoutingProvider implements RoutingProvider {
  constructor(@Inject(APP_CONFIG) private readonly config: ApplicationConfig) {}

  estimate(origin: Coordinate, destination: Coordinate): Promise<RouteEstimate> {
    if (!this.config.dispatch.developmentRoutingEnabled) {
      throw new ApplicationError({
        code: 'MAPS.UNAVAILABLE',
        message: 'A route estimate is temporarily unavailable.',
        status: 503,
        retryable: true,
      });
    }
    const directDistance = straightLineDistanceMeters(origin, destination);
    const distanceMeters = Math.max(1, Math.ceil(directDistance * 1.25));
    const durationSeconds = Math.max(60, Math.ceil(distanceMeters / (35_000 / 3_600)));
    return Promise.resolve({
      distanceMeters,
      durationSeconds,
      source: 'DEVELOPMENT_STRAIGHT_LINE_V1',
      quality: 'DEVELOPMENT_ESTIMATE',
    });
  }
}
