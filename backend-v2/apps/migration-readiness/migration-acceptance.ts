import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const nonnegative = z.number().int().nonnegative();

export const requiredMigrationEvidence = [
  'SOURCE_SNAPSHOT_PROVENANCE',
  'SOURCE_PROFILE_AND_SCOPE',
  'MAPPING_TRANSFORM_REVIEW',
  'FULL_VOLUME_REHEARSALS',
  'DETERMINISTIC_REPEATABILITY',
  'POST_LOAD_CONSTRAINTS',
  'POST_LOAD_RLS_AUTHORIZATION',
  'LIFECYCLE_ASSIGNMENT_VALIDATION',
  'FINANCE_RECONCILIATION',
  'PRIVATE_OBJECT_VALIDATION',
  'IDENTITY_OUTCOMES',
  'AUDIT_OUTBOX_INBOX_VALIDATION',
  'PERFORMANCE_LOCK_STORAGE',
  'RESTORE_DR_REHEARSAL',
  'QUARANTINE_EXCEPTION_APPROVALS',
  'STAGING_DELETION_PLAN',
] as const;

const evidenceSchema = z
  .object({
    kind: z.enum(requiredMigrationEvidence),
    status: z.enum(['PASS', 'FAIL', 'PENDING']),
    artifactSha256: hash,
    owner: id,
    validUntil: z.iso.datetime(),
  })
  .strict();

export const migrationAcceptanceSchema = z
  .object({
    formatVersion: z.literal(1),
    evaluatedAt: z.iso.datetime(),
    transformVersion: id,
    finalReconciliationReportSha256: hash,
    evidence: z.array(evidenceSchema),
    rehearsalRuns: z
      .array(
        z
          .object({
            runId: id,
            reportSha256: hash,
            completedAt: z.iso.datetime(),
            fullVolume: z.boolean(),
            status: z.enum(['PASS', 'FAIL']),
          })
          .strict(),
      )
      .min(2)
      .max(100),
    zeroTolerance: z
      .object({
        unaccountedSources: nonnegative,
        orphanOrCrossTenantReferences: nonnegative,
        duplicateOrOverlappingAssignments: nonnegative,
        invalidLifecycleSequences: nonnegative,
        unauthorizedReads: nonnegative,
        monetaryReconciliationFailures: nonnegative,
        restrictedObjectFailures: nonnegative,
        undocumentedIdentityOutcomes: nonnegative,
        auditOutboxInboxFailures: nonnegative,
        applicationRoleMigrationBypasses: nonnegative,
        unreviewedExceptions: nonnegative,
      })
      .strict(),
    unresolvedCriticalOrHigh: nonnegative,
  })
  .strict();

export type MigrationAcceptanceInput = z.infer<typeof migrationAcceptanceSchema>;

/** Verifies Gate 7 evidence inventory and declared zero-tolerance outcomes; owners verify artifacts. */
export function evaluateMigrationAcceptance(
  value: unknown,
  now = new Date(),
): {
  formatVersion: 1;
  transformVersion: string;
  disposition: 'HOLD' | 'READY_FOR_OWNER_REVIEW';
  gateApproved: false;
  productionAuthorized: false;
  blockers: string[];
} {
  const input = migrationAcceptanceSchema.parse(value);
  const blockers = new Set<string>();
  const nowTime = now.getTime();
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (evaluatedAt > nowTime || nowTime - evaluatedAt > 60 * 60 * 1000)
    blockers.add('STALE_EVALUATION');
  for (const kind of requiredMigrationEvidence) {
    const rows = input.evidence.filter((row) => row.kind === kind);
    if (
      rows.length !== 1 ||
      rows[0]?.status !== 'PASS' ||
      Date.parse(rows[0].validUntil) <= nowTime
    )
      blockers.add(`EVIDENCE_${kind}`);
  }
  if (new Set(input.rehearsalRuns.map((run) => run.runId)).size !== input.rehearsalRuns.length)
    blockers.add('DUPLICATE_REHEARSAL_RUN');
  if (
    new Set(input.rehearsalRuns.map((run) => run.reportSha256)).size !== input.rehearsalRuns.length
  )
    blockers.add('DUPLICATE_REHEARSAL_REPORT');
  if (
    input.rehearsalRuns.some(
      (run) =>
        !run.fullVolume || run.status !== 'PASS' || Date.parse(run.completedAt) > evaluatedAt,
    )
  )
    blockers.add('REHEARSAL_NOT_ACCEPTABLE');
  for (const [metric, count] of Object.entries(input.zeroTolerance)) {
    if (count !== 0)
      blockers.add(`ZERO_TOLERANCE_${metric.replace(/[A-Z]/g, '_$&').toUpperCase()}`);
  }
  if (input.unresolvedCriticalOrHigh) blockers.add('UNRESOLVED_CRITICAL_HIGH');
  return {
    formatVersion: 1,
    transformVersion: input.transformVersion,
    disposition: blockers.size ? 'HOLD' : 'READY_FOR_OWNER_REVIEW',
    gateApproved: false,
    productionAuthorized: false,
    blockers: [...blockers].sort(),
  };
}
