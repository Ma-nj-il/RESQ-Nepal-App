import {
  type cutoverSchema,
  evaluateCutover,
  requiredEvidence,
} from '../../apps/migration-readiness/cutover.js';
import {
  deterministicTargetId,
  reconcileManifest,
  rehearsalSchema,
  type RehearsalInput,
} from '../../apps/migration-readiness/reconciliation.js';
import { compareRehearsals } from '../../apps/migration-readiness/repeatability.js';
import {
  reconcilePartitionSet,
  type PartitionSet,
} from '../../apps/migration-readiness/partitions.js';
import {
  evaluateStabilization,
  requiredStabilizationEvidence,
  stabilizationSchema,
  type StabilizationInput,
} from '../../apps/migration-readiness/stabilization.js';

const hash = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);
const targetId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const sourceKey = { system: 'supabase', type: 'PRINCIPAL' as const, id: 'synthetic-1' };
const targetKey = { type: 'PRINCIPAL' as const, id: targetId };

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('Missing synthetic fixture row');
  return item;
}

function fixture(): RehearsalInput {
  return {
    formatVersion: 1,
    runId: 'synthetic-rehearsal',
    transformVersion: 'review-v1',
    exportSha256: hash,
    sourceCounts: [{ system: 'supabase', type: 'PRINCIPAL', count: 1 }],
    sources: [{ key: sourceKey, sha256: hash }],
    ledger: [
      {
        source: sourceKey,
        sourceSha256: hash,
        outcome: 'MIGRATED',
        target: targetKey,
        targetSha256: otherHash,
        tenantId: null,
        facilityId: null,
      },
    ],
    targets: [{ key: targetKey, sha256: otherHash, tenantId: null, facilityId: null, parents: [] }],
  };
}

describe('offline migration manifest reconciliation', () => {
  it('accounts for every row and produces deterministic non-authorizing reports', () => {
    const report = reconcileManifest(fixture());
    expect(report.disposition).toBe('RECONCILED');
    expect(report.productionAuthorized).toBe(false);
    expect(reconcileManifest(fixture())).toEqual(report);
    expect(deterministicTargetId('approved-namespace', sourceKey)).toBe(
      deterministicTargetId('approved-namespace', { ...sourceKey }),
    );
    expect(deterministicTargetId('approved-namespace', sourceKey)).not.toBe(
      deterministicTargetId('another-namespace', sourceKey),
    );
    expect(deterministicTargetId('approved-namespace', sourceKey)).not.toBe(
      deterministicTargetId('approved-namespace', { ...sourceKey, system: 'go' }),
    );
  });

  it.each([
    'unaccounted',
    'duplicate',
    'hash',
    'count',
    'unmapped',
    'parent',
    'ownership',
  ] as const)('holds on %s corruption', (kind) => {
    const input = fixture();
    switch (kind) {
      case 'unaccounted':
        input.ledger = [];
        break;
      case 'duplicate':
        input.ledger.push({ ...first(input.ledger) });
        break;
      case 'hash':
        first(input.ledger).sourceSha256 = otherHash;
        break;
      case 'count':
        first(input.sourceCounts).count = 2;
        break;
      case 'unmapped':
        input.targets.push({ ...first(input.targets), key: { ...targetKey, id: otherId } });
        break;
      case 'parent':
        first(input.targets).parents.push({ ...targetKey, id: otherId });
        break;
      case 'ownership':
        first(input.targets).facilityId = otherId;
        break;
    }
    expect(reconcileManifest(input).disposition).toBe('HOLD');
  });

  it('rejects credential fields and unrecognized source types instead of copying them', () => {
    expect(rehearsalSchema.safeParse({ ...fixture(), refreshToken: 'forbidden' }).success).toBe(
      false,
    );
    const input = fixture();
    expect(
      rehearsalSchema.safeParse({
        ...input,
        sources: [{ ...input.sources[0], passwordHash: 'forbidden' }],
      }).success,
    ).toBe(false);
    expect(
      rehearsalSchema.safeParse({
        ...input,
        sources: [{ key: { ...sourceKey, type: 'MFA_SECRET' }, sha256: hash }],
      }).success,
    ).toBe(false);
  });

  it('requires reviewed exclusions and merges; source rows never disappear', () => {
    const input = fixture();
    input.ledger = [
      {
        source: sourceKey,
        sourceSha256: hash,
        outcome: 'QUARANTINED',
        tenantId: null,
        facilityId: null,
      },
    ];
    input.targets = [];
    expect(reconcileManifest(input).disposition).toBe('HOLD');
    Object.assign(first(input.ledger), {
      owner: 'data-owner',
      reasonCode: 'IDENTITY_COLLISION',
      reviewRef: 'review-17',
    });
    expect(reconcileManifest(input).counts.quarantined).toBe(1);
    expect(reconcileManifest(input).disposition).toBe('RECONCILED');
  });

  it('reconciles exact minor units beyond floating-point precision and rejects currency relabeling', () => {
    const input = fixture();
    first(input.sources).money = { currency: 'NPR', amountMinor: '9007199254740993' };
    first(input.targets).money = { currency: 'NPR', amountMinor: '9007199254740993' };
    expect(reconcileManifest(input).disposition).toBe('RECONCILED');
    first(input.targets).money = { currency: 'NPR', amountMinor: '9007199254740992' };
    expect(reconcileManifest(input).failures).toContainEqual({ code: 'MONEY_MISMATCH', count: 1 });
    first(input.targets).money = { currency: 'USD', amountMinor: '9007199254740993' };
    expect(reconcileManifest(input).failures).toContainEqual({ code: 'MONEY_MISMATCH', count: 2 });
  });
});

