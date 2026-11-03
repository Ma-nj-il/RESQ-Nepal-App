import { createHash } from 'node:crypto';

import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const entityType = z.enum([
  'PRINCIPAL',
  'TENANT',
  'FACILITY',
  'DRIVER',
  'AMBULANCE',
  'BOOKING',
  'TRIP',
  'CASH',
  'RATING',
  'SUPPORT',
  'NOTIFICATION',
  'DOCUMENT',
]);
const sourceKey = z.object({ system: id, type: entityType, id }).strict();
const targetKey = z.object({ type: entityType, id: z.uuid() }).strict();
const amount = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountMinor: z.string().regex(/^(0|[1-9][0-9]{0,30})$/),
  })
  .strict();
const scope = { tenantId: z.uuid().nullable(), facilityId: z.uuid().nullable() };

export const rehearsalSchema = z
  .object({
    formatVersion: z.literal(1),
    runId: id,
    transformVersion: id,
    exportSha256: hash,
    sourceCounts: z
      .array(
        z.object({ system: id, type: entityType, count: z.number().int().nonnegative() }).strict(),
      )
      .min(1),
    sources: z.array(z.object({ key: sourceKey, sha256: hash, money: amount.optional() }).strict()),
    ledger: z.array(
      z
        .object({
          source: sourceKey,
          sourceSha256: hash,
          outcome: z.enum(['MIGRATED', 'MERGED', 'SKIPPED_BY_POLICY', 'QUARANTINED']),
          target: targetKey.optional(),
          targetSha256: hash.optional(),
          ...scope,
          reasonCode: id.optional(),
          reviewRef: id.optional(),
          owner: id.optional(),
        })
        .strict(),
    ),
    targets: z.array(
      z
        .object({
          key: targetKey,
          sha256: hash,
          ...scope,
          parents: z.array(targetKey),
          money: amount.optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type RehearsalInput = z.infer<typeof rehearsalSchema>;

export interface ReconciliationReport {
  readonly formatVersion: 1;
  readonly runId: string;
  readonly disposition: 'RECONCILED' | 'HOLD';
  readonly productionAuthorized: false;
  readonly counts: {
    sources: number;
    targets: number;
    migrated: number;
    merged: number;
    skipped: number;
    quarantined: number;
  };
  readonly failures: readonly { code: string; count: number }[];
}

const keyOf = (value: unknown): string => JSON.stringify(value);

/** Stable namespace/type/source mapping, without auto-merging identities or tenants. */
export function deterministicTargetId(
  namespace: string,
  source: RehearsalInput['sources'][number]['key'],
): string {
  const bytes = createHash('sha256')
    .update(JSON.stringify([namespace, source.system, source.type, source.id]))
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/** Offline manifest reconciliation. No raw PII/credentials, database or provider access. */
export function reconcileManifest(value: unknown): ReconciliationReport {
  const input = rehearsalSchema.parse(value);
  const failures = new Map<string, number>();
  const fail = (code: string): void => {
    failures.set(code, (failures.get(code) ?? 0) + 1);
  };
  const sources = new Map(input.sources.map((row) => [keyOf(row.key), row]));
  const targets = new Map(input.targets.map((row) => [keyOf(row.key), row]));
  if (sources.size !== input.sources.length) fail('DUPLICATE_SOURCE');
  if (targets.size !== input.targets.length) fail('DUPLICATE_TARGET');
  const declaredCounts = new Map(
    input.sourceCounts.map((row) => [keyOf([row.system, row.type]), row.count]),
  );
  if (declaredCounts.size !== input.sourceCounts.length) fail('DUPLICATE_SOURCE_COUNT');
  const actualCounts = new Map<string, number>();
  for (const row of input.sources) {
    const key = keyOf([row.key.system, row.key.type]);
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
  }
  for (const key of new Set([...actualCounts.keys(), ...declaredCounts.keys()])) {
    if (!declaredCounts.has(key) || declaredCounts.get(key) !== (actualCounts.get(key) ?? 0))
      fail('SOURCE_COUNT_MISMATCH');
  }
  const accounted = new Set<string>();
  const referenced = new Map<string, { count: number; mergedOnly: boolean }>();
  const expectedMoney = new Map<string, bigint>();
  const actualMoney = new Map<string, bigint>();
  const addMoney = (
    map: Map<string, bigint>,
    target: string,
    tenantId: string | null,
    money: z.infer<typeof amount>,
  ): void => {
    const key = keyOf([target, tenantId, money.currency]);
    map.set(key, (map.get(key) ?? 0n) + BigInt(money.amountMinor));
  };
  const counts = {
    sources: input.sources.length,
    targets: input.targets.length,
    migrated: 0,
    merged: 0,
    skipped: 0,
    quarantined: 0,
  };
  for (const row of input.ledger) {
    const key = keyOf(row.source);
    if (accounted.has(key)) fail('DUPLICATE_LEDGER_SOURCE');
    accounted.add(key);
    const source = sources.get(key);
    if (!source || source.sha256 !== row.sourceSha256) fail('SOURCE_HASH_MISMATCH');
    if (row.outcome === 'SKIPPED_BY_POLICY' || row.outcome === 'QUARANTINED') {
      counts[row.outcome === 'QUARANTINED' ? 'quarantined' : 'skipped']++;
      if (!row.owner || !row.reasonCode || !row.reviewRef) fail('UNREVIEWED_EXCEPTION');
      if (row.target || row.targetSha256) fail('EXCLUDED_ROW_HAS_TARGET');
      continue;
    }
    counts[row.outcome === 'MIGRATED' ? 'migrated' : 'merged']++;
    if (row.outcome === 'MERGED' && (!row.owner || !row.reasonCode || !row.reviewRef))
      fail('UNREVIEWED_MERGE');
    if (!row.target || !row.targetSha256) {
      fail('MISSING_TARGET_MAP');
      continue;
    }
    const targetKey = keyOf(row.target);
    const previous = referenced.get(targetKey);
    referenced.set(targetKey, {
      count: (previous?.count ?? 0) + 1,
      mergedOnly: (previous?.mergedOnly ?? true) && row.outcome === 'MERGED',
    });
    const target = targets.get(targetKey);
    if (!target || target.sha256 !== row.targetSha256 || target.key.type !== row.source.type)
      fail('TARGET_HASH_OR_TYPE_MISMATCH');
    if (target && (target.tenantId !== row.tenantId || target.facilityId !== row.facilityId))
      fail('TARGET_OWNERSHIP_MISMATCH');
    if (source?.money) addMoney(expectedMoney, targetKey, row.tenantId, source.money);
  }
  for (const key of sources.keys()) if (!accounted.has(key)) fail('UNACCOUNTED_SOURCE');
  for (const row of input.targets) {
    const key = keyOf(row.key);
    if (!referenced.has(key)) fail('UNMAPPED_TARGET');
    const mappings = referenced.get(key);
    if (mappings && mappings.count > 1 && !mappings.mergedOnly) fail('UNAPPROVED_TARGET_COLLISION');
    if (row.facilityId && !row.tenantId) fail('FACILITY_WITHOUT_TENANT');
    if (
      ['FACILITY', 'DRIVER', 'AMBULANCE', 'TRIP', 'CASH', 'DOCUMENT'].includes(row.key.type) &&
      !row.tenantId
    )
      fail('TENANT_REQUIRED');
    if (['DRIVER', 'AMBULANCE', 'TRIP', 'CASH'].includes(row.key.type) && !row.facilityId)
      fail('FACILITY_REQUIRED');
    if (row.tenantId && !targets.has(keyOf({ type: 'TENANT', id: row.tenantId })))
      fail('ORPHAN_TENANT');
    if (row.facilityId) {
      const facility = targets.get(keyOf({ type: 'FACILITY', id: row.facilityId }));
      if (!facility || facility.tenantId !== row.tenantId) fail('ORPHAN_OR_CROSS_TENANT_FACILITY');
    }
    for (const parentKey of row.parents) {
      const parent = targets.get(keyOf(parentKey));
      if (!parent) fail('ORPHAN_PARENT');
      else if (row.tenantId && parent.tenantId && parent.tenantId !== row.tenantId)
        fail('CROSS_TENANT_PARENT');
    }
    if (row.money) addMoney(actualMoney, key, row.tenantId, row.money);
  }
  for (const key of new Set([...expectedMoney.keys(), ...actualMoney.keys()])) {
    if ((expectedMoney.get(key) ?? 0n) !== (actualMoney.get(key) ?? 0n)) fail('MONEY_MISMATCH');
  }
  return {
    formatVersion: 1,
    runId: input.runId,
    disposition: failures.size ? 'HOLD' : 'RECONCILED',
    productionAuthorized: false,
    counts,
    failures: [...failures]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, count]) => ({ code, count })),
  };
}
