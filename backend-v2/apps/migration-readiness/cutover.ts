import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const requiredEvidence = [
  'SECURITY_REVIEW',
  'CAPACITY_SLO',
  'PROVIDER_CANARY',
  'BACKUP_RESTORE_DR',
  'MIGRATION_REHEARSAL',
  'FINAL_DELTA_RECONCILIATION',
  'MOBILE_MINIMUM_VERSION',
  'PORTAL_PERSONAS',
  'DIRECT_WRITES_DISABLED',
  'ACTIVE_WORK_DRAINED',
  'SUPPORT_COMMUNICATIONS',
  'ROLLBACK_DRILL',
  'CANARY_DISPATCH_SOS',
] as const;
const evidenceSchema = z
  .object({
    kind: z.enum(requiredEvidence),
    status: z.enum(['PASS', 'FAIL', 'PENDING']),
    artifactSha256: hash,
    owner: id,
    validUntil: z.iso.datetime(),
  })
  .strict();
export const cutoverSchema = z
  .object({
    formatVersion: z.literal(1),
    releaseCommit: z.string().regex(/^[a-f0-9]{40}$/),
    evaluatedAt: z.iso.datetime(),
    incidentCommander: id,
    gates: z.array(
      z
        .object({
          gate: z.number().int().min(1).max(7),
          decision: z.enum(['APPROVED', 'HOLD']),
          owner: id,
          artifactSha256: hash,
        })
        .strict(),
    ),
    evidence: z.array(evidenceSchema),
    requiredCohorts: z.array(z.object({ capability: id, cohort: id }).strict()).min(1),
    writers: z.array(
      z
        .object({
          capability: id,
          cohort: id,
          writer: z.enum(['LEGACY', 'TARGET']),
          epoch: z.number().int().min(1),
          boundary: z.iso.datetime(),
        })
        .strict(),
    ),
    unresolvedCriticalOrHigh: z.number().int().nonnegative(),
    activeLegacyTrips: z.number().int().nonnegative(),
    targetAuthoritativeWrites: z.number().int().nonnegative(),
    rollbackMode: z.enum(['PRE_WRITE_ROUTING', 'TARGET_FORWARD_FIX']),
  })
  .strict();

/** Offline readiness evaluation. Artifact authenticity/signatures remain an owner review. */
export function evaluateCutover(
  value: unknown,
  now = new Date(),
): {
  formatVersion: number;
  releaseCommit: string;
  disposition: 'HOLD' | 'READY_FOR_OWNER_REVIEW';
  productionAuthorized: false;
  blockers: string[];
} {
  const input = cutoverSchema.parse(value);
  const blockers = new Set<string>();
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (evaluatedAt > now.getTime() || now.getTime() - evaluatedAt > 60 * 60 * 1000)
    blockers.add('STALE_EVALUATION');
  for (let gate = 1; gate <= 7; gate++) {
    const rows = input.gates.filter((row) => row.gate === gate);
    if (rows.length !== 1 || rows[0]?.decision !== 'APPROVED')
      blockers.add(`GATE_${String(gate)}_NOT_APPROVED`);
  }
  for (const kind of requiredEvidence) {
    const rows = input.evidence.filter((row) => row.kind === kind);
    if (
      rows.length !== 1 ||
      rows[0]?.status !== 'PASS' ||
      Date.parse(rows[0].validUntil) <= now.getTime()
    )
      blockers.add(`EVIDENCE_${kind}`);
  }
  const cohortKey = (row: { capability: string; cohort: string }): string =>
    JSON.stringify([row.capability, row.cohort]);
  const cohorts = new Set(input.requiredCohorts.map(cohortKey));
  if (cohorts.size !== input.requiredCohorts.length) blockers.add('DUPLICATE_REQUIRED_COHORT');
  for (const cohort of cohorts) {
    const writers = input.writers.filter((row) => cohortKey(row) === cohort);
    if (writers.length !== 1) blockers.add('ONE_WRITER_VIOLATION');
    if (writers.some((row) => Date.parse(row.boundary) > evaluatedAt))
      blockers.add('FUTURE_WRITER_BOUNDARY');
  }
  if (input.writers.some((row) => !cohorts.has(cohortKey(row)))) blockers.add('UNDECLARED_COHORT');
  if (input.unresolvedCriticalOrHigh) blockers.add('UNRESOLVED_CRITICAL_HIGH');
  if (input.activeLegacyTrips) blockers.add('ACTIVE_LEGACY_WORK');
  if (input.targetAuthoritativeWrites > 0 && input.rollbackMode !== 'TARGET_FORWARD_FIX')
    blockers.add('UNSAFE_POST_WRITE_ROLLBACK');
  return {
    formatVersion: 1,
    releaseCommit: input.releaseCommit,
    disposition: blockers.size ? 'HOLD' : 'READY_FOR_OWNER_REVIEW',
    productionAuthorized: false,
    blockers: [...blockers].sort(),
  };
}
