import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { Consumer, ConsumerRunConfig } from 'kafkajs';
import type { Redis } from 'ioredis';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../shared/infrastructure/config/application-config.js';
import { KafkaService } from '../../shared/infrastructure/dependencies/kafka.service.js';
import { RedisService } from '../../shared/infrastructure/dependencies/redis.service.js';
import {
  projectRecoveryHint,
  recoveryHint,
  type RecoveryHint,
  type RecoveryHintSource,
} from '../application/recovery-hint.js';

@Injectable()
export class RedisRecoveryHints implements RecoveryHintSource, OnModuleDestroy {
  private readonly listeners = new Set<{
    hint: (value: RecoveryHint) => void;
    unavailable: () => void;
  }>();
  private readonly channel: string;
  private subscriber?: Redis;
  private consumer?: Consumer;
  private healthy = false;
  private stopping = false;
  private started = false;
  private failed = false;
  private readonly shutdown = new AbortController();

  constructor(
    @Inject(APP_CONFIG) private readonly config: ApplicationConfig,
    @Inject(KafkaService) private readonly kafka: KafkaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {
    this.channel = `resq:${config.environment}:${config.dependencies.kafka.clientId}:requester-recovery:v1`;
  }

  ready(): boolean {
    return this.healthy && !this.failed && !this.stopping && this.subscriber?.status === 'ready';
  }
  subscribe(hint: (value: RecoveryHint) => void, unavailable: () => void): () => void {
    const listener = { hint, unavailable };
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.started || this.stopping) throw new Error('Realtime source cannot be restarted');
    this.started = true;
    try {
      await this.open();
      if (!this.ready()) throw new Error('Realtime source failed during startup');
    } catch (error) {
      await this.onModuleDestroy().catch(() => {});
      throw error;
    }
  }

  private async open(): Promise<void> {
    await this.redis.check('cache');
    this.shutdown.signal.throwIfAborted();
    const subscriber = this.redis.client('cache').duplicate();
    this.subscriber = subscriber;
    subscriber.on('error', () => this.fail());
    subscriber.on('close', () => this.fail());
    subscriber.on('message', (channel, message) => {
      if (channel !== this.channel || !this.ready() || Buffer.byteLength(message) > 1024) return;
      try {
        const parsed = recoveryHint.safeParse(JSON.parse(message) as unknown);
        if (parsed.success) for (const listener of this.listeners) listener.hint(parsed.data);
      } catch {
        this.fail();
      }
    });
    await subscriber.connect();
    this.shutdown.signal.throwIfAborted();
    await subscriber.subscribe(this.channel);
    this.shutdown.signal.throwIfAborted();
    const run: ConsumerRunConfig = {
      eachMessage: async ({ topic, message }) => {
        if (!this.ready()) throw new Error('Realtime fanout unavailable');
        if (!message.value || message.value.byteLength > 262144) return;
        let value: unknown;
        try {
          value = JSON.parse(message.value.toString('utf8')) as unknown;
        } catch {
          return;
        }
        const hint = projectRecoveryHint(topic, message.key?.toString('utf8') ?? '', value);
        if (hint) {
          try {
            await this.redis.client('cache').publish(this.channel, JSON.stringify(hint));
          } catch (error) {
            this.fail();
            throw error;
          }
        }
      },
    };
    for (let attempt = 0; ; attempt++) {
      if (this.unavailable()) throw new Error('Realtime startup cancelled');
      const consumer = this.kafka.createConsumer(
        `${this.config.environment}-${this.config.dependencies.kafka.clientId}-requester-recovery-v1`,
      );
      this.consumer = consumer;
      try {
        await this.join(consumer, run);
        return;
      } catch (error) {
        await consumer.disconnect();
        // KafkaJS bails from JoinGroup even for this transient cold-coordinator response.
        // Retry only before the first join; runtime failures permanently fail readiness.
        if (
          attempt >= 3 ||
          this.unavailable() ||
          !error ||
          typeof error !== 'object' ||
          !('type' in error) ||
          error.type !== 'GROUP_LOAD_IN_PROGRESS'
        )
          throw error;
        await delay(300 * 2 ** attempt, undefined, { signal: this.shutdown.signal });
      }
    }
  }

  private async join(consumer: Consumer, run: ConsumerRunConfig): Promise<void> {
    let joined = false;
    let abandoned = false;
    let timer: NodeJS.Timeout | undefined;
    let remove: (() => void)[] = [];
    const joining = new Promise<void>((resolve, reject) => {
      const cancelled = (): void => reject(new Error('Realtime startup cancelled'));
      this.shutdown.signal.addEventListener('abort', cancelled, { once: true });
      timer = setTimeout(() => reject(new Error('Realtime consumer join timed out')), 30000);
      remove = [
        () => this.shutdown.signal.removeEventListener('abort', cancelled),
        consumer.on(consumer.events.GROUP_JOIN, () => {
          if (this.stopping || this.failed) {
            reject(new Error('Realtime startup cancelled'));
            return;
          }
          joined = true;
          this.healthy = true;
          resolve();
        }),
        consumer.on(consumer.events.CRASH, ({ payload }) => {
          if (joined) this.fail();
          reject(payload.error);
        }),
        consumer.on(consumer.events.DISCONNECT, () => {
          if (joined) this.fail();
        }),
      ];
    });
    const assertActive = (): void => {
      if (abandoned || this.unavailable()) throw new Error('Realtime startup cancelled');
    };
    const start = async (): Promise<void> => {
      await consumer.connect();
      assertActive();
      await consumer.subscribe({
        topics: ['resq.booking.events.v1', 'resq.dispatch.events.v1', 'resq.trip.events.v1'],
        fromBeginning: false,
      });
      assertActive();
      await consumer.run(run);
    };
    try {
      // run() can resolve after an internally handled crash. A real GROUP_JOIN is required.
      await Promise.all([joining, start()]);
    } catch (error) {
      abandoned = true;
      for (const stop of remove) stop();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.shutdown.abort();
    this.fail();
    try {
      await this.consumer?.disconnect();
    } finally {
      this.subscriber?.disconnect(false);
      this.listeners.clear();
    }
  }

  private fail(): void {
    this.failed = true;
    this.healthy = false;
    for (const listener of this.listeners) {
      try {
        listener.unavailable();
      } catch {
        /* One client must not prevent other disconnects. */
      }
    }
  }

  private unavailable(): boolean {
    return this.stopping || this.failed;
  }
}
