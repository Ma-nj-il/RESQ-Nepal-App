import { createHash } from 'node:crypto';

import type { RequestContext } from '../context/request-context.js';
import { ApplicationError } from '../errors/application-error.js';
import type { TransactionContext, UnitOfWork } from '../persistence/unit-of-work.js';
import type { Clock } from '../../domain/clock.js';
import type { IdGenerator } from '../../domain/id-generator.js';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type IdempotencyBeginResult =
  | { readonly kind: 'STARTED' }
  | { readonly kind: 'REPLAY'; readonly status: number; readonly body: JsonValue }
  | { readonly kind: 'IN_PROGRESS' }
  | { readonly kind: 'KEY_REUSED' };

export interface IdempotencyRepository {
  begin(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly tenantId?: string;
      readonly actorId: string;
      readonly operation: string;
      readonly keyHash: Uint8Array;
      readonly requestHash: Uint8Array;
      readonly now: Date;
      readonly lockedUntil: Date;
      readonly expiresAt: Date;
    },
  ): Promise<IdempotencyBeginResult>;
  complete(
    transaction: TransactionContext,
    input: {
      readonly tenantId?: string;
      readonly actorId: string;
      readonly operation: string;
      readonly keyHash: Uint8Array;
      readonly status: number;
      readonly body: JsonValue;
      readonly now: Date;
    },
  ): Promise<void>;
}

export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]),
  );
}

function hash(value: string): Uint8Array {
  return createHash('sha256').update(value, 'utf8').digest();
}

export interface IdempotentResult<T extends JsonValue> {
  readonly value: T;
  readonly replayed: boolean;
  readonly status: number;
}

export class IdempotencyExecutor {
  constructor(
    private readonly repository: IdempotencyRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  execute<T extends JsonValue>(
    context: RequestContext,
    input: {
      readonly key: string;
      readonly operation: string;
      readonly request: JsonValue;
      readonly successStatus: number;
      readonly retentionSeconds?: number;
    },
    work: (transaction: TransactionContext) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    if (!/^[\x21-\x7E]{16,128}$/.test(input.key)) {
      throw new ApplicationError({
        code: 'REQUEST.IDEMPOTENCY_KEY_INVALID',
        message: 'A valid Idempotency-Key header is required.',
        status: 400,
        details: [{ field: 'Idempotency-Key', code: 'INVALID' }],
      });
    }
    if (context.actor?.type !== 'USER') {
      throw new ApplicationError({
        code: 'AUTH.AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        status: 401,
      });
    }
    const actorId = context.actor.id;
    const keyHash = hash(input.key);
    const requestHash = hash(JSON.stringify(canonical(input.request)));
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + (input.retentionSeconds ?? 86_400) * 1_000);
    const lockedUntil = new Date(now.getTime() + 30_000);

    return this.unitOfWork.execute(context, async (transaction) => {
      const begin = await this.repository.begin(transaction, {
        id: this.ids.generate(),
        ...(context.scope.tenantId === undefined ? {} : { tenantId: context.scope.tenantId }),
        actorId,
        operation: input.operation,
        keyHash,
        requestHash,
        now,
        lockedUntil,
        expiresAt,
      });
      if (begin.kind === 'KEY_REUSED') {
        throw new ApplicationError({
          code: 'REQUEST.IDEMPOTENCY_KEY_REUSED',
          message: 'The idempotency key was already used for a different request.',
          status: 409,
        });
      }
      if (begin.kind === 'IN_PROGRESS') {
        throw new ApplicationError({
          code: 'REQUEST.IDEMPOTENCY_IN_PROGRESS',
          message: 'The original request is still in progress.',
          status: 409,
          retryable: true,
        });
      }
      if (begin.kind === 'REPLAY') {
        return { value: begin.body as T, replayed: true, status: begin.status };
      }

      const value = await work(transaction);
      await this.repository.complete(transaction, {
        ...(context.scope.tenantId === undefined ? {} : { tenantId: context.scope.tenantId }),
        actorId,
        operation: input.operation,
        keyHash,
        status: input.successStatus,
        body: value,
        now: this.clock.now(),
      });
      return { value, replayed: false, status: input.successStatus };
    });
  }
}

export const IDEMPOTENCY_EXECUTOR = Symbol('IDEMPOTENCY_EXECUTOR');
