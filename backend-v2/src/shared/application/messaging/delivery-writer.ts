import type { RequestContext } from '../context/request-context.js';
import type { JsonValue } from '../idempotency/idempotency.js';
import type { TransactionContext } from '../persistence/unit-of-work.js';

export interface DomainEventInput {
  readonly eventId: string;
  readonly eventType: string;
  readonly producer: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly streamType: string;
  readonly streamId: string;
  readonly tenantId?: string;
  readonly facilityId?: string;
  readonly occurredAt: Date;
  readonly availableAt?: Date;
  readonly data: Readonly<Record<string, JsonValue>>;
}

export interface JobIntentInput {
  readonly id: string;
  readonly deterministicJobId: string;
  readonly jobType: string;
  readonly queueName: string;
  readonly tenantId?: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceVersion?: number;
  readonly requestedAt: Date;
  readonly runAt: Date;
  readonly data?: Readonly<Record<string, JsonValue>>;
}

/** Writes delivery requirements in the same PostgreSQL transaction as business state. */
export interface DeliveryWriter {
  appendEvent(
    transaction: TransactionContext,
    context: RequestContext,
    input: DomainEventInput,
  ): Promise<number>;
  scheduleJob(
    transaction: TransactionContext,
    context: RequestContext,
    input: JobIntentInput,
  ): Promise<void>;
}

export const DELIVERY_WRITER = Symbol('DELIVERY_WRITER');
