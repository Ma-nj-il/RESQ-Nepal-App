import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';

import { evaluateCutover } from './cutover.js';
import { reconcileManifest } from './reconciliation.js';
import { compareRehearsals } from './repeatability.js';

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
  if (
    !['reconcile', 'cutover', 'compare'].includes(mode ?? '') ||
    !inputPath ||
    !thirdPath ||
    (comparing ? !fourthPath : fourthPath !== undefined) ||
    extra.length
  ) {
    throw new Error('Invalid readiness arguments');
  }
  const baseline = await readInput(inputPath);
  const rerun = comparing ? await readInput(thirdPath) : undefined;
  const report = rerun
    ? compareRehearsals(baseline.input, rerun.input)
    : mode === 'reconcile'
      ? reconcileManifest(baseline.input)
      : evaluateCutover(baseline.input);
  const output = {
    ...report,
    ...(rerun
      ? { baselineInputSha256: baseline.sha256, rerunInputSha256: rerun.sha256 }
      : { inputSha256: baseline.sha256 }),
  };
  const outputPath = comparing ? fourthPath : thirdPath;
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
