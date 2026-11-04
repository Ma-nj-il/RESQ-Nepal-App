import { z } from 'zod';

import {
  reconcileManifest,
  rehearsalSchema,
  type ReconciliationReport,
  type RehearsalInput,
} from './reconciliation.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

export const partitionSetSchema = z
  .object({
    formatVersion: z.literal(1),
    setId: id,
    transformVersion: id,
    exportSha256: hash,
    partitions: z
      .array(z.object({ partitionId: id, runId: id, manifestSha256: hash }).strict())
      .min(1)
      .max(512),
  })
  .strict();

export type PartitionSet = z.infer<typeof partitionSetSchema>;
export interface SuppliedPartition {
  readonly partitionId: string;
  readonly manifestSha256: string;
  readonly value: unknown;
}
export interface PartitionReconciliationReport extends ReconciliationReport {
  readonly partitionSetId: string;
  readonly partitionCount: number;
}

/**
 * Reconciles bounded manifest files as one logical rehearsal. Combining before evaluation is
 * deliberate: duplicate identities, cross-partition parents, ownership and money must be checked
 * globally rather than accepted from independently valid shards.
 */
export function reconcilePartitionSet(
  indexValue: unknown,
  supplied: readonly SuppliedPartition[],
): PartitionReconciliationReport {
  const index = partitionSetSchema.parse(indexValue);
  const integrityFailures = new Map<string, number>();
  const fail = (code: string): void => {
    integrityFailures.set(code, (integrityFailures.get(code) ?? 0) + 1);
  };
  const expected = new Map(index.partitions.map((row) => [row.partitionId, row]));
  const expectedRuns = new Set(index.partitions.map((row) => row.runId));
  if (expected.size !== index.partitions.length) fail('DUPLICATE_PARTITION_ID');
  if (expectedRuns.size !== index.partitions.length) fail('DUPLICATE_PARTITION_RUN');

  const suppliedIds = new Set<string>();
  const manifests: RehearsalInput[] = [];
  for (const row of supplied) {
    if (suppliedIds.has(row.partitionId)) fail('DUPLICATE_SUPPLIED_PARTITION');
    suppliedIds.add(row.partitionId);
    const declaration = expected.get(row.partitionId);
    if (!declaration) {
      fail('UNDECLARED_PARTITION');
      continue;
    }
    if (declaration.manifestSha256 !== row.manifestSha256) fail('PARTITION_HASH_MISMATCH');
    const manifest = rehearsalSchema.parse(row.value);
    if (manifest.runId !== declaration.runId) fail('PARTITION_RUN_MISMATCH');
    if (manifest.transformVersion !== index.transformVersion) fail('PARTITION_TRANSFORM_MISMATCH');
    if (manifest.exportSha256 !== index.exportSha256) fail('PARTITION_EXPORT_MISMATCH');
    manifests.push(manifest);
  }
  for (const partitionId of expected.keys()) {
    if (!suppliedIds.has(partitionId)) fail('MISSING_PARTITION');
  }

  const sourceCounts = new Map<string, RehearsalInput['sourceCounts'][number]>();
  for (const manifest of manifests) {
    for (const row of manifest.sourceCounts) {
      const key = JSON.stringify([row.system, row.type]);
      const previous = sourceCounts.get(key);
      sourceCounts.set(key, { ...row, count: (previous?.count ?? 0) + row.count });
    }
  }
  const combined: RehearsalInput = {
    formatVersion: 1,
    runId: index.setId,
    transformVersion: index.transformVersion,
    exportSha256: index.exportSha256,
    sourceCounts: [...sourceCounts.values()],
    sources: manifests.flatMap((manifest) => manifest.sources),
    ledger: manifests.flatMap((manifest) => manifest.ledger),
    targets: manifests.flatMap((manifest) => manifest.targets),
  };
  const reconciliation = reconcileManifest(combined);
  const failures = new Map(reconciliation.failures.map((row) => [row.code, row.count]));
  for (const [code, count] of integrityFailures)
    failures.set(code, (failures.get(code) ?? 0) + count);
  const reportedFailures = [...failures]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => ({ code, count }));
  return {
    ...reconciliation,
    disposition: reportedFailures.length ? 'HOLD' : 'RECONCILED',
    failures: reportedFailures,
    partitionSetId: index.setId,
    partitionCount: index.partitions.length,
  };
}
