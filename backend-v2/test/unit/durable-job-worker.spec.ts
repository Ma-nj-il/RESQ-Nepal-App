import { randomUUID } from 'node:crypto';

import { jest } from '@jest/globals';
import { UnrecoverableError, type Job } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';

import type { JobIntentEnvelope } from '../../src/shared/application/messaging/job-intent.js';
import { loadApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';
import {
  DurableJobWorkerRuntime,
  type DurableJobProcessor,
  type DurableJobResult,
} from '../../src/shared/infrastructure/messaging/durable-job-worker.runtime.js';
import type { DatabaseService } from '../../src/shared/infrastructure/persistence/database.service.js';

const queue = { name: 'documents', concurrency: 1, jobTypes: ['document.scan-object.v1'] };

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Preserve inferred Jest mock types.
function fixture() {
  const id = randomUUID(),
    resourceId = randomUUID();
  const row = {
    id,
    deterministic_job_id: `document-${id}`,
    job_type: 'document.scan-object.v1',
    queue_name: 'documents',
    tenant_id: null,
    resource_type: 'documentObject',
    resource_id: resourceId,
    resource_version: '2',
    run_at: new Date('2026-01-01'),
    correlation_id: 'database-correlation',
    causation_id: 'database-cause',
    traceparent: null,
    job_data: {},
    state: 'ENQUEUED',
    queue_job_id: `document-${id}`,
    result_code: null,
    due: true,
  };
  const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<unknown[]>>((sql) =>
    Promise.resolve(sql.trim().startsWith('SELECT') ? [row] : []),
  );
  const database = {
    getDataSource: () =>
      Promise.resolve({
        transaction: async (_isolation: string, work: (manager: unknown) => Promise<unknown>) =>
          work({ query }),
      }),
  } as unknown as DatabaseService;
  const processor = {
    process: jest.fn<DurableJobProcessor['process']>(() =>
      Promise.resolve({ code: 'DOCUMENT_READY' }),
    ),
  };
  const logger = { setContext: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
  const worker = new DurableJobWorkerRuntime(
    loadApplicationConfig({}, 'worker'),
    database,
    processor,
    logger,
    [queue],
  );
  const job = {
    id: row.queue_job_id,
    name: row.job_type,
    opts: { attempts: 6 },
    attemptsMade: 0,
    data: {
      jobIntentId: id,
      executionId: randomUUID(),
      resourceId: randomUUID(),
      correlationId: 'untrusted',
    },
  } as Job<JobIntentEnvelope, DurableJobResult>;
  return { row, job, worker, processor, query, resourceId };
}

describe('identity-bound durable job execution', () => {
  it.each(['queue', 'id', 'name', 'terminal'] as const)(
    'cannot mutate another intent through a mismatched %s',
    async (mismatch) => {
      const f = fixture();
      if (mismatch === 'queue') f.row.queue_name = 'safety-critical';
      if (mismatch === 'id') f.job.id = 'forged-id';
      if (mismatch === 'name') f.job.name = 'document.expire.v1';
      if (mismatch === 'terminal') {
        f.row.state = 'SUCCEEDED';
        f.job.id = 'forged-id';
      }
      await expect(f.worker.process(queue, f.job)).rejects.toBeInstanceOf(UnrecoverableError);
      expect(f.processor.process).not.toHaveBeenCalled();
      expect(f.query.mock.calls.filter(([sql]) => sql.trim().startsWith('UPDATE'))).toHaveLength(0);
    },
  );

  it('does not fail a future intent or an intent awaiting enqueue reconciliation', async () => {
    for (const state of ['ENQUEUED', 'ENQUEUEING', 'PENDING']) {
      const f = fixture();
      f.row.state = state;
      f.row.due = false;
      f.job.attemptsMade = 5;
      await expect(f.worker.process(queue, f.job)).rejects.toThrow('enqueue reconciliation');
      expect(f.query.mock.calls.filter(([sql]) => sql.trim().startsWith('UPDATE'))).toHaveLength(0);
    }
  });

  it('reconstructs scope from PostgreSQL and fences completion with the fresh execution ID', async () => {
    const f = fixture();
    await expect(f.worker.process(queue, f.job)).resolves.toEqual({ code: 'DOCUMENT_READY' });
    const input = f.processor.process.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      resourceId: f.resourceId,
      correlationId: 'database-correlation',
    });
    expect(input?.executionId).not.toEqual(f.job.data.executionId);
    const completion = f.query.mock.calls.find(([sql]) => sql.includes("state = 'SUCCEEDED'"));
    expect(completion?.[0]).toContain('execution_id = $3');
    expect(completion?.[1]?.[2]).toEqual(input?.executionId);
  });

  it.each([0, 5])(
    'fences retry or failure updates after a claimed processing failure (%i)',
    async (attemptsMade) => {
      const f = fixture();
      f.job.attemptsMade = attemptsMade;
      f.processor.process.mockRejectedValue(new Error('provider unavailable'));
      await expect(f.worker.process(queue, f.job)).rejects.toThrow('provider unavailable');
      const executionId = f.processor.process.mock.calls[0]?.[0].executionId;
      const updates = f.query.mock.calls.filter(([sql]) => sql.trim().startsWith('UPDATE'));
      expect(updates).toHaveLength(2);
      expect(updates[1]?.[0]).toContain('execution_id =');
      expect(updates[1]?.[1]).toContain(executionId);
    },
  );
});
