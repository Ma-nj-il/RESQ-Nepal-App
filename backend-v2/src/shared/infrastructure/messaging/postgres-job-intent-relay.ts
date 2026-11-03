import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue, type ConnectionOptions, type Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import type { EntityManager } from 'typeorm';

import type { JsonValue } from '../../application/idempotency/idempotency.js';
import type { JobIntentEnvelope } from '../../application/messaging/job-intent.js';
import { APP_CONFIG, type ApplicationConfig } from '../config/application-config.js';
import { DatabaseService } from '../persistence/database.service.js';

interface JobIntentRow {
  readonly id: string;
  readonly deterministic_job_id: string;
  readonly job_type: string;
  readonly queue_name: string;
  readonly tenant_id: string | null;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly resource_version: string | null;
  readonly run_at: Date;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly traceparent: string | null;
  readonly job_data: Readonly<Record<string, JsonValue>>;
  readonly enqueue_attempts: number;
  readonly state: 'PENDING' | 'ENQUEUEING' | 'ENQUEUED' | 'RUNNING';
}

const BATCH_SIZE = 25;
const POLL_INTERVAL_MS = 500;
const ENQUEUE_RECOVERY_LEASE_MS = 30_000;
const ENQUEUED_WATCHDOG_MS = 60_000;

