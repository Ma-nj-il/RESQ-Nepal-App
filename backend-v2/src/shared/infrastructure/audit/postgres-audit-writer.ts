import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { AuditRecordInput, AuditWriter } from '../../application/audit/audit-writer.js';
import type { TransactionContext } from '../../application/persistence/unit-of-work.js';
import { entityManagerFor } from '../persistence/typeorm-unit-of-work.js';

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}

function eventHash(input: AuditRecordInput, previousHash: Uint8Array | undefined): Buffer {
  const hasher = createHash('sha256');
  if (previousHash !== undefined) hasher.update(previousHash);
  hasher.update(
    JSON.stringify(
      canonicalValue({
        id: input.id,
        occurredAt: input.occurredAt.toISOString(),
        tenantId: input.tenantId ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        sessionId: input.sessionId ?? null,
        authorityGrantId: input.authorityGrantId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        outcome: input.outcome,
        reasonCode: input.reasonCode,
        correlationId: input.correlationId,
        safeContext: input.safeContext ?? {},
      }),
    ),
    'utf8',
  );
  return hasher.digest();
}

@Injectable()
export class PostgresAuditWriter implements AuditWriter {
  async append(transaction: TransactionContext, input: AuditRecordInput): Promise<void> {
    const manager = entityManagerFor(transaction);
    const chainScope = input.tenantId ?? `principal:${input.actorId ?? 'system'}`;
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [chainScope]);
    const previousRows: { event_hash: Buffer }[] = await manager.query(
      `SELECT event_hash
         FROM governance.audit_events
        WHERE tenant_id IS NOT DISTINCT FROM $1
          AND actor_id IS NOT DISTINCT FROM $2
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1`,
      [input.tenantId ?? null, input.tenantId === undefined ? (input.actorId ?? null) : null],
    );
    const previousHash = previousRows[0]?.event_hash;
    const hash = eventHash(input, previousHash);
    await manager.query(
      `INSERT INTO governance.audit_events (
        occurred_at, id, tenant_id, actor_type, actor_id, session_id, authority_grant_id,
        authentication_assurance, action, resource_type, resource_id, outcome, reason_code,
        correlation_id, causation_id, trace_id, source_channel, safe_context, previous_hash,
        event_hash, retention_class
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18::jsonb, $19, $20, $21
      )`,
      [
        input.occurredAt,
        input.id,
        input.tenantId ?? null,
        input.actorType,
        input.actorId ?? null,
        input.sessionId ?? null,
        input.authorityGrantId ?? null,
        input.authenticationAssurance ?? null,
        input.action,
        input.resourceType,
        input.resourceId ?? null,
        input.outcome,
        input.reasonCode,
        input.correlationId,
        input.causationId ?? null,
        input.traceId ?? null,
        input.source,
        JSON.stringify(input.safeContext ?? {}),
        previousHash ?? null,
        hash,
        input.retentionClass,
      ],
    );
  }
}
