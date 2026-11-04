import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const nonnegative = z.number().int().nonnegative();

export const requiredStabilizationEvidence = [
  'CUTOVER_EXECUTION',
  'STABILIZATION_SLO',
  'BUSINESS_RECONCILIATION',
  'SECURITY_MONITORING',
  'PROVIDER_OUTCOMES',
  'QUEUE_EVENT_HEALTH',
  'SUPPORT_REVIEW',
  'OPERATIONS_ACCEPTANCE',
  'DATA_ACCEPTANCE',
  'FINANCE_ACCEPTANCE',
] as const;

const evidenceSchema = z
  .object({
    kind: z.enum(requiredStabilizationEvidence),
    status: z.enum(['PASS', 'FAIL', 'PENDING']),
    artifactSha256: hash,
    owner: id,
    validUntil: z.iso.datetime(),
  })
  .strict();

const checkpointSchema = z
  .object({
    observedAt: z.iso.datetime(),
    decision: z.enum(['GO', 'HOLD', 'ROLLBACK']),
    decisionOwner: id,
    artifactSha256: hash,
    health: z
      .object({
        slo: z.enum(['PASS', 'FAIL']),
        businessReconciliation: z.enum(['PASS', 'FAIL']),
        security: z.enum(['PASS', 'FAIL']),
        providers: z.enum(['PASS', 'FAIL']),
        queuesAndEvents: z.enum(['PASS', 'FAIL']),
        support: z.enum(['PASS', 'FAIL']),
      })
      .strict(),
    openCriticalOrHigh: nonnegative,
    authorizationBoundaryViolations: nonnegative,
    duplicateActiveAssignments: nonnegative,
    unaccountedBusinessRecords: nonnegative,
    monetaryReconciliationFailures: nonnegative,
    legacyAuthoritativeWrites: nonnegative,
    failedDispatchOrSosCanaries: nonnegative,
  })
  .strict();

export const stabilizationSchema = z
  .object({
    formatVersion: z.literal(1),
    releaseCommit: z.string().regex(/^[a-f0-9]{40}$/),
    cutoverReportSha256: hash,
    startedAt: z.iso.datetime(),
    evaluatedAt: z.iso.datetime(),
    approvedWindowMinutes: z.number().int().min(1).max(43_200),
    maxCheckpointGapMinutes: z.number().int().min(1).max(1_440),
    incidentCommander: id,
    evidence: z.array(evidenceSchema),
    checkpoints: z.array(checkpointSchema).min(2).max(50_000),
  })
  .strict();

export type StabilizationInput = z.infer<typeof stabilizationSchema>;

/** Evaluates supplied stabilization evidence only; it cannot close Gate 8 or authorize retirement. */
export function evaluateStabilization(
  value: unknown,
  now = new Date(),
): {
  formatVersion: 1;
  releaseCommit: string;
  disposition: 'HOLD' | 'READY_FOR_OWNER_REVIEW';
  productionAuthorized: false;
  retirementAuthorized: false;
  blockers: string[];
} {
  const input = stabilizationSchema.parse(value);
  const blockers = new Set<string>();
  const startedAt = Date.parse(input.startedAt);
  const evaluatedAt = Date.parse(input.evaluatedAt);
  const nowTime = now.getTime();
  if (evaluatedAt > nowTime || nowTime - evaluatedAt > 60 * 60 * 1000)
    blockers.add('STALE_EVALUATION');
  if (evaluatedAt - startedAt < input.approvedWindowMinutes * 60_000)
    blockers.add('STABILIZATION_WINDOW_INCOMPLETE');

  for (const kind of requiredStabilizationEvidence) {
    const rows = input.evidence.filter((row) => row.kind === kind);
    if (
      rows.length !== 1 ||
      rows[0]?.status !== 'PASS' ||
      Date.parse(rows[0].validUntil) <= nowTime
    )
      blockers.add(`EVIDENCE_${kind}`);
  }

  const gap = input.maxCheckpointGapMinutes * 60_000;
  let previous: number | undefined;
  for (const checkpoint of input.checkpoints) {
    const observedAt = Date.parse(checkpoint.observedAt);
    if (
      observedAt < startedAt ||
      observedAt > evaluatedAt ||
      (previous !== undefined && observedAt <= previous)
    )
      blockers.add('CHECKPOINT_ORDER_OR_RANGE');
    if (observedAt - (previous ?? startedAt) > gap) blockers.add('CHECKPOINT_GAP');
    previous = observedAt;
    if (checkpoint.decision !== 'GO') blockers.add('NON_GO_DECISION');
    if (Object.values(checkpoint.health).some((status) => status !== 'PASS'))
      blockers.add('HEALTH_CHECK_FAILURE');
    if (checkpoint.openCriticalOrHigh) blockers.add('OPEN_CRITICAL_HIGH');
    if (checkpoint.authorizationBoundaryViolations)
      blockers.add('AUTHORIZATION_BOUNDARY_VIOLATION');
    if (checkpoint.duplicateActiveAssignments) blockers.add('DUPLICATE_ACTIVE_ASSIGNMENT');
    if (checkpoint.unaccountedBusinessRecords) blockers.add('UNACCOUNTED_BUSINESS_RECORD');
    if (checkpoint.monetaryReconciliationFailures) blockers.add('MONETARY_MISMATCH');
    if (checkpoint.legacyAuthoritativeWrites) blockers.add('LEGACY_AUTHORITATIVE_WRITE');
    if (checkpoint.failedDispatchOrSosCanaries) blockers.add('FAILED_DISPATCH_SOS_CANARY');
  }
  if (evaluatedAt - (previous ?? startedAt) > gap) blockers.add('CHECKPOINT_GAP');

  return {
    formatVersion: 1,
    releaseCommit: input.releaseCommit,
    disposition: blockers.size ? 'HOLD' : 'READY_FOR_OWNER_REVIEW',
    productionAuthorized: false,
    retirementAuthorized: false,
    blockers: [...blockers].sort(),
  };
}