describe('independent migration rerun comparison', () => {
  const rerunOf = (baseline: RehearsalInput): RehearsalInput => ({
    ...structuredClone(baseline),
    runId: 'synthetic-rerun',
  });

  it('ignores enumeration order while preserving every mapping and parent relationship', () => {
    const baseline = fixture();
    baseline.sources.push({ key: { ...sourceKey, id: 'synthetic-2' }, sha256: hash });
    first(baseline.sourceCounts).count = 2;
    baseline.ledger.push({
      ...first(baseline.ledger),
      source: { ...sourceKey, id: 'synthetic-2' },
      target: { ...targetKey, id: otherId },
    });
    baseline.targets.push({
      ...first(baseline.targets),
      key: { ...targetKey, id: otherId },
      parents: [targetKey],
    });
    const rerun = rerunOf(baseline);
    rerun.sources.reverse();
    rerun.ledger.reverse();
    rerun.targets.reverse();
    expect(compareRehearsals(baseline, rerun)).toMatchObject({
      disposition: 'REPEATABLE',
      productionAuthorized: false,
      failures: [],
      counts: { baselineSources: 2, rerunSources: 2, baselineTargets: 2, rerunTargets: 2 },
    });
  });

  it('rejects identity drift even when both manifests reconcile individually', () => {
    const baseline = fixture(),
      rerun = rerunOf(baseline);
    first(rerun.ledger).target = { ...targetKey, id: otherId };
    first(rerun.targets).key = { ...targetKey, id: otherId };
    expect(reconcileManifest(rerun).disposition).toBe('RECONCILED');
    const report = compareRehearsals(baseline, rerun);
    expect(report.failures).toEqual(
      expect.arrayContaining([
        { code: 'LEDGER_CHANGED', count: 1 },
        { code: 'TARGET_CHANGED', count: 2 },
      ]),
    );
    expect(JSON.stringify(report)).not.toContain(sourceKey.id);
    expect(JSON.stringify(report)).not.toContain(targetId);
  });

  it('holds on changed source bytes, money or transform scope despite locally consistent results', () => {
    const baseline = fixture(),
      rerun = rerunOf(baseline);
    rerun.transformVersion = 'review-v2';
    rerun.exportSha256 = otherHash;
    first(rerun.sources).sha256 = otherHash;
    first(rerun.ledger).sourceSha256 = otherHash;
    first(rerun.sources).money = { currency: 'NPR', amountMinor: '9007199254740993' };
    first(rerun.targets).money = { currency: 'NPR', amountMinor: '9007199254740993' };
    expect(reconcileManifest(rerun).disposition).toBe('RECONCILED');
    expect(compareRehearsals(baseline, rerun).failures).toEqual(
      expect.arrayContaining([
        { code: 'SOURCE_CHANGED', count: 1 },
        { code: 'EXPORT_CHANGED', count: 1 },
        { code: 'TRANSFORM_CHANGED', count: 1 },
      ]),
    );
  });

  it('does not mistake two identically invalid manifests or a reused run ID for repeatability', () => {
    const baseline = fixture();
    expect(compareRehearsals(baseline, baseline).failures).toContainEqual({
      code: 'DISTINCT_RUN_REQUIRED',
      count: 1,
    });
    baseline.ledger = [];
    const report = compareRehearsals(baseline, rerunOf(baseline));
    expect(report.disposition).toBe('HOLD');
    expect(report.failures).toEqual(
      expect.arrayContaining([
        { code: 'BASELINE_UNACCOUNTED_SOURCE', count: 1 },
        { code: 'RERUN_UNACCOUNTED_SOURCE', count: 1 },
      ]),
    );
  });

  it('detects newly skipped rows and changed quarantine reviews without deleting their accounting', () => {
    const baseline = fixture();
    baseline.ledger = [
      {
        source: sourceKey,
        sourceSha256: hash,
        outcome: 'QUARANTINED',
        tenantId: null,
        facilityId: null,
        owner: 'data-owner',
        reasonCode: 'COLLISION',
        reviewRef: 'review-1',
      },
    ];
    baseline.targets = [];
    const rerun = rerunOf(baseline);
    first(rerun.ledger).outcome = 'SKIPPED_BY_POLICY';
    first(rerun.ledger).reviewRef = 'review-2';
    expect(reconcileManifest(rerun).disposition).toBe('RECONCILED');
    expect(compareRehearsals(baseline, rerun).failures).toEqual([
      { code: 'LEDGER_CHANGED', count: 1 },
    ]);
  });
});

