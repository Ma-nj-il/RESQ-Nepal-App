import { jest } from '@jest/globals';

import { RequestContext } from '../../src/shared/application/context/request-context.js';
import {
  IdempotencyExecutor,
  type IdempotencyBeginResult,
  type IdempotencyRepository,
} from '../../src/shared/application/idempotency/idempotency.js';
import type { UnitOfWork } from '../../src/shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../src/shared/domain/clock.js';
import type { IdGenerator } from '../../src/shared/domain/id-generator.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const TRANSACTION = { transactionId: 'test-transaction' };

function context(): RequestContext {
  return new RequestContext({
    requestId: 'request-id',
    correlationId: 'correlation-id',
    source: 'HTTP',
    actor: { type: 'USER', id: '018f0000-0000-7000-8000-000000000001' },
    scope: { tenantId: '018f0000-0000-7000-8000-000000000002' },
  });
}

function executor(begin: IdempotencyBeginResult): {
  repository: jest.Mocked<IdempotencyRepository>;
  executor: IdempotencyExecutor;
} {
  const repository: jest.Mocked<IdempotencyRepository> = {
    begin: jest.fn(() => Promise.resolve(begin)),
    complete: jest.fn(() => Promise.resolve()),
  };
  const unitOfWork: UnitOfWork = { execute: (_context, work) => work(TRANSACTION) };
  const clock: Clock = { now: () => new Date(NOW) };
  const ids: IdGenerator = { generate: () => '018f0000-0000-7000-8000-000000000003' };
  return { repository, executor: new IdempotencyExecutor(repository, unitOfWork, clock, ids) };
}

describe('idempotency security invariants', () => {
  it('replays the recorded status and body without re-running work', async () => {
    const { executor: idempotency, repository } = executor({
      kind: 'REPLAY',
      status: 201,
      body: { id: 'recorded-id' },
    });
    const work = jest.fn(() => Promise.resolve({ id: 'new-id' }));

    const result = await idempotency.execute(
      context(),
      {
        key: 'idempotency-key-0001',
        operation: 'test.create',
        request: { nested: { second: 2, first: 1 } },
        successStatus: 201,
      },
      work,
    );

    expect(result).toEqual({ value: { id: 'recorded-id' }, replayed: true, status: 201 });
    expect(work).not.toHaveBeenCalled();
    expect(repository.complete.mock.calls).toHaveLength(0);
  });

  it.each([
    ['KEY_REUSED', 'REQUEST.IDEMPOTENCY_KEY_REUSED', false],
    ['IN_PROGRESS', 'REQUEST.IDEMPOTENCY_IN_PROGRESS', true],
  ] as const)('fails closed for %s records', async (kind, code, retryable) => {
    const { executor: idempotency } = executor({ kind });

    await expect(
      idempotency.execute(
        context(),
        {
          key: 'idempotency-key-0002',
          operation: 'test.create',
          request: { value: 1 },
          successStatus: 201,
        },
        () => Promise.resolve({ id: 'new-id' }),
      ),
    ).rejects.toMatchObject({ code, status: 409, retryable });
  });

  it('rejects missing, short, whitespace, and non-ASCII keys before persistence', async () => {
    for (const key of ['', 'short', 'contains whitespace', 'non-ascii-नेपाल-0001']) {
      const { executor: idempotency, repository } = executor({ kind: 'STARTED' });
      await expect(
        Promise.resolve().then(() =>
          idempotency.execute(
            context(),
            { key, operation: 'test.create', request: {}, successStatus: 201 },
            () => Promise.resolve({ id: 'new-id' }),
          ),
        ),
      ).rejects.toMatchObject({ code: 'REQUEST.IDEMPOTENCY_KEY_INVALID', status: 400 });
      expect(repository.begin.mock.calls).toHaveLength(0);
    }
  });
});
