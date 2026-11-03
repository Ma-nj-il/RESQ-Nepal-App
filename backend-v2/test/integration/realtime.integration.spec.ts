import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Kafka, logLevel } from 'kafkajs';
import { RedisRecoveryHints } from '../../src/realtime/infrastructure/redis-recovery-hints.js';
import type { RecoveryHint } from '../../src/realtime/application/recovery-hint.js';
import { loadApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';
import { KafkaService } from '../../src/shared/infrastructure/dependencies/kafka.service.js';
import { RedisService } from '../../src/shared/infrastructure/dependencies/redis.service.js';

const describeIntegration = process.env['RUN_INTEGRATION'] === '1' ? describe : describe.skip;
describeIntegration('realtime Kafka to Redis fanout', () => {
  it('delivers one broker hint to both replica subscribers and stops delivery on replica shutdown', async () => {
    const config = loadApplicationConfig(
      { ...process.env, RESQ_KAFKA_CLIENT_ID: `realtime-test-${randomUUID()}` },
      'api',
    );
    const admin = new Kafka({
      brokers: [...config.dependencies.kafka.brokers],
      logLevel: logLevel.NOTHING,
    }).admin();
    const kafka = [new KafkaService(config), new KafkaService(config)];
    const redis = [new RedisService(config), new RedisService(config)];
    const sources = kafka.map((value, index) => {
      const cache = redis[index];
      if (!cache) throw new Error('Missing replica');
      return new RedisRecoveryHints(config, value, cache);
    });
    const timers: NodeJS.Timeout[] = [];
    try {
      await admin.connect();
      await admin.createTopics({
        waitForLeaders: true,
        topics: ['booking', 'dispatch', 'trip'].map((domain) => ({
          topic: `resq.${domain}.events.v1`,
          numPartitions: 2,
          replicationFactor: 1,
        })),
      });
      await Promise.all(sources.map((source) => source.start()));
      const groupId = `${config.environment}-${config.dependencies.kafka.clientId}-requester-recovery-v1`;
      const { groups } = await admin.describeGroups([groupId]);
      expect(groups[0]?.members).toHaveLength(2);
      expect(sources.map((source) => source.ready())).toEqual([true, true]);
      const eventId = randomUUID(),
        bookingId = randomUUID();
      const received = sources.map(
        (source) =>
          new Promise<RecoveryHint>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Fanout timed out')), 15000);
            timers.push(timer);
            source.subscribe(
              (hint) => {
                if (hint.eventId === eventId) {
                  clearTimeout(timer);
                  resolve(hint);
                }
              },
              () => {},
            );
          }),
      );
      const example = JSON.parse(
        readFileSync('contracts/events/booking/booking.requested/v1/example.json', 'utf8'),
      ) as Record<string, unknown>;
      const producer = kafka[0];
      if (!producer) throw new Error('Missing producer');
      await producer.publish({
        topic: 'resq.booking.events.v1',
        key: bookingId,
        headers: {},
        value: JSON.stringify({
          ...example,
          eventId,
          aggregate: { type: 'booking', id: bookingId, version: 1 },
          stream: { type: 'bookingDispatch', id: bookingId, sequence: 1 },
        }),
      });
      expect(await Promise.all(received)).toEqual([
        { eventId, bookingId },
        { eventId, bookingId },
      ]);
      const source = sources[0];
      if (!source) throw new Error('Missing source');
      let unavailable = false;
      source.subscribe(
        () => {},
        () => {
          unavailable = true;
        },
      );
      await source.onModuleDestroy();
      expect(source.ready()).toBe(false);
      expect(unavailable).toBe(true);
      await expect(source.start()).rejects.toThrow('cannot be restarted');
      const survivor = sources[1];
      if (!survivor) throw new Error('Missing surviving replica');
      const nextEventId = randomUUID();
      let stoppedDeliveries = 0;
      source.subscribe(
        () => {
          stoppedDeliveries++;
        },
        () => {},
      );
      const delivered = new Promise<RecoveryHint>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Surviving fanout timed out')), 15000);
        timers.push(timer);
        survivor.subscribe(
          (hint) => {
            if (hint.eventId === nextEventId) {
              clearTimeout(timer);
              resolve(hint);
            }
          },
          () => {},
        );
      });
      await producer.publish({
        topic: 'resq.booking.events.v1',
        key: bookingId,
        headers: {},
        value: JSON.stringify({
          ...example,
          eventId: nextEventId,
          aggregate: { type: 'booking', id: bookingId, version: 2 },
          stream: { type: 'bookingDispatch', id: bookingId, sequence: 2 },
        }),
      });
      expect(await delivered).toEqual({ eventId: nextEventId, bookingId });
      expect(stoppedDeliveries).toBe(0);
      expect(survivor.ready()).toBe(true);
    } finally {
      for (const timer of timers) clearTimeout(timer);
      await Promise.allSettled(sources.map((source) => source.onModuleDestroy()));
      await Promise.allSettled(kafka.map((value) => value.onModuleDestroy()));
      for (const value of redis) value.onModuleDestroy();
      await admin.disconnect();
    }
  }, 60000);
});
