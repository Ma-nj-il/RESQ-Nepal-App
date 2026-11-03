import { Inject, Injectable, Optional, type OnApplicationBootstrap } from '@nestjs/common';
import { REALTIME_READINESS, type RealtimeReadiness } from './realtime-readiness.js';

import { CLOCK, type Clock } from '../../domain/clock.js';
import { APP_CONFIG, type ApplicationConfig } from '../config/application-config.js';
import { KafkaService } from '../dependencies/kafka.service.js';
import { RedisService, type RedisPurpose } from '../dependencies/redis.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { DatabaseService } from '../persistence/database.service.js';

export interface ComponentHealth {
  readonly name: 'postgresql' | 'redis-cache' | 'redis-queue' | 'kafka' | 'realtime';
  readonly status: 'up' | 'down';
}

export interface HealthResponse {
  readonly status: 'ok' | 'starting' | 'unavailable';
  readonly role: string;
  readonly checkedAt: string;
  readonly checks?: readonly ComponentHealth[];
}

interface RequiredCheck {
  readonly name: ComponentHealth['name'];
  readonly run: () => Promise<void>;
}

@Injectable()
export class HealthService implements OnApplicationBootstrap {
  private started = false;
  private cachedReadiness:
    { readonly expiresAt: number; readonly result: HealthResponse } | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: ApplicationConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(KafkaService) private readonly kafka: KafkaService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Optional() @Inject(REALTIME_READINESS) private readonly realtime?: RealtimeReadiness,
  ) {}

  onApplicationBootstrap(): void {
    this.started = true;
  }

  live(): HealthResponse {
    return this.response('ok');
  }

  startup(): HealthResponse {
    return this.response(this.started ? 'ok' : 'starting');
  }

  async ready(): Promise<HealthResponse> {
    const now = this.clock.now().getTime();
    if (this.cachedReadiness !== undefined && this.cachedReadiness.expiresAt > now) {
      return this.cachedReadiness.result;
    }

    const checks = await Promise.all(
      this.requiredChecks().map(async ({ name, run }): Promise<ComponentHealth> => {
        try {
          await this.withTimeout(run());
          this.metrics.dependencyChecks.inc({ dependency: name, result: 'up' });
          return { name, status: 'up' };
        } catch {
          this.metrics.dependencyChecks.inc({ dependency: name, result: 'down' });
          return { name, status: 'down' };
        }
      }),
    );
    const result: HealthResponse = Object.freeze({
      ...this.response(checks.every((check) => check.status === 'up') ? 'ok' : 'unavailable'),
      checks: Object.freeze(checks),
    });
    this.cachedReadiness = { expiresAt: now + 500, result };
    return result;
  }

  private response(status: HealthResponse['status']): HealthResponse {
    return Object.freeze({
      status,
      role: this.config.role,
      checkedAt: this.clock.now().toISOString(),
    });
  }

  private requiredChecks(): readonly RequiredCheck[] {
    const database: RequiredCheck = { name: 'postgresql', run: () => this.database.check() };
    if (this.config.role === 'api') {
      return [
        database,
        this.redisCheck('cache'),
        ...(this.config.realtime.enabled
          ? [
              {
                name: 'realtime' as const,
                run: (): Promise<void> =>
                  this.realtime?.ready() === true
                    ? Promise.resolve()
                    : Promise.reject(new Error('Realtime unavailable')),
              },
            ]
          : []),
      ];
    }
    if (this.config.role === 'worker') {
      return [database, this.redisCheck('queue'), { name: 'kafka', run: () => this.kafka.check() }];
    }
    if (this.config.role === 'outbox-relay') {
      return [database, { name: 'kafka', run: () => this.kafka.check() }];
    }
    return [database];
  }

  private redisCheck(purpose: RedisPurpose): RequiredCheck {
    return {
      name: purpose === 'cache' ? 'redis-cache' : 'redis-queue',
      run: () => this.redis.check(purpose),
    };
  }

  private async withTimeout(operation: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Dependency check timed out')),
        this.config.dependencies.timeoutMs,
      );
      timer.unref();
    });
    try {
      await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