describe('partition-set manifest reconciliation', () => {
  function partitionFixture(): {
    index: PartitionSet;
    partitions: { partitionId: string; manifestSha256: string; value: RehearsalInput }[];
  } {
    const sourcePartition = fixture();
    sourcePartition.runId = 'partition-source';
    sourcePartition.targets = [];
    const targetPartition = fixture();
    targetPartition.runId = 'partition-target';
    targetPartition.sourceCounts = [{ system: 'supabase', type: 'PRINCIPAL', count: 0 }];
    targetPartition.sources = [];
    targetPartition.ledger = [];
    return {
      index: {
        formatVersion: 1,
        setId: 'synthetic-partition-set',
        transformVersion: 'review-v1',
        exportSha256: hash,
        partitions: [
          { partitionId: 'source', runId: sourcePartition.runId, manifestSha256: hash },
          { partitionId: 'target', runId: targetPartition.runId, manifestSha256: otherHash },
        ],
      },
      partitions: [
        { partitionId: 'source', manifestSha256: hash, value: sourcePartition },
        { partitionId: 'target', manifestSha256: otherHash, value: targetPartition },
      ],
    };
  }

  it('checks maps and records globally instead of requiring self-contained shards', () => {
    const input = partitionFixture();
    expect(reconcileManifest(input.partitions[0]?.value).disposition).toBe('HOLD');
    expect(reconcileManifest(input.partitions[1]?.value).disposition).toBe('HOLD');
    expect(reconcilePartitionSet(input.index, input.partitions)).toMatchObject({
      disposition: 'RECONCILED',
      productionAuthorized: false,
      partitionSetId: input.index.setId,
      partitionCount: 2,
      failures: [],
    });
  });

  it('holds on missing, undeclared, duplicate or hash-drifted partitions', () => {
    const missing = partitionFixture();
    expect(
      reconcilePartitionSet(missing.index, missing.partitions.slice(0, 1)).failures,
    ).toContainEqual({
      code: 'MISSING_PARTITION',
      count: 1,
    });
    const corrupted = partitionFixture();
    const firstPartition = first(corrupted.partitions);
    firstPartition.manifestSha256 = otherHash;
    corrupted.partitions.push({ ...firstPartition });
    corrupted.partitions.push({ ...firstPartition, partitionId: 'undeclared' });
    expect(reconcilePartitionSet(corrupted.index, corrupted.partitions).failures).toEqual(
      expect.arrayContaining([
        { code: 'PARTITION_HASH_MISMATCH', count: 2 },
        { code: 'DUPLICATE_SUPPLIED_PARTITION', count: 1 },
        { code: 'UNDECLARED_PARTITION', count: 1 },
      ]),
    );
  });

  it('detects identities duplicated across otherwise separate files', () => {
    const input = partitionFixture();
    const duplicate = structuredClone(first(input.partitions));
    duplicate.partitionId = 'target';
    duplicate.manifestSha256 = otherHash;
    duplicate.value.runId = 'partition-target';
    input.partitions[1] = duplicate;
    expect(reconcilePartitionSet(input.index, input.partitions).failures).toEqual(
      expect.arrayContaining([
        { code: 'DUPLICATE_SOURCE', count: 1 },
        { code: 'DUPLICATE_LEDGER_SOURCE', count: 1 },
      ]),
    );
  });

  it('binds every partition to the approved export, transform and declared run', () => {
    const input = partitionFixture();
    const manifest = first(input.partitions).value;
    manifest.runId = 'changed-run';
    manifest.transformVersion = 'changed-transform';
    manifest.exportSha256 = otherHash;
    expect(reconcilePartitionSet(input.index, input.partitions).failures).toEqual(
      expect.arrayContaining([
        { code: 'PARTITION_RUN_MISMATCH', count: 1 },
        { code: 'PARTITION_TRANSFORM_MISMATCH', count: 1 },
        { code: 'PARTITION_EXPORT_MISMATCH', count: 1 },
      ]),
    );
  });
});

