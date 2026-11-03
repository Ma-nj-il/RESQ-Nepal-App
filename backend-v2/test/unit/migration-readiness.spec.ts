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
