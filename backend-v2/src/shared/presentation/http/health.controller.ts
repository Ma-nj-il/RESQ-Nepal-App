import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';

import { HealthService, type HealthResponse } from '../../infrastructure/health/health.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('live')
  live(): HealthResponse {
    return this.health.live();
  }

  @Get('startup')
  startup(@Res({ passthrough: true }) response: Response): HealthResponse {
    const result = this.health.startup();
    if (result.status !== 'ok') response.status(503);
    return result;
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const result = await this.health.ready();
    if (result.status !== 'ok') response.status(503);
    return result;
  }
}
