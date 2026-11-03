import { randomUUID } from 'node:crypto';

import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import type { EntityManager } from 'typeorm';

import { ApplicationError } from '../../application/errors/application-error.js';
import type { JsonValue } from '../../application/idempotency/idempotency.js';
import type { JobIntentEnvelope } from '../../application/messaging/job-intent.js';
import type { ApplicationConfig } from '../config/application-config.js';
import type { DatabaseService } from '../persistence/database.service.js';

export interface DurableJobResult {
  readonly code: string;
}
export interface DurableJobProcessor {
  process(job: JobIntentEnvelope): Promise<DurableJobResult>;
}
export interface DurableQueue {
  readonly name: string;
  readonly concurrency: number;
  readonly jobTypes: readonly string[];
}

interface IntentRow {
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
  readonly state:
    'PENDING' | 'ENQUEUEING' | 'ENQUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  readonly queue_job_id: string | null;
  readonly result_code: string | null;
  readonly due: boolean;
}

type Claim =
  | { readonly terminal: true; readonly result: DurableJobResult }
  | { readonly terminal: false; readonly intent: JobIntentEnvelope; readonly executionId: string };

const TERMINAL_RESULT_CODES = new Set(['INVALID_JOB_ENVELOPE', 'UNSUPPORTED_JOB_TYPE']);

class JobIntentNotReadyError extends Error {
  constructor() {
    super('Durable job intent has not completed enqueue reconciliation');
    this.name = 'JobIntentNotReadyError';
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof ApplicationError) return error.code.slice(0, 128);
  if (error instanceof JobIntentNotReadyError) return 'JOB.INTENT_NOT_READY';
  if (error instanceof UnrecoverableError) return 'JOB.INVALID_OR_UNSUPPORTED';
  return 'JOB.PROCESSING_FAILED';
}

function intentId(data: unknown): string | undefined {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('jobIntentId' in data) ||
    typeof data.jobIntentId !== 'string'
  )
    return undefined;
  return data.jobIntentId;
}

