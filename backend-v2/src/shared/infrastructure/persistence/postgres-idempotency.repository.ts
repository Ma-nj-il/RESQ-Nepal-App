import { Injectable } from '@nestjs/common';

import type {
  IdempotencyBeginResult,
  IdempotencyRepository,
  JsonValue,
} from '../../application/idempotency/idempotency.js';
import type { TransactionContext } from '../../application/persistence/unit-of-work.js';
import { entityManagerFor } from './typeorm-unit-of-work.js';

interface IdempotencyRow {
  readonly request_hash: Buffer;
  readonly state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED_RETRYABLE';
  readonly response_status: number | null;
  readonly response_body: JsonValue | null;
  readonly locked_until: Date | null;
  readonly expires_at: Date;
}

@Injectable()
export class PostgresIdempotencyRepository implements IdempotencyRepository {
  async begin(
    transaction: TransactionContext,
    input: Parameters<IdempotencyRepository['begin']>[1],
  ): Promise<IdempotencyBeginResult> {
    const manager = entityManagerFor(transaction);
    const inserted: { id: string }[] = await manager.query(
      `INSERT INTO governance.idempotency_records (
        id, tenant_id, actor_id, operation, idempotency_key_hash, request_hash, state,
        locked_until, expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'IN_PROGRESS', $7, $8, $9, $9)
      ON CONFLICT (tenant_id, actor_id, operation, idempotency_key_hash) DO NOTHING
      RETURNING id`,
      [
        input.id,
        input.tenantId ?? null,
        input.actorId,
        input.operation,
        Buffer.from(input.keyHash),
        Buffer.from(input.requestHash),
        input.lockedUntil,
        input.expiresAt,
        input.now,
      ],
    );
    if (inserted.length === 1) return { kind: 'STARTED' };

    const rows: IdempotencyRow[] = await manager.query(
      `SELECT request_hash, state, response_status, response_body, locked_until, expires_at
         FROM governance.idempotency_records
        WHERE tenant_id IS NOT DISTINCT FROM $1
          AND actor_id = $2 AND operation = $3 AND idempotency_key_hash = $4
        FOR UPDATE`,
      [input.tenantId ?? null, input.actorId, input.operation, Buffer.from(input.keyHash)],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('Idempotency conflict row disappeared');
    if (!row.request_hash.equals(Buffer.from(input.requestHash))) return { kind: 'KEY_REUSED' };
    if (row.state === 'COMPLETED' && row.response_status !== null && row.response_body !== null) {
      return { kind: 'REPLAY', status: row.response_status, body: row.response_body };
    }
    if (
      row.expires_at.getTime() > input.now.getTime() &&
      row.locked_until !== null &&
      row.locked_until.getTime() > input.now.getTime()
    ) {
      return { kind: 'IN_PROGRESS' };
    }
    await manager.query(
      `UPDATE governance.idempotency_records
          SET request_hash = $5, state = 'IN_PROGRESS', response_status = NULL,
              response_body = NULL, error_code = NULL, locked_until = $6,
              expires_at = $7, updated_at = $8
        WHERE tenant_id IS NOT DISTINCT FROM $1
          AND actor_id = $2 AND operation = $3 AND idempotency_key_hash = $4`,
      [
        input.tenantId ?? null,
        input.actorId,
        input.operation,
        Buffer.from(input.keyHash),
        Buffer.from(input.requestHash),
        input.lockedUntil,
        input.expiresAt,
        input.now,
      ],
    );
    return { kind: 'STARTED' };
  }

  async complete(
    transaction: TransactionContext,
    input: Parameters<IdempotencyRepository['complete']>[1],
  ): Promise<void> {
    await entityManagerFor(transaction).query(
      `UPDATE governance.idempotency_records
          SET state = 'COMPLETED', response_status = $5, response_body = $6::jsonb,
              locked_until = NULL, updated_at = $7
        WHERE tenant_id IS NOT DISTINCT FROM $1
          AND actor_id = $2 AND operation = $3 AND idempotency_key_hash = $4`,
      [
        input.tenantId ?? null,
        input.actorId,
        input.operation,
        Buffer.from(input.keyHash),
        input.status,
        JSON.stringify(input.body),
        input.now,
      ],
    );
  }
}
