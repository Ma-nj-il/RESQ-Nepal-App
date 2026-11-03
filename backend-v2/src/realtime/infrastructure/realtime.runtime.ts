import { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { RequesterRealtimeAccessService } from '../../core-dispatch/application/requester-realtime-access.service.js';
import {
  AUTHORIZATION_SERVICE,
  type AuthorizationServiceToken,
} from '../../identity-access/identity-access.tokens.js';
import { RequestContext } from '../../shared/application/context/request-context.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../shared/infrastructure/config/application-config.js';
import { RedisRecoveryHints } from './redis-recovery-hints.js';
import { RequesterRealtimeServer } from './requester-realtime.server.js';

@Injectable()
export class RealtimeRuntime implements OnApplicationBootstrap, OnModuleDestroy {
  private server?: RequesterRealtimeServer;
  constructor(
    @Inject(APP_CONFIG) private readonly config: ApplicationConfig,
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(AUTHORIZATION_SERVICE) private readonly authorization: AuthorizationServiceToken,
    @Inject(RequesterRealtimeAccessService) private readonly access: RequesterRealtimeAccessService,
    @Inject(RedisRecoveryHints) private readonly hints: RedisRecoveryHints,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.realtime.enabled) return;
    const http: unknown = this.host.httpAdapter.getHttpServer();
    if (!(http instanceof Server)) throw new Error('Realtime requires the HTTP adapter');
    await this.hints.start();
    this.server = new RequesterRealtimeServer(
      http as Server,
      this.hints,
      {
        authorize: (token) => {
          const id = randomUUID();
          return this.authorization.authorize(
            new RequestContext({ requestId: id, correlationId: id, source: 'HTTP' }),
            token,
            {},
            { context: 'SELF' },
          );
        },
        bookingVersion: (context, id) => this.access.bookingVersion(context, id),
      },
      { origins: this.config.http.corsOrigins },
    );
  }
  async onModuleDestroy(): Promise<void> {
    await this.server?.close();
  }
}
