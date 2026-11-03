import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';

import { evaluateCutover } from './cutover.js';
import { reconcileManifest } from './reconciliation.js';

async function main(): Promise<void> {
  const [mode, inputPath, outputPath, ...extra] = process.argv.slice(2);
  if (!['reconcile', 'cutover'].includes(mode ?? '') || !inputPath || !outputPath || extra.length) {
    throw new Error('Usage: npm run readiness -- <reconcile|cutover> INPUT.json NEW_REPORT.json');
  }
  const metadata = await stat(inputPath);
  if (!metadata.isFile() || metadata.size > 64 * 1024 * 1024)
    throw new Error('Input must be a file of at most 64 MiB.');
  const bytes = await readFile(inputPath);
  const input: unknown = JSON.parse(bytes.toString('utf8'));
  const report = mode === 'reconcile' ? reconcileManifest(input) : evaluateCutover(input);
  const output = { ...report, inputSha256: createHash('sha256').update(bytes).digest('hex') };
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
