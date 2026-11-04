import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const requiredRetirementEvidence = [
  'STABILIZATION_ACCEPTANCE',
  'NO_LEGACY_TRAFFIC_OR_WRITES',
  'NO_LEGACY_CRON_BRIDGE_WEBHOOK',
  'NO_LEGACY_PROVIDER_CALLBACK',
  'LEGAL_ARCHIVE_VERIFIED',
  'RETENTION_LEGAL_HOLD_REVIEW',
  'ROLLBACK_WINDOW_CLOSED',
  'LEGACY_CREDENTIALS_REVOKED',
  'LEGACY_DATA_IMMUTABLE_OR_DELETED',
  'COMPATIBILITY_PATHS_REMOVED',
  'INFRASTRUCTURE_INVENTORY_CLOSED',
  'COST_SECURITY_OWNER_SIGNOFF',
] as const;

const evidenceSchema = z
  .object({
    kind: z.enum(requiredRetirementEvidence),
    status: z.enum(['PASS', 'FAIL', 'PENDING']),
    artifactSha256: hash,
    owner: id,
    validUntil: z.iso.datetime(),
  })
  .strict();

export const retirementSchema = z
  .object({
    formatVersion: z.literal(1),
    releaseCommit: z.string().regex(/^[a-f0-9]{40}$/),
    stabilizationReportSha256: hash,
    evaluatedAt: z.iso.datetime(),
    evidence: z.array(evidenceSchema),
    legacyDependencies: z.array(
      z
        .object({
          dependencyId: id,
          kind: z.enum([
            'APPLICATION',
            'DATABASE',
            'OBJECT_STORE',
            'QUEUE_OR_TOPIC',
            'CRON_OR_WORKER',
            'WEBHOOK_OR_CALLBACK',
            'DNS_OR_INGRESS',
            'CREDENTIAL_OR_KEY',
            'OPERATOR_ACCESS',
          ]),
          status: z.enum(['RETIRED', 'RETAINED_READ_ONLY', 'ACTIVE', 'UNKNOWN']),
          artifactSha256: hash,
          owner: id,
        })
        .strict(),
    ),
    unresolvedCriticalOrHigh: z.number().int().nonnegative(),
  })
  .strict();

export type RetirementInput = z.infer<typeof retirementSchema>;

/** Evaluates supplied retirement evidence only. Destructive action always requires separate authority. */
export function evaluateRetirement(
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
  const input = retirementSchema.parse(value);
  const blockers = new Set<string>();
  const nowTime = now.getTime();
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (evaluatedAt > nowTime || nowTime - evaluatedAt > 60 * 60 * 1000)
    blockers.add('STALE_EVALUATION');
  for (const kind of requiredRetirementEvidence) {
    const rows = input.evidence.filter((row) => row.kind === kind);
    if (
      rows.length !== 1 ||
      rows[0]?.status !== 'PASS' ||
      Date.parse(rows[0].validUntil) <= nowTime
    )
      blockers.add(`EVIDENCE_${kind}`);
  }
  if (
    new Set(input.legacyDependencies.map((dependency) => dependency.dependencyId)).size !==
    input.legacyDependencies.length
  )
    blockers.add('DUPLICATE_LEGACY_DEPENDENCY');
  if (input.legacyDependencies.length === 0) blockers.add('LEGACY_INVENTORY_EMPTY');
  if (input.legacyDependencies.some((dependency) => dependency.status === 'ACTIVE'))
    blockers.add('LEGACY_DEPENDENCY_ACTIVE');
  if (input.legacyDependencies.some((dependency) => dependency.status === 'UNKNOWN'))
    blockers.add('LEGACY_DEPENDENCY_UNKNOWN');
  if (
    input.legacyDependencies.some(
      (dependency) =>
        dependency.status === 'RETAINED_READ_ONLY' &&
        !['DATABASE', 'OBJECT_STORE'].includes(dependency.kind),
    )
  )
    blockers.add('INVALID_READ_ONLY_RETENTION');
  if (input.unresolvedCriticalOrHigh) blockers.add('UNRESOLVED_CRITICAL_HIGH');
  return {
    formatVersion: 1,
    releaseCommit: input.releaseCommit,
    disposition: blockers.size ? 'HOLD' : 'READY_FOR_OWNER_REVIEW',
    productionAuthorized: false,
    retirementAuthorized: false,
    blockers: [...blockers].sort(),
  };
}
