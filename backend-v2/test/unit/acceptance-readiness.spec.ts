import {
  evaluatePhase6Acceptance,
  phase6AcceptanceSchema,
  requiredPhase6Evidence,
  requiredPhase6Personas,
  requiredPhase6Providers,
  type Phase6AcceptanceInput,
} from '../../apps/migration-readiness/phase-6-acceptance.js';
import {
  evaluateMigrationAcceptance,
  migrationAcceptanceSchema,
  requiredMigrationEvidence,
  type MigrationAcceptanceInput,
} from '../../apps/migration-readiness/migration-acceptance.js';
import {
  evaluateRetirement,
  requiredRetirementEvidence,
  retirementSchema,
  type RetirementInput,
} from '../../apps/migration-readiness/retirement.js';

const hash = 'a'.repeat(64);
const releaseCommit = 'b'.repeat(40);
const evaluatedAt = '2026-11-03T10:00:00Z';
const validUntil = '2026-11-04T10:00:00Z';
const now = new Date(evaluatedAt);
const accepted = { status: 'PASS' as const, artifactSha256: hash, owner: 'test-owner', validUntil };

function item<T>(items: readonly T[], index = 0): T {
  const value = items[index];
  if (value === undefined) throw new Error('Missing synthetic fixture item');
  return value;
}

function phase6Fixture(): Phase6AcceptanceInput {
  return {
    formatVersion: 1,
    releaseCommit,
    evaluatedAt,
    evidence: requiredPhase6Evidence.map((kind) => ({ kind, ...accepted })),
    personas: requiredPhase6Personas.map((persona) => ({ persona, ...accepted })),
    providers: requiredPhase6Providers.map((provider) => ({ provider, ...accepted })),
    unresolvedCriticalOrHigh: 0,
  };
}

describe('Phase 6 acceptance readiness', () => {
  it('requires owner review and never approves the gate or production', () => {
    expect(evaluatePhase6Acceptance(phase6Fixture(), now)).toEqual({
      formatVersion: 1,
      releaseCommit,
      disposition: 'READY_FOR_OWNER_REVIEW',
      gateApproved: false,
      productionAuthorized: false,
      blockers: [],
    });
  });

  it.each(requiredPhase6Evidence)('holds without %s evidence', (kind) => {
    const input = phase6Fixture();
    input.evidence = input.evidence.filter((row) => row.kind !== kind);
    expect(evaluatePhase6Acceptance(input, now).blockers).toContain(`EVIDENCE_${kind}`);
  });

  it.each(requiredPhase6Personas)('holds without %s persona acceptance', (persona) => {
    const input = phase6Fixture();
    input.personas = input.personas.filter((row) => row.persona !== persona);
    expect(evaluatePhase6Acceptance(input, now).blockers).toContain(`PERSONA_${persona}`);
  });

  it.each(requiredPhase6Providers)('holds without %s provider acceptance', (provider) => {
    const input = phase6Fixture();
    input.providers = input.providers.filter((row) => row.provider !== provider);
    expect(evaluatePhase6Acceptance(input, now).blockers).toContain(`PROVIDER_${provider}`);
  });

  it('holds on duplicate, expired, failed, stale or unresolved evidence', () => {
    const input = phase6Fixture();
    input.evidence.push({ ...item(input.evidence) });
    item(input.personas).status = 'FAIL';
    item(input.providers).validUntil = evaluatedAt;
    input.unresolvedCriticalOrHigh = 1;
    expect(evaluatePhase6Acceptance(input, new Date('2026-11-03T12:00:00Z')).blockers).toEqual(
      expect.arrayContaining([
        'STALE_EVALUATION',
        `EVIDENCE_${requiredPhase6Evidence[0]}`,
        `PERSONA_${requiredPhase6Personas[0]}`,
        `PROVIDER_${requiredPhase6Providers[0]}`,
        'UNRESOLVED_CRITICAL_HIGH',
      ]),
    );
  });

  it('strictly rejects credential-bearing fields', () => {
    expect(
      phase6AcceptanceSchema.safeParse({ ...phase6Fixture(), accessToken: 'forbidden' }).success,
    ).toBe(false);
  });
});

function migrationFixture(): MigrationAcceptanceInput {
  return {
    formatVersion: 1,
    evaluatedAt,
    transformVersion: 'approved-v1',
    finalReconciliationReportSha256: hash,
    evidence: requiredMigrationEvidence.map((kind) => ({ kind, ...accepted })),
    rehearsalRuns: [
      {
        runId: 'full-volume-1',
        reportSha256: hash,
        completedAt: '2026-11-03T08:00:00Z',
        fullVolume: true,
        status: 'PASS',
      },
      {
        runId: 'full-volume-2',
        reportSha256: 'c'.repeat(64),
        completedAt: '2026-11-03T09:00:00Z',
        fullVolume: true,
        status: 'PASS',
      },
    ],
    zeroTolerance: {
      unaccountedSources: 0,
      orphanOrCrossTenantReferences: 0,
      duplicateOrOverlappingAssignments: 0,
      invalidLifecycleSequences: 0,
      unauthorizedReads: 0,
      monetaryReconciliationFailures: 0,
      restrictedObjectFailures: 0,
      undocumentedIdentityOutcomes: 0,
      auditOutboxInboxFailures: 0,
      applicationRoleMigrationBypasses: 0,
      unreviewedExceptions: 0,
    },
    unresolvedCriticalOrHigh: 0,
  };
}

