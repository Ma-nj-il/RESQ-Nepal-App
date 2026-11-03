import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG, type ApplicationConfig } from '../config/application-config.js';

export type RedisPurpose = 'cache' | 'queue';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly clients: Readonly<Record<RedisPurpose, Redis>>;

  constructor(@Inject(APP_CONFIG) config: ApplicationConfig) {
    const options = {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: config.dependencies.timeoutMs,
      commandTimeout: config.dependencies.timeoutMs,
      retryStrategy: () => null,
    } as const;
    this.clients = Object.freeze({
      cache: new Redis(config.dependencies.redis.cacheUrl, options),
      queue: new Redis(config.dependencies.redis.queueUrl, options),
    });

    for (const client of Object.values(this.clients)) client.on('error', () => undefined);
  }

  client(purpose: RedisPurpose): Redis {
    return this.clients[purpose];
  }

  async check(purpose: RedisPurpose): Promise<void> {
    const client = this.clients[purpose];
    if (client.status === 'wait') await client.connect();
    if (client.status !== 'ready') throw new Error('Redis is not ready');
    await client.ping();
  }

  onModuleDestroy(): void {
    for (const client of Object.values(this.clients)) {
      if (client.status !== 'end') client.disconnect(false);
    }
  }
}
