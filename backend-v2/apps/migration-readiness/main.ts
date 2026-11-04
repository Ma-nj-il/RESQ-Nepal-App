import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { evaluateCutover } from './cutover.js';
import { reconcileManifest } from './reconciliation.js';
import { compareRehearsals } from './repeatability.js';
import { partitionSetSchema, reconcilePartitionSet } from './partitions.js';
import { evaluateStabilization } from './stabilization.js';
import { evaluatePhase6Acceptance } from './phase-6-acceptance.js';
import { evaluateMigrationAcceptance } from './migration-acceptance.js';
import { evaluateRetirement } from './retirement.js';

async function readInput(inputPath: string): Promise<{ input: unknown; sha256: string }> {
  const metadata = await stat(inputPath);
  if (!metadata.isFile() || metadata.size > 64 * 1024 * 1024)
    throw new Error('Input must be a file of at most 64 MiB.');
  const bytes = await readFile(inputPath);
  const input: unknown = JSON.parse(bytes.toString('utf8'));
  return { input, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function main(): Promise<void> {
  const [mode, inputPath, thirdPath, fourthPath, ...extra] = process.argv.slice(2);
  const comparing = mode === 'compare';
  const partitioning = mode === 'partitions';
  if (
    ![
      'reconcile',
      'cutover',
      'compare',
      'partitions',
      'stabilization',
      'phase6-acceptance',
      'migration-acceptance',
      'retirement',
    ].includes(mode ?? '') ||
    !inputPath ||
    !thirdPath ||
    (comparing || partitioning ? !fourthPath : fourthPath !== undefined) ||
    extra.length
  ) {
    throw new Error('Invalid readiness arguments');
  }
  const baseline = await readInput(inputPath);
  const rerun = comparing ? await readInput(thirdPath) : undefined;
  const partitionInputs = [];
  if (partitioning) {
    const directory = await stat(thirdPath);
    if (!directory.isDirectory()) throw new Error('Partition location must be a directory');
    const index = partitionSetSchema.parse(baseline.input);
    for (const partition of index.partitions) {
      const manifest = await readInput(join(thirdPath, `${partition.partitionId}.json`));
      partitionInputs.push({
        partitionId: partition.partitionId,
        manifestSha256: manifest.sha256,
        value: manifest.input,
      });
    }
  }
  let report;
  if (rerun) report = compareRehearsals(baseline.input, rerun.input);
  else if (partitioning) report = reconcilePartitionSet(baseline.input, partitionInputs);
  else if (mode === 'reconcile') report = reconcileManifest(baseline.input);
  else if (mode === 'cutover') report = evaluateCutover(baseline.input);
  else if (mode === 'stabilization') report = evaluateStabilization(baseline.input);
  else if (mode === 'phase6-acceptance') report = evaluatePhase6Acceptance(baseline.input);
  else if (mode === 'migration-acceptance') report = evaluateMigrationAcceptance(baseline.input);
  else report = evaluateRetirement(baseline.input);
  const output = {
    ...report,
    ...(rerun
      ? { baselineInputSha256: baseline.sha256, rerunInputSha256: rerun.sha256 }
      : partitioning
        ? {
            indexInputSha256: baseline.sha256,
            partitionInputSha256: partitionInputs.map((row) => row.manifestSha256),
          }
        : { inputSha256: baseline.sha256 }),
  };
  const outputPath = comparing || partitioning ? fourthPath : thirdPath;
  if (!outputPath) throw new Error('An unused output path is required');
  // Exclusive creation prevents replacing a source manifest or an earlier signed report.
  const file = await open(outputPath, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await file.close();
  }
  console.info(`${report.disposition}; productionAuthorized=false`);
  if (report.disposition === 'HOLD') process.exitCode = 2;
}

void main().catch(() => {
  // Never echo input values, file paths, credentials or schema errors from restricted manifests.
  console.error(
    'Readiness check failed. Verify the mode, strict input schema, file size and unused output path.',
  );
  process.exitCode = 1;
});