export class DurableJobWorkerRuntime implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly connection: ConnectionOptions;
  private readonly workers: Worker<JobIntentEnvelope, DurableJobResult>[] = [];

  constructor(
    config: ApplicationConfig,
    private readonly database: DatabaseService,
    private readonly processor: DurableJobProcessor,
    private readonly logger: PinoLogger,
    private readonly queues: readonly DurableQueue[],
  ) {
    this.logger.setContext(DurableJobWorkerRuntime.name);
    this.connection = Object.freeze({
      url: config.dependencies.redis.queueUrl,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      connectionName: `resq-${config.role}-durable-jobs`,
    });
  }

  onApplicationBootstrap(): void {
    for (const queue of this.queues) {
      const queueName = queue.name;
      const worker = new Worker<JobIntentEnvelope, DurableJobResult>(
        queueName,
        (job) => this.process(queue, job),
        {
          connection: this.connection,
          prefix: 'resq',
          concurrency: queue.concurrency,
          maxStalledCount: 2,
          removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100_000 },
          removeOnFail: { age: 30 * 24 * 60 * 60, count: 100_000 },
        },
      );
      worker.on('error', (error) => {
        this.logger.error(
          { errorCode: 'JOB.WORKER_ERROR', queueName, error },
          'Durable BullMQ worker error',
        );
      });
      worker.on('failed', (job, error) => {
        this.logger.warn(
          {
            errorCode: safeErrorCode(error),
            queueName,
            jobIntentId: intentId(job?.data),
            attemptsMade: job?.attemptsMade,
          },
          'Durable job attempt failed',
        );
      });
      this.workers.push(worker);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.workers.map((worker) => worker.close()));
  }

  async process(
    queue: DurableQueue,
    job: Job<JobIntentEnvelope, DurableJobResult>,
  ): Promise<DurableJobResult> {
    let claim: Claim | undefined;
    try {
      const jobIntentId = intentId(job.data);
      if (
        job.id === undefined ||
        jobIntentId === undefined ||
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(jobIntentId)
      ) {
        throw new UnrecoverableError('BullMQ job has no stable identity');
      }
      claim = await this.claim(jobIntentId, queue.name, job.id, job.name);
      if (claim.terminal) return claim.result;
      if (!queue.jobTypes.includes(claim.intent.jobType)) {
        throw new UnrecoverableError('Unsupported durable job type');
      }
      const result = await this.processor.process(claim.intent);
      if (TERMINAL_RESULT_CODES.has(result.code)) {
        throw new UnrecoverableError('Invalid durable job envelope');
      }
      await this.succeed(claim.intent.jobIntentId, claim.executionId, result.code);
      return result;
    } catch (error) {
      // Queue data is not authority to mutate an intent: only a successfully bound claim is.
      if (claim?.terminal !== false) throw error;
      const jobIntentId = claim.intent.jobIntentId;
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = error instanceof UnrecoverableError || job.attemptsMade + 1 >= attempts;
      if (finalAttempt) await this.fail(jobIntentId, claim.executionId, safeErrorCode(error));
      else await this.releaseForRetry(jobIntentId, claim.executionId);
      throw error;
    }
  }

  private async claim(
    jobIntentId: string,
    queueName: string,
    queueJobId: string,
    jobType: string,
  ): Promise<Claim> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const rows: IntentRow[] = await manager.query(
        `SELECT id, deterministic_job_id, job_type, queue_name, tenant_id, resource_type,
                resource_id, resource_version, run_at, correlation_id, causation_id,
                traceparent, job_data, state, queue_job_id, result_code,
                run_at <= statement_timestamp() AS due
           FROM governance.job_intents
          WHERE id = $1
          FOR UPDATE`,
        [jobIntentId],
      );
      const row = rows[0];
      if (row === undefined) throw new UnrecoverableError('Job intent does not exist');
      if (
        row.queue_name !== queueName ||
        row.job_type !== jobType ||
        row.deterministic_job_id !== queueJobId ||
        (row.queue_job_id !== null && row.queue_job_id !== queueJobId)
      ) {
        throw new UnrecoverableError('BullMQ job does not match its durable intent');
      }
      if (row.state === 'SUCCEEDED' || row.state === 'CANCELLED') {
        return {
          terminal: true,
          result: {
            code: row.result_code ?? (row.state === 'CANCELLED' ? 'CANCELLED' : 'SUCCEEDED'),
          },
        };
      }
      if (row.state === 'FAILED') throw new UnrecoverableError('Job intent is already failed');
      if (row.state === 'PENDING' || row.state === 'ENQUEUEING' || !row.due) {
        throw new JobIntentNotReadyError();
      }
      if (row.queue_job_id !== queueJobId) {
        throw new UnrecoverableError('BullMQ job does not match its durable intent');
      }
      const executionId = randomUUID();
      await manager.query(
        `UPDATE governance.job_intents
            SET state = 'RUNNING', execution_id = $2, updated_at = statement_timestamp()
           WHERE id = $1`,
        [jobIntentId, executionId],
      );
      return { terminal: false, intent: { ...this.intent(row), executionId }, executionId };
    });
  }

  private intent(row: IntentRow): JobIntentEnvelope {
    return {
      jobIntentId: row.id,
      jobType: row.job_type,
      ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      ...(row.resource_version === null ? {} : { resourceVersion: Number(row.resource_version) }),
      runAt: row.run_at.toISOString(),
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      ...(row.traceparent === null ? {} : { traceparent: row.traceparent }),
      data: row.job_data,
    };
  }

  private async succeed(
    jobIntentId: string,
    executionId: string,
    resultCode: string,
  ): Promise<void> {
    await this.updateTerminal(jobIntentId, async (manager) => {
      await manager.query(
        `UPDATE governance.job_intents
            SET state = 'SUCCEEDED', completed_at = statement_timestamp(),
                result_code = $2, error_code = NULL, updated_at = statement_timestamp()
           WHERE id = $1 AND state = 'RUNNING' AND execution_id = $3`,
        [jobIntentId, resultCode.slice(0, 128), executionId],
      );
    });
  }

  private async fail(jobIntentId: string, executionId: string, errorCode: string): Promise<void> {
    await this.updateTerminal(jobIntentId, async (manager) => {
      await manager.query(
        `UPDATE governance.job_intents
            SET state = 'FAILED', completed_at = statement_timestamp(), result_code = NULL,
                error_code = $2, updated_at = statement_timestamp()
           WHERE id = $1 AND state = 'RUNNING' AND execution_id = $3`,
        [jobIntentId, errorCode.slice(0, 128), executionId],
      );
    });
  }

  private async releaseForRetry(jobIntentId: string, executionId: string): Promise<void> {
    await this.updateTerminal(jobIntentId, async (manager) => {
      await manager.query(
        `UPDATE governance.job_intents
            SET state = 'ENQUEUED', updated_at = statement_timestamp()
           WHERE id = $1 AND state = 'RUNNING' AND execution_id = $2`,
        [jobIntentId, executionId],
      );
    });
  }

  private async updateTerminal(
    jobIntentId: string,
    work: (manager: EntityManager) => Promise<void>,
  ): Promise<void> {
    const source = await this.database.getDataSource();
    try {
      await source.transaction('READ COMMITTED', work);
    } catch (error) {
      this.logger.error(
        { errorCode: 'JOB_INTENT.STATE_UPDATE_FAILED', jobIntentId, error },
        'Job-intent state update failed',
      );
      throw error;
    }
  }
}