@Injectable()
export class PostgresJobIntentRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly queues = new Map<string, Queue<JobIntentEnvelope>>();
  private readonly connection: ConnectionOptions;
  private stopping = false;
  private loop: Promise<void> | undefined;
  private wakeTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(APP_CONFIG) config: ApplicationConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PostgresJobIntentRelay.name);
    this.connection = Object.freeze({
      url: config.dependencies.redis.queueUrl,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      connectionName: `resq-${config.role}-job-relay`,
    });
  }

  onApplicationBootstrap(): void {
    this.loop = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.loop;
    await Promise.allSettled([...this.queues.values()].map((queue) => queue.close()));
  }

  async relayBatch(): Promise<number> {
    const source = await this.database.getDataSource();
    const intents = await source.transaction('READ COMMITTED', async (manager) => {
      const intents: JobIntentRow[] = await manager.query(
        `SELECT id, deterministic_job_id, job_type, queue_name, tenant_id,
                 resource_type, resource_id, resource_version, run_at, correlation_id,
                 causation_id, traceparent, job_data, enqueue_attempts, state
           FROM governance.job_intents
          WHERE state = 'PENDING'
             OR (state = 'ENQUEUEING' AND
                 updated_at <= statement_timestamp() - ($2::integer * interval '1 millisecond'))
              OR (state IN ('ENQUEUED','RUNNING') AND run_at <= statement_timestamp() AND
                  updated_at <= statement_timestamp() - ($3::integer * interval '1 millisecond'))
          ORDER BY CASE state
                     WHEN 'PENDING' THEN 0
                     WHEN 'ENQUEUEING' THEN 1
                     WHEN 'ENQUEUED' THEN 2
                     ELSE 3
                   END,
                   created_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [BATCH_SIZE, ENQUEUE_RECOVERY_LEASE_MS, ENQUEUED_WATCHDOG_MS],
      );
      if (intents.length === 0) return intents;
      await manager.query(
        `UPDATE governance.job_intents
            SET state = CASE WHEN state = 'PENDING' THEN 'ENQUEUEING' ELSE state END,
                enqueue_attempts = enqueue_attempts + 1,
                enqueued_at = COALESCE(enqueued_at, statement_timestamp()),
                queue_job_id = deterministic_job_id,
                updated_at = statement_timestamp()
          WHERE id = ANY($1::uuid[])
            AND state IN ('PENDING','ENQUEUEING','ENQUEUED','RUNNING')`,
        [intents.map((intent) => intent.id)],
      );
      return intents.map((intent) => ({
        ...intent,
        state: intent.state === 'PENDING' ? ('ENQUEUEING' as const) : intent.state,
      }));
    });
    for (const intent of intents) await this.enqueue(intent);
    return intents.length;
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        const count = await this.relayBatch();
        if (count === 0) await this.wait(POLL_INTERVAL_MS);
      } catch (error) {
        this.logger.error(
          { errorCode: 'JOB_INTENT.RELAY_BATCH_FAILED', error },
          'Job-intent relay batch failed',
        );
        await this.wait(1_000);
      }
    }
  }

  private async enqueue(intent: JobIntentRow): Promise<void> {
    try {
      const queue = this.queue(intent.queue_name);
      const envelope = this.envelope(intent);
      let queued = await queue.getJob(intent.deterministic_job_id);
      if (queued === undefined) queued = await this.add(queue, intent, envelope);
      this.assertMatchingJob(queued, intent);
      const queueJobId = queued.id;
      if (queueJobId === undefined) throw new Error('BullMQ did not return a job ID');
      const state = await queued.getState();
      if (state === 'failed' || state === 'completed') {
        await queued.retry(state, { resetAttemptsMade: true, resetAttemptsStarted: true });
      } else if (state === 'unknown') {
        await queued.remove();
        queued = await this.add(queue, intent, envelope);
        this.assertMatchingJob(queued, intent);
      }
      const source = await this.database.getDataSource();
      await source.transaction('READ COMMITTED', async (manager) => {
        await manager.query(
          `UPDATE governance.job_intents
              SET state = CASE WHEN state = 'RUNNING' THEN 'RUNNING' ELSE 'ENQUEUED' END,
                  queue_job_id = $2, updated_at = statement_timestamp()
            WHERE id = $1 AND state IN ('ENQUEUEING','ENQUEUED','RUNNING')`,
          [intent.id, queueJobId],
        );
      });
    } catch (error) {
      await this.recordFailure(intent.id);
      this.logger.warn(
        {
          errorCode: 'JOB_INTENT.ENQUEUE_FAILED',
          jobIntentId: intent.id,
          jobType: intent.job_type,
          queueName: intent.queue_name,
          error,
        },
        'Job intent remains eligible for enqueue reconciliation',
      );
    }
  }

  private add(
    queue: Queue<JobIntentEnvelope>,
    intent: JobIntentRow,
    envelope: JobIntentEnvelope,
  ): Promise<Job<JobIntentEnvelope>> {
    return queue.add(intent.job_type, envelope, {
      jobId: intent.deterministic_job_id,
      delay: Math.max(0, intent.run_at.getTime() - Date.now()),
      attempts: 6,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100_000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 100_000 },
    });
  }

  private assertMatchingJob(job: Job<JobIntentEnvelope>, intent: JobIntentRow): void {
    if (
      job.id !== intent.deterministic_job_id ||
      job.name !== intent.job_type ||
      job.data.jobIntentId !== intent.id
    ) {
      throw new Error('BullMQ job does not match its durable intent');
    }
  }

  private async recordFailure(jobIntentId: string): Promise<void> {
    try {
      const source = await this.database.getDataSource();
      await source.transaction('READ COMMITTED', async (manager: EntityManager) => {
        await manager.query(
          `UPDATE governance.job_intents
              SET updated_at = statement_timestamp()
            WHERE id = $1 AND state IN ('ENQUEUEING','ENQUEUED','RUNNING')`,
          [jobIntentId],
        );
      });
    } catch (error) {
      this.logger.error(
        { errorCode: 'JOB_INTENT.RECONCILIATION_STATE_UPDATE_FAILED', jobIntentId, error },
        'Could not record job-intent reconciliation failure',
      );
    }
  }

  private envelope(intent: JobIntentRow): JobIntentEnvelope {
    return {
      jobIntentId: intent.id,
      jobType: intent.job_type,
      ...(intent.tenant_id === null ? {} : { tenantId: intent.tenant_id }),
      resourceType: intent.resource_type,
      resourceId: intent.resource_id,
      ...(intent.resource_version === null
        ? {}
        : { resourceVersion: Number(intent.resource_version) }),
      runAt: intent.run_at.toISOString(),
      correlationId: intent.correlation_id,
      causationId: intent.causation_id,
      ...(intent.traceparent === null ? {} : { traceparent: intent.traceparent }),
      data: intent.job_data,
    };
  }

  private queue(name: string): Queue<JobIntentEnvelope> {
    const existing = this.queues.get(name);
    if (existing !== undefined) return existing;
    const queue = new Queue<JobIntentEnvelope>(name, {
      connection: this.connection,
      prefix: 'resq',
    });
    queue.on('error', (error) => {
      this.logger.error(
        { errorCode: 'JOB_INTENT.QUEUE_CONNECTION_ERROR', queueName: name, error },
        'BullMQ queue connection error',
      );
    });
    this.queues.set(name, queue);
    return queue;
  }

  private wait(milliseconds: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      this.wakeTimer = setTimeout(() => {
        this.wakeTimer = undefined;
        resolve();
      }, milliseconds);
      this.wakeTimer.unref();
    });
  }
}
