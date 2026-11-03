import { Injectable } from '@nestjs/common';

import type { RequestContext } from '../../application/context/request-context.js';
import type {
  DeliveryWriter,
  DomainEventInput,
  JobIntentInput,
} from '../../application/messaging/delivery-writer.js';
import type { TransactionContext } from '../../application/persistence/unit-of-work.js';
import { entityManagerFor } from '../persistence/typeorm-unit-of-work.js';

function actor(context: RequestContext): {
  type: 'USER' | 'WORKLOAD' | 'SYSTEM_POLICY';
  id: string | null;
} {
  if (context.actor?.type === 'USER') return { type: 'USER', id: context.actor.id };
  if (context.actor?.type === 'WORKLOAD') return { type: 'WORKLOAD', id: context.actor.id };
  return { type: 'SYSTEM_POLICY', id: null };
}

@Injectable()
export class PostgresDeliveryWriter implements DeliveryWriter {
  async appendEvent(
    transaction: TransactionContext,
    context: RequestContext,
    input: DomainEventInput,
  ): Promise<number> {
    const manager = entityManagerFor(transaction);
    const sequenceRows: { current_sequence: string }[] = await manager.query(
      `INSERT INTO governance.event_stream_sequences (
         stream_type, stream_id, tenant_id, current_sequence, updated_at
       ) VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (stream_type, stream_id) DO UPDATE
         SET current_sequence = governance.event_stream_sequences.current_sequence + 1,
             updated_at = EXCLUDED.updated_at
       RETURNING current_sequence`,
      [input.streamType, input.streamId, input.tenantId ?? null, input.occurredAt],
    );
    const sequence = Number(sequenceRows[0]?.current_sequence);
    const eventActor = actor(context);
    await manager.query(
      `INSERT INTO governance.outbox_events (
         event_id, event_type, schema_version, producer, aggregate_type, aggregate_id,
         aggregate_version, stream_type, stream_id, stream_sequence, tenant_id, facility_id,
         correlation_id, causation_id, traceparent, actor_type, actor_id, event_data,
         occurred_at, available_at
       ) VALUES (
         $1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL, $14, $15,
         $16::jsonb, $17, $18
       )`,
      [
        input.eventId,
        input.eventType,
        input.producer,
        input.aggregateType,
        input.aggregateId,
        input.aggregateVersion,
        input.streamType,
        input.streamId,
        sequence,
        input.tenantId ?? null,
        input.facilityId ?? null,
        context.correlationId,
        context.causationId ?? context.requestId,
        eventActor.type,
        eventActor.id,
        JSON.stringify(input.data),
        input.occurredAt,
        input.availableAt ?? input.occurredAt,
      ],
    );
    return sequence;
  }

  async scheduleJob(
    transaction: TransactionContext,
    context: RequestContext,
    input: JobIntentInput,
  ): Promise<void> {
    const manager = entityManagerFor(transaction);
    const requestedBy = actor(context);
    await manager.query(
      `INSERT INTO governance.job_intents (
         id, deterministic_job_id, job_type, queue_name, tenant_id, resource_type,
         resource_id, resource_version, run_at, correlation_id, causation_id, traceparent,
         requested_by_type, requested_by_id, job_data, state, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, $12, $13, $14::jsonb,
         'PENDING', $15, $15
       ) ON CONFLICT (deterministic_job_id) DO NOTHING`,
      [
        input.id,
        input.deterministicJobId,
        input.jobType,
        input.queueName,
        input.tenantId ?? null,
        input.resourceType,
        input.resourceId,
        input.resourceVersion ?? null,
        input.runAt,
        context.correlationId,
        context.causationId ?? context.requestId,
        requestedBy.type,
        requestedBy.id ?? 'system-policy',
        JSON.stringify(input.data ?? {}),
        input.requestedAt,
      ],
    );
  }
}
