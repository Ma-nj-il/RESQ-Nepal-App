import { randomBytes, randomUUID } from 'node:crypto';

import { jest } from '@jest/globals';

import { ProductService } from '../../src/product-services/application/product.service.js';
import type { ProductRepository } from '../../src/product-services/application/ports/product.repository.js';
import { AesSupportContentProtector } from '../../src/product-services/infrastructure/aes-support-content.protector.js';
import {
  RequestContext,
  type RequestScope,
} from '../../src/shared/application/context/request-context.js';
import {
  IdempotencyExecutor,
  type IdempotencyRepository,
} from '../../src/shared/application/idempotency/idempotency.js';
import type { UnitOfWork } from '../../src/shared/application/persistence/unit-of-work.js';
import { loadApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';

const USER_ID = randomUUID();
const TRIP_ID = randomUUID();
const KEY = 'product-test-idempotency-key';

function context(scope?: Partial<RequestScope>): RequestContext {
  return new RequestContext({
    requestId: 'test',
    correlationId: 'test',
    source: 'HTTP',
    actor: { type: 'USER', id: USER_ID },
    authentication: { assurance: 'AAL2', tokenVersion: 1, permissionCodes: ['cash.record'] },
    ...(scope === undefined ? {} : { scope }),
  });
}

function protector(): AesSupportContentProtector {
  const config = loadApplicationConfig({ NODE_ENV: 'test' }, 'api');
  return new AesSupportContentProtector({
    ...config,
    dispatch: {
      ...config.dispatch,
      patientDataEncryptionKeyBase64: randomBytes(32).toString('base64'),
      patientDataEncryptionKeyId: 'synthetic-test-key',
    },
  });
}

function fixture(): {
  service: ProductService;
  repository: jest.Mocked<ProductRepository>;
  replay: jest.Mocked<IdempotencyRepository>;
  content: AesSupportContentProtector;
} {
  const repository: jest.Mocked<ProductRepository> = {
    command: jest.fn<ProductRepository['command']>().mockResolvedValue('OK'),
    preferences: jest.fn<ProductRepository['preferences']>().mockResolvedValue({ version: 1 }),
    ticket: jest.fn<ProductRepository['ticket']>().mockResolvedValue({ id: TRIP_ID, version: 1 }),
    tickets: jest.fn<ProductRepository['tickets']>().mockResolvedValue([]),
    messages: jest.fn<ProductRepository['messages']>().mockResolvedValue([]),
    notifications: jest.fn<ProductRepository['notifications']>().mockResolvedValue([]),
    markRead: jest.fn<ProductRepository['markRead']>().mockResolvedValue(false),
    receipt: jest.fn<ProductRepository['receipt']>().mockResolvedValue(undefined),
    cashSummary: jest.fn<ProductRepository['cashSummary']>().mockResolvedValue([]),
  };
  const replay: jest.Mocked<IdempotencyRepository> = {
    begin: jest.fn<IdempotencyRepository['begin']>().mockResolvedValue({ kind: 'STARTED' }),
    complete: jest.fn<IdempotencyRepository['complete']>().mockResolvedValue(undefined),
  };
  const uow: UnitOfWork = { execute: (_context, work) => work({ transactionId: 'unit-test' }) };
  const ids = { generate: randomUUID };
  const idempotency = new IdempotencyExecutor(replay, uow, { now: () => new Date() }, ids);
  const content = protector();
  return {
    service: new ProductService(repository, uow, idempotency, content, ids),
    repository,
    replay,
    content,
  };
}

describe('product workflow security', () => {
  it('encrypts support content and keeps plaintext out of stored replay bodies', async () => {
    const { service, repository, replay, content } = fixture();
    const message = 'Synthetic private support message';
    await service.createTicket(context(), KEY, { category: 'ACCOUNT', message });
    const command = repository.command.mock.calls[0]?.[1];
    expect(command?.kind).toBe('TICKET');
    if (command?.kind !== 'TICKET') throw new Error('Missing ticket command');
    expect(command.content.ciphertext.toString('utf8')).not.toContain(message);
    expect(content.reveal(command.messageId, command.id, command.content)).toBe(message);
    expect(JSON.stringify(replay.complete.mock.calls)).not.toContain(message);
    expect(JSON.stringify(replay.begin.mock.calls)).not.toContain(message);
  });

  it('rejects ciphertext, tag, resource binding, and key-version tampering', () => {
    const content = protector();
    const encrypted = content.protect('message-a', 'ticket-a', 'Synthetic message');
    expect(() => content.reveal('message-b', 'ticket-a', encrypted)).toThrow(
      'Protected support content is unavailable',
    );
    expect(() => content.reveal('message-a', 'ticket-b', encrypted)).toThrow(
      'Protected support content is unavailable',
    );
    for (const field of ['ciphertext', 'tag'] as const) {
      const tampered = Buffer.from(encrypted[field]);
      tampered[0] = (tampered[0] ?? 0) ^ 1;
      expect(() =>
        content.reveal('message-a', 'ticket-a', { ...encrypted, [field]: tampered }),
      ).toThrow('Protected support content is unavailable');
    }
    expect(() =>
      content.reveal('message-a', 'ticket-a', { ...encrypted, keyVersion: 'other-key' }),
    ).toThrow('Protected support content is unavailable');
    expect(() => protector().reveal('message-a', 'ticket-a', encrypted)).toThrow(
      'Protected support content is unavailable',
    );
  });

  it('fails closed when support encryption is unconfigured', () => {
    const unconfigured = new AesSupportContentProtector(
      loadApplicationConfig({ NODE_ENV: 'test' }, 'api'),
    );
    expect(() => unconfigured.protect('message', 'ticket', 'text')).toThrow(
      'Protected support content is unavailable',
    );
  });

  it('binds replay hashes to facility narrowing and scope type', async () => {
    const { service, replay } = fixture();
    const tenantId = randomUUID(),
      facilityId = randomUUID();
    await service.cash(
      context({ tenantId, accessScopeType: 'TENANT' }),
      KEY,
      TRIP_ID,
      2,
      '9007199254740993',
    );
    await service.cash(
      context({ tenantId, accessScopeType: 'FACILITY_SET', facilityIds: [facilityId] }),
      KEY,
      TRIP_ID,
      2,
      '9007199254740993',
    );
    expect(replay.begin.mock.calls[0]?.[1].requestHash).not.toEqual(
      replay.begin.mock.calls[1]?.[1].requestHash,
    );
  });

  it('returns a stored replay without another mutation', async () => {
    const { service, replay, repository } = fixture();
    replay.begin.mockResolvedValue({ kind: 'REPLAY', status: 201, body: { id: TRIP_ID } });
    await expect(service.rate(context(), KEY, TRIP_ID, 3, 5)).resolves.toEqual({
      value: { id: TRIP_ID },
      status: 201,
      replayed: true,
    });
    expect(repository.command.mock.calls).toHaveLength(0);
  });

  it('prevents self-only actions under tenant context and metadata-only authority content access', async () => {
    const { service, repository } = fixture();
    expect(() => service.rate(context({ tenantId: randomUUID() }), KEY, TRIP_ID, 2, 5)).toThrow(
      'not found',
    );
    expect(() => service.notifications(context({ tenantId: randomUUID() }))).toThrow('not found');
    expect(() => service.messages(context({ authorityGrantId: randomUUID() }), TRIP_ID)).toThrow(
      'not found',
    );
    expect(() => service.cash(context(), KEY, TRIP_ID, 2, '100')).toThrow('not found');
    await expect(service.markRead(context(), randomUUID())).rejects.toMatchObject({
      code: 'RESOURCE.NOT_FOUND',
    });
    expect(repository.messages.mock.calls).toHaveLength(0);
    expect(repository.command.mock.calls).toHaveLength(0);
  });

  it('keeps bigint money exact and rejects malformed or out-of-range values', async () => {
    const { service, repository } = fixture();
    const actor = context({ tenantId: randomUUID() });
    await expect(service.cash(actor, KEY, TRIP_ID, 2, '9007199254740993')).resolves.toMatchObject({
      value: { amount: { amountMinor: '9007199254740993', currency: 'NPR' } },
    });
    for (const amount of ['-1', '1.5', '01', '1e3', '9223372036854775808']) {
      expect(() => service.cash(actor, KEY, TRIP_ID, 2, amount)).toThrow('request is invalid');
    }
    expect(repository.command.mock.calls).toHaveLength(1);
  });

  it.each([
    ['AMOUNT_MISMATCH', 'CASH.AMOUNT_MISMATCH', 422],
    ['ALREADY_RECORDED', 'PRODUCT.ALREADY_RECORDED', 409],
    ['STALE_VERSION', 'REQUEST.STALE_VERSION', 409],
    ['INVALID_STATE', 'PRODUCT.INVALID_STATE', 422],
    ['NOT_FOUND', 'RESOURCE.NOT_FOUND', 404],
  ] as const)('maps %s without completing an idempotency record', async (result, code, status) => {
    const { service, repository, replay } = fixture();
    repository.command.mockResolvedValue(result);
    await expect(
      service.cash(context({ tenantId: randomUUID() }), KEY, TRIP_ID, 2, '100'),
    ).rejects.toMatchObject({ code, status });
    expect(replay.complete.mock.calls).toHaveLength(0);
  });

  it('permits version zero only for initial preferences and rejects empty support text', async () => {
    const { service, repository } = fixture();
    await service.replacePreferences(context(), KEY, 0, {
      bookingUpdates: true,
      tripUpdates: true,
      supportUpdates: true,
      marketing: false,
    });
    expect(repository.command.mock.calls[0]?.[1]).toMatchObject({
      kind: 'PREFERENCES',
      version: 0,
    });
    expect(() => service.rate(context(), KEY, TRIP_ID, 0, 5)).toThrow('request is invalid');
    expect(() =>
      service.createTicket(context(), KEY, { category: 'ACCOUNT', message: ' \n ' }),
    ).toThrow('request is invalid');
  });

  it('bounds pages and returns a continuation only when another item exists', async () => {
    const { service, repository } = fixture();
    repository.notifications.mockResolvedValue(
      Array.from({ length: 51 }, (_, index) => ({ id: String(index) })),
    );
    await expect(service.notifications(context())).resolves.toMatchObject({ nextAfterId: '49' });
    repository.notifications.mockResolvedValue([{ id: 'last' }]);
    await expect(service.notifications(context())).resolves.toEqual({
      items: [{ id: 'last' }],
      nextAfterId: null,
    });
  });

  it('requires report permission and a bounded positive report window', async () => {
    const { service, repository } = fixture();
    const from = '2026-11-01T00:00:00Z',
      to = '2026-11-02T00:00:00Z';
    expect(() => service.cashSummary(context({ tenantId: randomUUID() }), from, to)).toThrow(
      'not found',
    );
    const actor = new RequestContext({
      requestId: 'report',
      correlationId: 'report',
      source: 'HTTP',
      actor: { type: 'USER', id: USER_ID },
      scope: { tenantId: randomUUID() },
      authentication: {
        assurance: 'AAL1',
        tokenVersion: 1,
        permissionCodes: ['report.tenant.read'],
      },
    });
    expect(() => service.cashSummary(actor, to, from)).toThrow('request is invalid');
    expect(() => service.cashSummary(actor, from, '2027-01-01T00:00:00Z')).toThrow(
      'request is invalid',
    );
    await expect(service.cashSummary(actor, from, to)).resolves.toMatchObject({
      currency: 'NPR',
      cohort: 'TRIP_COMPLETED_AT',
      items: [],
    });
    expect(repository.cashSummary.mock.calls).toHaveLength(1);
  });
});
