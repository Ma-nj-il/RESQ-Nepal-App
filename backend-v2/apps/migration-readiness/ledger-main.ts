import { open } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import {
  appendLedgerCheckpoint,
  initializeLedger,
  inspectLedger,
  ledgerAnchorSchema,
  readRestrictedFile,
  syncLedgerDirectory,
  type LedgerKeyring,
} from './encrypted-ledger.js';
import { compareRehearsals } from './repeatability.js';

const keyringSchema = z
  .object({
    activeVersion: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    keys: z
      .array(
        z
          .object({
            version: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
            keyBase64: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();

async function readKeyring(path: string): Promise<LedgerKeyring> {
  const bytes = await readRestrictedFile(path, 16384);
  try {
    const input = keyringSchema.parse(JSON.parse(bytes.toString('utf8')));
    const keys = new Map(
      input.keys.map((row) => [row.version, Buffer.from(row.keyBase64, 'base64')]),
    );
    if (
      keys.size !== input.keys.length ||
      !keys.has(input.activeVersion) ||
      input.keys.some((row) => keys.get(row.version)?.toString('base64') !== row.keyBase64)
    ) {
      throw new Error('Invalid keyring');
    }
    return { activeVersion: input.activeVersion, keys };
  } finally {
    bytes.fill(0);
  }
}
async function writeEvidence(path: string, value: unknown): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await syncLedgerDirectory(dirname(path));
}

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'init' && args.length === 2) {
    const [directory, output] = args as [string, string];
    await writeEvidence(output, await initializeLedger(directory));
    console.info('INITIALIZED; productionAuthorized=false');
    return;
  }
  if (mode === 'compare' && args.length === 6) {
    const [
      keyPath,
      baselineDirectory,
      baselineAnchorPath,
      rerunDirectory,
      rerunAnchorPath,
      output,
    ] = args as [string, string, string, string, string, string];
    const keyring = await readKeyring(keyPath);
    try {
      const baselineAnchor = ledgerAnchorSchema.parse(
        JSON.parse((await readRestrictedFile(baselineAnchorPath, 4096)).toString('utf8')),
      );
      const rerunAnchor = ledgerAnchorSchema.parse(
        JSON.parse((await readRestrictedFile(rerunAnchorPath, 4096)).toString('utf8')),
      );
      const baseline = await inspectLedger(baselineDirectory, baselineAnchor, keyring);
      const rerun = await inspectLedger(rerunDirectory, rerunAnchor, keyring);
      if (baseline.advanced || rerun.advanced || !baseline.latest || !rerun.latest)
        throw new Error('Inspect both ledger heads first');
      const report = compareRehearsals(baseline.latest, rerun.latest);
      await writeEvidence(output, {
        ...report,
        baselineHeadSha256: baseline.anchor.headSha256,
        rerunHeadSha256: rerun.anchor.headSha256,
      });
      console.info(`${report.disposition}; productionAuthorized=false`);
      if (report.disposition === 'HOLD') process.exitCode = 2;
    } finally {
      for (const key of keyring.keys.values()) key.fill(0);
    }
    return;
  }
  if (!((mode === 'append' && args.length === 5) || (mode === 'inspect' && args.length === 4))) {
    throw new Error('Invalid ledger arguments');
  }
  const [keyPath, directory, anchorPath, inputOrOutput, appendOutput] = args as [
    string,
    string,
    string,
    string,
    string?,
  ];
  const keyring = await readKeyring(keyPath);
  try {
    const anchor = ledgerAnchorSchema.parse(
      JSON.parse((await readRestrictedFile(anchorPath, 4096)).toString('utf8')),
    );
    if (mode === 'append' && appendOutput) {
      const input: unknown = JSON.parse(
        (await readRestrictedFile(inputOrOutput, 64 * 1024 * 1024)).toString('utf8'),
      );
      await writeEvidence(
        appendOutput,
        await appendLedgerCheckpoint(directory, anchor, keyring, input),
      );
      console.info('APPENDED; productionAuthorized=false');
    } else {
      const result = await inspectLedger(directory, anchor, keyring);
      await writeEvidence(inputOrOutput, result.anchor);
      console.info(
        `VERIFIED; checkpoints=${String(result.anchor.sequence)}; advanced=${String(result.advanced)}; reconciliation=${result.reconciliation?.disposition ?? 'EMPTY'}; productionAuthorized=false`,
      );
      if (result.reconciliation?.disposition === 'HOLD') process.exitCode = 2;
    }
  } finally {
    for (const key of keyring.keys.values()) key.fill(0);
  }
}

void main().catch(() => {
  console.error(
    'Ledger operation failed. Check arguments, owner-only files, keys and the trusted anchor. An append may already be committed; inspect before retrying.',
  );
  process.exitCode = 1;
});
