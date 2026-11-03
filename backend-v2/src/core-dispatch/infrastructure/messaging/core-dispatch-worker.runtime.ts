import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import type { EntityManager } from 'typeorm';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import type { JsonValue } from '../../../shared/application/idempotency/idempotency.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../../shared/infrastructure/config/application-config.js';
import { DatabaseService } from '../../../shared/infrastructure/persistence/database.service.js';
import {
  CORE_DISPATCH_JOB_PROCESSOR,
  type CoreDispatchJobProcessorToken,
} from '../../core-dispatch.tokens.js';
import {
  CORE_DISPATCH_JOB_TYPES,
  type CoreDispatchJob,
  type CoreDispatchJobResult,
} from '../../application/core-dispatch-job.processor.js';

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
}

type Claim =
  | { readonly terminal: true; readonly result: CoreDispatchJobResult }
  | { readonly terminal: false; readonly intent: CoreDispatchJob };

const QUEUES = Object.freeze(['dispatch-critical', 'safety-critical'] as const);
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

@Injectable()
export class CoreDispatchWorkerRuntime implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly connection: ConnectionOptions;
  private readonly workers: Worker<CoreDispatchJob, CoreDispatchJobResult>[] = [];

  constructor(
    @Inject(APP_CONFIG) config: ApplicationConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CORE_DISPATCH_JOB_PROCESSOR)
    private readonly processor: CoreDispatchJobProcessorToken,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CoreDispatchWorkerRuntime.name);
    this.connection = Object.freeze({
      url: config.dependencies.redis.queueUrl,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      connectionName: `resq-${config.role}-core-dispatch`,
    });
  }

  onApplicationBootstrap(): void {
    for (const queueName of QUEUES) {
      const worker = new Worker<CoreDispatchJob, CoreDispatchJobResult>(
        queueName,
        (job) => this.process(queueName, job),
        {
          connection: this.connection,
          prefix: 'resq',
          concurrency: queueName === 'safety-critical' ? 8 : 16,
          maxStalledCount: 2,
          removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100_000 },
          removeOnFail: { age: 30 * 24 * 60 * 60, count: 100_000 },
        },
      );
      worker.on('error', (error) => {
        this.logger.error(
          { errorCode: 'CORE_DISPATCH.WORKER_ERROR', queueName, error },
          'Core dispatch BullMQ worker error',
        );
      });
      worker.on('failed', (job, error) => {
        this.logger.warn(
          {
            errorCode: safeErrorCode(error),
            queueName,
            jobIntentId: job?.data.jobIntentId,
            attemptsMade: job?.attemptsMade,
          },
          'Core dispatch job attempt failed',
        );
      });
      this.workers.push(worker);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.workers.map((worker) => worker.close()));
  }

  private async process(
    queueName: (typeof QUEUES)[number],
    job: Job<CoreDispatchJob, CoreDispatchJobResult>,
  ): Promise<CoreDispatchJobResult> {
    let claim: Claim | undefined;
    try {
      if (job.id === undefined) throw new UnrecoverableError('BullMQ job has no stable ID');
      claim = await this.claim(job.data.jobIntentId, queueName, job.id);
      if (claim.terminal) return claim.result;
      if (!CORE_DISPATCH_JOB_TYPES.includes(claim.intent.jobType as never)) {
        throw new UnrecoverableError('Unsupported core dispatch job type');
      }
      const result = await this.processor.process(claim.intent);
      if (TERMINAL_RESULT_CODES.has(result.code)) {
        throw new UnrecoverableError('Invalid core dispatch job envelope');
      }
      await this.succeed(claim.intent.jobIntentId, result.code);
      return result;
    } catch (error) {
      if (error instanceof JobIntentNotReadyError) throw error;
      const jobIntentId =
        claim?.terminal === false ? claim.intent.jobIntentId : job.data.jobIntentId;
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = error instanceof UnrecoverableError || job.attemptsMade + 1 >= attempts;
      if (finalAttempt) await this.fail(jobIntentId, safeErrorCode(error));
      else await this.releaseForRetry(jobIntentId);
      throw error;
    }
  }

  private async claim(jobIntentId: string, queueName: string, queueJobId: string): Promise<Claim> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const rows: IntentRow[] = await manager.query(
        `SELECT id, deterministic_job_id, job_type, queue_name, tenant_id, resource_type,
                resource_id, resource_version, run_at, correlation_id, causation_id,
                traceparent, job_data, state, queue_job_id, result_code
           FROM governance.job_intents
          WHERE id = $1
          FOR UPDATE`,
        [jobIntentId],
      );
      const row = rows[0];
      if (row === undefined) throw new UnrecoverableError('Job intent does not exist');
      if (row.state === 'SUCCEEDED' || row.state === 'CANCELLED') {
        return {
          terminal: true,
          result: {
            code: row.result_code ?? (row.state === 'CANCELLED' ? 'CANCELLED' : 'SUCCEEDED'),
          },
        };
      }
      if (row.state === 'FAILED') throw new UnrecoverableError('Job intent is already failed');
      if (
        row.queue_name !== queueName ||
        row.deterministic_job_id !== queueJobId ||
        (row.queue_job_id !== null && row.queue_job_id !== queueJobId)
      ) {
        throw new UnrecoverableError('BullMQ job does not match its durable intent');
      }
      if (row.state === 'PENDING' || row.state === 'ENQUEUEING') {
        throw new JobIntentNotReadyError();
      }
      if (row.queue_job_id !== queueJobId) {
        throw new UnrecoverableError('BullMQ job does not match its durable intent');
      }
      await manager.query(
        `UPDATE governance.job_intents
            SET state = 'RUNNING', updated_at = statement_timestamp()
          WHERE id = $1`,
        [jobIntentId],
      );
      return { terminal: false, intent: this.intent(row) };
    });
  }

  private intent(row: IntentRow): CoreDispatchJob {
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

  private async succeed(jobIntentId: string, resultCode: string): Promise<void> {
    await this.updateTerminal(jobIntentId, async (manager) => {
      await manager.query(
        `UPDATE governance.job_intents
            SET state = 'SUCCEEDED', completed_at = statement_timestamp(),
                result_code = $2, error_code = NULL, updated_at = statement_timestamp()
          WHERE id = $1 AND state = 'RUNNING'`,
        [jobIntentId, resultCode.slice(0, 128)],
      );
    });
  }

  private async fail(jobIntentId: string, errorCode: string): Promise<void> {
    await this.updateTerminal(jobIntentId, async (manager) => {
      await manager.query(
        `UPDATE governance.job_intents
            SET state = 'FAILED', completed_at = statement_timestamp(), result_code = NULL,
                error_code = $2, updated_at = statement_timestamp()
          WHERE id = $1 AND state IN ('ENQUEUED','RUNNING')`,
        [jobIntentId, errorCode.slice(0, 128)],
      );
    });
  }

  private async releaseForRetry(jobIntentId: string): Promise<void> {
    await this.updateTerminal(jobIntentId, async (manager) => {
      await manager.query(
        `UPDATE governance.job_intents
            SET state = 'ENQUEUED', updated_at = statement_timestamp()
          WHERE id = $1 AND state = 'RUNNING'`,
        [jobIntentId],
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
