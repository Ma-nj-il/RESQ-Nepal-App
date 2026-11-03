import { createServer, type Server, type ServerResponse } from 'node:http';

import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';

import { APP_CONFIG, type ApplicationConfig } from '../config/application-config.js';
import { HealthService, type HealthResponse } from './health.service.js';

@Injectable()
export class RuntimeProbeServer implements OnModuleDestroy {
  private server: Server | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: ApplicationConfig,
    @Inject(HealthService) private readonly health: HealthService,
  ) {}

  async listen(): Promise<void> {
    if (this.server !== undefined) return;
    this.server = createServer((request, response) => {
      void this.route(request.url ?? '/', response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.config.http.healthPort, this.config.http.host, resolve);
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private async route(path: string, response: ServerResponse): Promise<void> {
    let result: HealthResponse | undefined;
    if (path === '/health/live') result = this.health.live();
    if (path === '/health/startup') result = this.health.startup();
    if (path === '/health/ready') result = await this.health.ready();

    if (result === undefined) {
      this.write(response, 404, { status: 'not_found' });
      return;
    }
    this.write(response, result.status === 'ok' ? 200 : 503, result);
  }

  private write(response: ServerResponse, statusCode: number, body: object): void {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
  }
}
