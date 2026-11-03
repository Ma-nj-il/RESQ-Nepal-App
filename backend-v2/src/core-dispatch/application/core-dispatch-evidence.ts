import type { AuditRecordInput } from '../../shared/application/audit/audit-writer.js';
import type { RequestContext } from '../../shared/application/context/request-context.js';

export function auditEvidence(
  context: RequestContext,
  input: {
    readonly id: string;
    readonly occurredAt: Date;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId?: string;
    readonly reasonCode: string;
    readonly tenantId?: string;
    readonly safeContext?: AuditRecordInput['safeContext'];
  },
): AuditRecordInput {
  return {
    id: input.id,
    occurredAt: input.occurredAt,
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    actorType: context.actor?.type ?? 'SYSTEM_POLICY',
    ...(context.actor === undefined ? {} : { actorId: context.actor.id }),
    ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
    ...(context.scope.authorityGrantId === undefined
      ? {}
      : { authorityGrantId: context.scope.authorityGrantId }),
    ...(context.authentication === undefined
      ? {}
      : { authenticationAssurance: context.authentication.assurance }),
    action: input.action,
    resourceType: input.resourceType,
    ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId }),
    outcome: 'ALLOWED',
    reasonCode: input.reasonCode,
    correlationId: context.correlationId,
    ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
    ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
    source: context.source,
    ...(input.safeContext === undefined ? {} : { safeContext: input.safeContext }),
    retentionClass: 'EMERGENCY_OPERATIONS',
  };
}
