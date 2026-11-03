import type { JsonValue } from '../idempotency/idempotency.js';

export interface JobIntentEnvelope {
  readonly jobIntentId: string;
  readonly jobType: string;
  readonly tenantId?: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceVersion?: number;
  readonly runAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly traceparent?: string;
  readonly data: Readonly<Record<string, JsonValue>>;
}