function cutoverFixture(): ReturnType<typeof cutoverSchema.parse> {
  return {
    formatVersion: 1,
    releaseCommit: 'a'.repeat(40),
    evaluatedAt: '2026-11-03T10:00:00Z',
    incidentCommander: 'test-commander',
    gates: Array.from({ length: 7 }, (_, index) => ({
      gate: index + 1,
      decision: 'APPROVED',
      owner: 'test-owner',
      artifactSha256: hash,
    })),
    evidence: requiredEvidence.map((kind) => ({
      kind,
      status: 'PASS',
      artifactSha256: hash,
      owner: 'test-owner',
      validUntil: '2026-11-04T10:00:00Z',
    })),
    requiredCohorts: [{ capability: 'booking', cohort: 'test-facility' }],
    writers: [
      {
        capability: 'booking',
        cohort: 'test-facility',
        writer: 'LEGACY',
        epoch: 1,
        boundary: '2026-11-03T09:00:00Z',
      },
    ],
    activeLegacyTrips: 0,
    unresolvedCriticalOrHigh: 0,
    targetAuthoritativeWrites: 0,
    rollbackMode: 'PRE_WRITE_ROUTING',
  };
}
const now = new Date('2026-11-03T10:00:00Z');

describe('cutover readiness evaluation', () => {
  it('never authorizes production, even with complete attested evidence', () => {
    expect(evaluateCutover(cutoverFixture(), now)).toMatchObject({
      disposition: 'READY_FOR_OWNER_REVIEW',
      productionAuthorized: false,
    });
  });
  it.each(requiredEvidence)('holds without %s evidence', (kind) => {
    const input = cutoverFixture();
    input.evidence = input.evidence.filter((row) => row.kind !== kind);
    expect(evaluateCutover(input, now).blockers).toContain(`EVIDENCE_${kind}`);
  });
  it('blocks split-brain, expired evidence, missing gates, active work and unsafe rollback', () => {
    const input = cutoverFixture();
    input.gates = [];
    input.writers.push({ ...first(input.writers), writer: 'TARGET' });
    input.activeLegacyTrips = 1;
    input.targetAuthoritativeWrites = 1;
    input.unresolvedCriticalOrHigh = 1;
    first(input.evidence).validUntil = '2026-11-02T00:00:00Z';
    expect(evaluateCutover(input, now).blockers).toEqual(
      expect.arrayContaining([
        'GATE_1_NOT_APPROVED',
        'ONE_WRITER_VIOLATION',
        'ACTIVE_LEGACY_WORK',
        'UNSAFE_POST_WRITE_ROLLBACK',
        'UNRESOLVED_CRITICAL_HIGH',
        'EVIDENCE_SECURITY_REVIEW',
      ]),
    );
  });
  it('refuses stale evaluation and undeclared writer cohorts', () => {
    const input = cutoverFixture();
    first(input.writers).cohort = 'undeclared';
    expect(evaluateCutover(input, new Date('2026-11-05T00:00:00Z')).blockers).toEqual(
      expect.arrayContaining(['STALE_EVALUATION', 'UNDECLARED_COHORT', 'ONE_WRITER_VIOLATION']),
    );
  });
});

