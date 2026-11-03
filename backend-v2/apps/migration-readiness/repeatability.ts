import { reconcileManifest, rehearsalSchema, type RehearsalInput } from './reconciliation.js';

export interface RepeatabilityReport {
  readonly formatVersion: 1;
  readonly baselineRunId: string;
  readonly rerunId: string;
  readonly disposition: 'REPEATABLE' | 'HOLD';
  readonly productionAuthorized: false;
  readonly counts: {
    baselineSources: number;
    rerunSources: number;
    baselineTargets: number;
    rerunTargets: number;
  };
  readonly failures: readonly { code: string; count: number }[];
}

const sourceKey = (key: RehearsalInput['sources'][number]['key']): string =>
  JSON.stringify([key.system, key.type, key.id]);
const targetKey = (key: RehearsalInput['targets'][number]['key']): string =>
  JSON.stringify([key.type, key.id]);

/** Compare independently captured runs of the SAME export and transform, never a final delta. */
export function compareRehearsals(
  baselineValue: unknown,
  rerunValue: unknown,
): RepeatabilityReport {
  const baseline = rehearsalSchema.parse(baselineValue);
  const rerun = rehearsalSchema.parse(rerunValue);
  const failures = new Map<string, number>();
  const fail = (code: string, count = 1): void => {
    failures.set(code, (failures.get(code) ?? 0) + count);
  };
  for (const [label, input] of [
    ['BASELINE', baseline],
    ['RERUN', rerun],
  ] as const) {
    for (const failure of reconcileManifest(input).failures)
      fail(`${label}_${failure.code}`, failure.count);
  }
  if (baseline.runId === rerun.runId) fail('DISTINCT_RUN_REQUIRED');
  if (baseline.exportSha256 !== rerun.exportSha256) fail('EXPORT_CHANGED');
  if (baseline.transformVersion !== rerun.transformVersion) fail('TRANSFORM_CHANGED');

  const compare = <T>(
    before: readonly T[],
    after: readonly T[],
    key: (row: T) => string,
    signature: (row: T) => string,
    code: string,
  ): void => {
    const left = new Map(before.map((row) => [key(row), signature(row)]));
    const right = new Map(after.map((row) => [key(row), signature(row)]));
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      if (left.get(id) !== right.get(id)) fail(code);
    }
  };
  compare(
    baseline.sourceCounts,
    rerun.sourceCounts,
    (row) => JSON.stringify([row.system, row.type]),
    (row) => JSON.stringify(row),
    'SOURCE_COUNTS_CHANGED',
  );
  compare(
    baseline.sources,
    rerun.sources,
    (row) => sourceKey(row.key),
    (row) => JSON.stringify(row),
    'SOURCE_CHANGED',
  );
  compare(
    baseline.ledger,
    rerun.ledger,
    (row) => sourceKey(row.source),
    (row) => JSON.stringify(row),
    'LEDGER_CHANGED',
  );
  compare(
    baseline.targets,
    rerun.targets,
    (row) => targetKey(row.key),
    (row) => JSON.stringify({ ...row, parents: row.parents.map(targetKey).sort() }),
    'TARGET_CHANGED',
  );
  return {
    formatVersion: 1,
    baselineRunId: baseline.runId,
    rerunId: rerun.runId,
    disposition: failures.size ? 'HOLD' : 'REPEATABLE',
    productionAuthorized: false,
    counts: {
      baselineSources: baseline.sources.length,
      rerunSources: rerun.sources.length,
      baselineTargets: baseline.targets.length,
      rerunTargets: rerun.targets.length,
    },
    failures: [...failures]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, count]) => ({ code, count })),
  };
}
