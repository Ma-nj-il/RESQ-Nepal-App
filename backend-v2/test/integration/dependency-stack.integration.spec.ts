import { randomBytes } from 'node:crypto';

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Kafka, logLevel } from 'kafkajs';
import { Client } from 'pg';

const integrationEnabled = process.env['RUN_INTEGRATION'] === '1';
const describeIntegration = integrationEnabled ? describe : describe.skip;

function redisConnection(urlValue: string): { host: string; port: number; db: number } {
  const url = new URL(urlValue);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number(url.pathname.slice(1) || 0),
  };
}

describeIntegration('local dependency stack', () => {
  it('reaches PostgreSQL, isolated Redis instances, Kafka, BullMQ, and S3-compatible health', async () => {
    const databaseUrl = process.env['RESQ_MIGRATION_DATABASE_URL'];
    const cacheUrl = process.env['RESQ_REDIS_CACHE_URL'];
    const queueUrl = process.env['RESQ_REDIS_QUEUE_URL'];
    const brokers = process.env['RESQ_KAFKA_BROKERS']?.split(',');
    const objectEndpoint = process.env['RESQ_OBJECT_STORAGE_ENDPOINT'];
    if (
      databaseUrl === undefined ||
      cacheUrl === undefined ||
      queueUrl === undefined ||
      brokers === undefined ||
      objectEndpoint === undefined
    ) {
      throw new Error('Local integration dependency configuration is incomplete');
    }

    const database = new Client({ connectionString: databaseUrl });
    await database.connect();
    expect((await database.query<{ value: number }>('SELECT 1 AS value')).rows[0]?.value).toBe(1);
    await database.end();

    const cache = new Redis(cacheUrl, { maxRetriesPerRequest: 1 });
    const queueRedis = new Redis(queueUrl, { maxRetriesPerRequest: 1 });
    await expect(cache.ping()).resolves.toBe('PONG');
    await expect(queueRedis.ping()).resolves.toBe('PONG');
    cache.disconnect();
    queueRedis.disconnect();

    const kafka = new Kafka({
      clientId: 'resq-integration-test',
      brokers,
      retry: { retries: 0 },
      logLevel: logLevel.NOTHING,
    });
    const admin = kafka.admin();
    await admin.connect();
    const cluster = await admin.describeCluster();
    expect(cluster.clusterId.length).toBeGreaterThan(0);
    await admin.disconnect();

    const queueName = `foundation-${randomBytes(5).toString('hex')}`;
    const queue = new Queue(queueName, { connection: redisConnection(queueUrl) });
    const deterministicId = `intent-${randomBytes(8).toString('hex')}`;
    await queue.add('foundation.probe.v1', { reference: 'synthetic' }, { jobId: deterministicId });
    await expect(queue.getJob(deterministicId)).resolves.toMatchObject({ id: deterministicId });
    await queue.obliterate({ force: true });
    await queue.close();

    const storageHealth = await fetch(`${objectEndpoint}/minio/health/live`);
    expect(storageHealth.ok).toBe(true);
  });
});
