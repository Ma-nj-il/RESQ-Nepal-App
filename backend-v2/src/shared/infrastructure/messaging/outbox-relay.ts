import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { EntityManager } from 'typeorm';

import type { JsonValue } from '../../application/idempotency/idempotency.js';
import { KafkaService } from '../dependencies/kafka.service.js';
import { DatabaseService } from '../persistence/database.service.js';

interface OutboxRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly schema_version: number;
  readonly producer: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: string;
  readonly stream_type: string;
  readonly stream_id: string;
  readonly stream_sequence: string;
  readonly tenant_id: string | null;
  readonly facility_id: string | null;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly traceparent: string | null;
  readonly actor_type: 'USER' | 'WORKLOAD' | 'SYSTEM_POLICY';
  readonly actor_id: string | null;
  readonly event_data: Readonly<Record<string, JsonValue>>;
  readonly occurred_at: Date;
  readonly publish_attempts: number;
}

const TOPIC_BY_DOMAIN: Readonly<Record<string, string>> = Object.freeze({
  identity: 'resq.identity.events.v1',
  access: 'resq.access.events.v1',
  provider: 'resq.provider.events.v1',
  workforce: 'resq.workforce.events.v1',
  fleet: 'resq.fleet.events.v1',
  document: 'resq.document.events.v1',
  booking: 'resq.booking.events.v1',
  dispatch: 'resq.dispatch.events.v1',
  trip: 'resq.trip.events.v1',
  safety: 'resq.safety.events.v1',
  communication: 'resq.communication.events.v1',
  support: 'resq.support.events.v1',
  billing: 'resq.billing.events.v1',
});

const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 25;

export function topicForEvent(eventType: string): string {
  const domain = eventType.split('.')[0];
  const topic = domain === undefined ? undefined : TOPIC_BY_DOMAIN[domain];
  if (topic === undefined) throw new Error('Unsupported outbox event domain');
  return topic;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.message === 'Unsupported outbox event domain') {
    return 'OUTBOX.UNSUPPORTED_EVENT_DOMAIN';
  }
  return 'OUTBOX.PUBLISH_FAILED';
}

@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private stopping = false;
  private loop: Promise<void> | undefined;
  private wakeTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(KafkaService) private readonly kafka: KafkaService,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxRelay.name);
  }

  onApplicationBootstrap(): void {
    this.loop = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.loop;
  }

  async relayBatch(): Promise<number> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const events: OutboxRow[] = await manager.query(
        `SELECT candidate.event_id, candidate.event_type, candidate.schema_version,
                candidate.producer, candidate.aggregate_type, candidate.aggregate_id,
                candidate.aggregate_version, candidate.stream_type, candidate.stream_id,
                candidate.stream_sequence, candidate.tenant_id, candidate.facility_id,
                candidate.correlation_id, candidate.causation_id, candidate.traceparent,
                candidate.actor_type, candidate.actor_id, candidate.event_data,
                candidate.occurred_at, candidate.publish_attempts
           FROM governance.outbox_events candidate
          WHERE candidate.published_at IS NULL
            AND candidate.available_at <= statement_timestamp()
            AND NOT EXISTS (
              SELECT 1
                FROM governance.outbox_events earlier
               WHERE earlier.stream_type = candidate.stream_type
                 AND earlier.stream_id = candidate.stream_id
                 AND earlier.stream_sequence < candidate.stream_sequence
                 AND earlier.published_at IS NULL
            )
          ORDER BY candidate.available_at, candidate.occurred_at, candidate.event_id
          LIMIT $1
          FOR UPDATE OF candidate SKIP LOCKED`,
        [BATCH_SIZE],
      );

      for (const event of events) await this.publish(manager, event);
      return events.length;
    });
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        const count = await this.relayBatch();
        if (count === 0) await this.wait(POLL_INTERVAL_MS);
      } catch (error) {
        this.logger.error(
          { errorCode: 'OUTBOX.RELAY_BATCH_FAILED', error },
          'Outbox relay batch failed',
        );
        await this.wait(1_000);
      }
    }
  }

  private async publish(manager: EntityManager, event: OutboxRow): Promise<void> {
    try {
      const topic = topicForEvent(event.event_type);
      const metadata = await this.kafka.publish({
        topic,
        key: event.stream_id,
        value: JSON.stringify(this.envelope(event)),
        headers: {
          eventId: event.event_id,
          eventType: event.event_type,
          schemaVersion: String(event.schema_version),
          correlationId: event.correlation_id,
          ...(event.traceparent === null ? {} : { traceparent: event.traceparent }),
        },
      });
      const offset = metadata.baseOffset ?? metadata.offset;
      if (offset === undefined) throw new Error('Kafka acknowledgement omitted its offset');
      await manager.query(
        `UPDATE governance.outbox_events
            SET published_at = statement_timestamp(), publish_attempts = publish_attempts + 1,
                last_error_code = NULL, broker_partition = $2, broker_offset = $3
          WHERE event_id = $1 AND published_at IS NULL`,
        [event.event_id, metadata.partition, offset],
      );
    } catch (error) {
      const delayMs = this.retryDelay(event.publish_attempts);
      const errorCode = safeErrorCode(error);
      await manager.query(
        `UPDATE governance.outbox_events
            SET publish_attempts = publish_attempts + 1, last_error_code = $2,
                available_at = statement_timestamp() + ($3::integer * interval '1 millisecond')
          WHERE event_id = $1 AND published_at IS NULL`,
        [event.event_id, errorCode, delayMs],
      );
      this.logger.warn(
        {
          errorCode,
          eventId: event.event_id,
          eventType: event.event_type,
          retryDelayMs: delayMs,
        },
        'Outbox event publish deferred',
      );
    }
  }

  private envelope(event: OutboxRow): Readonly<Record<string, unknown>> {
    return {
      eventId: event.event_id,
      eventType: event.event_type,
      schemaVersion: event.schema_version,
      occurredAt: event.occurred_at.toISOString(),
      producer: event.producer,
      aggregate: {
        type: event.aggregate_type,
        id: event.aggregate_id,
        version: Number(event.aggregate_version),
      },
      stream: {
        type: event.stream_type,
        id: event.stream_id,
        sequence: Number(event.stream_sequence),
      },
      ...(event.tenant_id === null ? {} : { tenantId: event.tenant_id }),
      ...(event.facility_id === null ? {} : { facilityId: event.facility_id }),
      correlationId: event.correlation_id,
      causationId: event.causation_id,
      ...(event.traceparent === null ? {} : { traceparent: event.traceparent }),
      actor: {
        type: event.actor_type,
        ...(event.actor_id === null ? {} : { id: event.actor_id }),
      },
      data: event.event_data,
    };
  }

  private retryDelay(priorAttempts: number): number {
    const exponential = Math.min(60_000, 250 * 2 ** Math.min(priorAttempts, 8));
    return exponential + Math.floor(Math.random() * 250);
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