function stabilizationFixture(): StabilizationInput {
  const health = {
    slo: 'PASS' as const,
    businessReconciliation: 'PASS' as const,
    security: 'PASS' as const,
    providers: 'PASS' as const,
    queuesAndEvents: 'PASS' as const,
    support: 'PASS' as const,
  };
  const checkpoint = (observedAt: string): StabilizationInput['checkpoints'][number] => ({
    observedAt,
    decision: 'GO',
    decisionOwner: 'test-commander',
    artifactSha256: hash,
    health: { ...health },
    openCriticalOrHigh: 0,
    authorizationBoundaryViolations: 0,
    duplicateActiveAssignments: 0,
    unaccountedBusinessRecords: 0,
    monetaryReconciliationFailures: 0,
    legacyAuthoritativeWrites: 0,
    failedDispatchOrSosCanaries: 0,
  });
  return {
    formatVersion: 1,
    releaseCommit: 'a'.repeat(40),
    cutoverReportSha256: hash,
    startedAt: '2026-11-03T08:00:00Z',
    evaluatedAt: '2026-11-03T10:00:00Z',
    approvedWindowMinutes: 120,
    maxCheckpointGapMinutes: 60,
    incidentCommander: 'test-commander',
    evidence: requiredStabilizationEvidence.map((kind) => ({
      kind,
      status: 'PASS',
      artifactSha256: hash,
      owner: 'test-owner',
      validUntil: '2026-11-04T10:00:00Z',
    })),
    checkpoints: [
      checkpoint('2026-11-03T08:30:00Z'),
      checkpoint('2026-11-03T09:30:00Z'),
      checkpoint('2026-11-03T10:00:00Z'),
    ],
  };
}

describe('post-cutover stabilization readiness evaluation', () => {
  it('requires owner review and never authorizes production or retirement', () => {
    expect(evaluateStabilization(stabilizationFixture(), now)).toEqual({
      formatVersion: 1,
      releaseCommit: 'a'.repeat(40),
      disposition: 'READY_FOR_OWNER_REVIEW',
      productionAuthorized: false,
      retirementAuthorized: false,
      blockers: [],
    });
  });

  it.each(requiredStabilizationEvidence)('holds without %s evidence', (kind) => {
    const input = stabilizationFixture();
    input.evidence = input.evidence.filter((row) => row.kind !== kind);
    expect(evaluateStabilization(input, now).blockers).toContain(`EVIDENCE_${kind}`);
  });

  it('holds on gaps, a short window, unsafe outcomes and non-go decisions', () => {
    const input = stabilizationFixture();
    input.approvedWindowMinutes = 121;
    input.maxCheckpointGapMinutes = 20;
    const checkpoint = first(input.checkpoints);
    checkpoint.decision = 'ROLLBACK';
    checkpoint.health.security = 'FAIL';
    checkpoint.openCriticalOrHigh = 1;
    checkpoint.authorizationBoundaryViolations = 1;
    checkpoint.duplicateActiveAssignments = 1;
    checkpoint.unaccountedBusinessRecords = 1;
    checkpoint.monetaryReconciliationFailures = 1;
    checkpoint.legacyAuthoritativeWrites = 1;
    checkpoint.failedDispatchOrSosCanaries = 1;
    expect(evaluateStabilization(input, now).blockers).toEqual(
      expect.arrayContaining([
        'STABILIZATION_WINDOW_INCOMPLETE',
        'CHECKPOINT_GAP',
        'NON_GO_DECISION',
        'HEALTH_CHECK_FAILURE',
        'OPEN_CRITICAL_HIGH',
        'AUTHORIZATION_BOUNDARY_VIOLATION',
        'DUPLICATE_ACTIVE_ASSIGNMENT',
        'UNACCOUNTED_BUSINESS_RECORD',
        'MONETARY_MISMATCH',
        'LEGACY_AUTHORITATIVE_WRITE',
        'FAILED_DISPATCH_SOS_CANARY',
      ]),
    );
  });

  it('rejects stale, out-of-order and out-of-window evidence', () => {
    const input = stabilizationFixture();
    first(input.checkpoints).observedAt = '2026-11-03T10:01:00Z';
    expect(evaluateStabilization(input, new Date('2026-11-03T12:00:00Z')).blockers).toEqual(
      expect.arrayContaining(['STALE_EVALUATION', 'CHECKPOINT_ORDER_OR_RANGE']),
    );
  });

  it('strictly rejects credential-like or unrecognized fields', () => {
    expect(
      stabilizationSchema.safeParse({ ...stabilizationFixture(), apiToken: 'forbidden' }).success,
    ).toBe(false);
  });
});
