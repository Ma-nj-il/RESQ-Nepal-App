import type { TransactionContext } from '../persistence/unit-of-work.js';

export type AuditActorType = 'USER' | 'WORKLOAD' | 'SYSTEM_POLICY' | 'BREAK_GLASS';
export type AuditOutcome = 'ALLOWED' | 'DENIED' | 'FAILED';
export type AuditSource = 'HTTP' | 'WEBSOCKET' | 'EVENT' | 'JOB' | 'MIGRATION' | 'SYSTEM';

export interface AuditRecordInput {
  readonly id: string;
  readonly occurredAt: Date;
  readonly tenantId?: string;
  readonly actorType: AuditActorType;
  readonly actorId?: string;
  readonly sessionId?: string;
  readonly authorityGrantId?: string;
  readonly authenticationAssurance?: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly outcome: AuditOutcome;
  readonly reasonCode: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly traceId?: string;
  readonly source: AuditSource;
  readonly safeContext?: Readonly<Record<string, string | number | boolean | null>>;
  readonly retentionClass: string;
}

export interface AuditWriter {
  append(transaction: TransactionContext, input: AuditRecordInput): Promise<void>;
}

export const AUDIT_WRITER = Symbol('AUDIT_WRITER');