describe('Gate 7 migration acceptance readiness', () => {
  it('requires owner review and never approves Gate 7 or production', () => {
    expect(evaluateMigrationAcceptance(migrationFixture(), now)).toEqual({
      formatVersion: 1,
      transformVersion: 'approved-v1',
      disposition: 'READY_FOR_OWNER_REVIEW',
      gateApproved: false,
      productionAuthorized: false,
      blockers: [],
    });
  });

  it.each(requiredMigrationEvidence)('holds without %s evidence', (kind) => {
    const input = migrationFixture();
    input.evidence = input.evidence.filter((row) => row.kind !== kind);
    expect(evaluateMigrationAcceptance(input, now).blockers).toContain(`EVIDENCE_${kind}`);
  });

  it('requires two distinct completed passing full-volume rehearsals', () => {
    const duplicate = migrationFixture();
    item(duplicate.rehearsalRuns, 1).runId = item(duplicate.rehearsalRuns).runId;
    item(duplicate.rehearsalRuns, 1).reportSha256 = item(duplicate.rehearsalRuns).reportSha256;
    item(duplicate.rehearsalRuns, 1).fullVolume = false;
    item(duplicate.rehearsalRuns, 1).status = 'FAIL';
    item(duplicate.rehearsalRuns, 1).completedAt = '2026-11-03T11:00:00Z';
    expect(evaluateMigrationAcceptance(duplicate, now).blockers).toEqual(
      expect.arrayContaining([
        'DUPLICATE_REHEARSAL_RUN',
        'DUPLICATE_REHEARSAL_REPORT',
        'REHEARSAL_NOT_ACCEPTABLE',
      ]),
    );
  });

  it('turns every nonzero zero-tolerance metric and unresolved issue into a blocker', () => {
    const input = migrationFixture();
    for (const key of Object.keys(input.zeroTolerance) as (keyof typeof input.zeroTolerance)[])
      input.zeroTolerance[key] = 1;
    input.unresolvedCriticalOrHigh = 1;
    const report = evaluateMigrationAcceptance(input, now);
    expect(report.disposition).toBe('HOLD');
    expect(report.blockers).toHaveLength(Object.keys(input.zeroTolerance).length + 1);
    expect(report.blockers).toContain('ZERO_TOLERANCE_UNAUTHORIZED_READS');
    expect(report.blockers).toContain('UNRESOLVED_CRITICAL_HIGH');
  });

  it('strictly rejects raw source or credential fields', () => {
    expect(
      migrationAcceptanceSchema.safeParse({ ...migrationFixture(), sourceRows: [] }).success,
    ).toBe(false);
  });
});

function retirementFixture(): RetirementInput {
  return {
    formatVersion: 1,
    releaseCommit,
    stabilizationReportSha256: hash,
    evaluatedAt,
    evidence: requiredRetirementEvidence.map((kind) => ({ kind, ...accepted })),
    legacyDependencies: [
      {
        dependencyId: 'legacy-database',
        kind: 'DATABASE',
        status: 'RETAINED_READ_ONLY',
        artifactSha256: hash,
        owner: 'test-owner',
      },
      {
        dependencyId: 'legacy-client-key',
        kind: 'CREDENTIAL_OR_KEY',
        status: 'RETIRED',
        artifactSha256: hash,
        owner: 'test-owner',
      },
    ],
    unresolvedCriticalOrHigh: 0,
  };
}

describe('legacy retirement readiness', () => {
  it('requires owner review and never authorizes production or destructive retirement', () => {
    expect(evaluateRetirement(retirementFixture(), now)).toEqual({
      formatVersion: 1,
      releaseCommit,
      disposition: 'READY_FOR_OWNER_REVIEW',
      productionAuthorized: false,
      retirementAuthorized: false,
      blockers: [],
    });
  });

  it.each(requiredRetirementEvidence)('holds without %s evidence', (kind) => {
    const input = retirementFixture();
    input.evidence = input.evidence.filter((row) => row.kind !== kind);
    expect(evaluateRetirement(input, now).blockers).toContain(`EVIDENCE_${kind}`);
  });

  it('holds on empty, duplicate, active, unknown or unresolved legacy inventory', () => {
    const empty = retirementFixture();
    empty.legacyDependencies = [];
    expect(evaluateRetirement(empty, now).blockers).toContain('LEGACY_INVENTORY_EMPTY');

    const input = retirementFixture();
    input.legacyDependencies.push({ ...item(input.legacyDependencies), status: 'ACTIVE' });
    item(input.legacyDependencies, 1).status = 'RETAINED_READ_ONLY';
    input.legacyDependencies.push({
      ...item(input.legacyDependencies, 1),
      dependencyId: 'legacy-unknown',
      status: 'UNKNOWN',
    });
    input.unresolvedCriticalOrHigh = 1;
    expect(evaluateRetirement(input, now).blockers).toEqual(
      expect.arrayContaining([
        'DUPLICATE_LEGACY_DEPENDENCY',
        'LEGACY_DEPENDENCY_ACTIVE',
        'LEGACY_DEPENDENCY_UNKNOWN',
        'INVALID_READ_ONLY_RETENTION',
        'UNRESOLVED_CRITICAL_HIGH',
      ]),
    );
  });

  it('strictly rejects destructive instructions and credentials', () => {
    expect(
      retirementSchema.safeParse({ ...retirementFixture(), deleteCommand: 'forbidden' }).success,
    ).toBe(false);
  });
});
