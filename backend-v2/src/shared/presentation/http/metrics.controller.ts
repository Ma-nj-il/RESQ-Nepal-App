import { Controller, Get, Inject, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';

import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../infrastructure/config/application-config.js';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';

@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: ApplicationConfig,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  @Get()
  async get(@Res() response: Response): Promise<void> {
    if (!this.config.metrics.enabled) throw new NotFoundException();
    response.setHeader('Content-Type', this.metrics.registry.contentType);
    response.send(await this.metrics.registry.metrics());
  }
}
