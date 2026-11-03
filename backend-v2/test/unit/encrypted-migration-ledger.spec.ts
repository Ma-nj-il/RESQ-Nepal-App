import { randomBytes } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  appendLedgerCheckpoint,
  initializeLedger,
  inspectLedger,
  type LedgerAnchor,
  type LedgerKeyring,
} from '../../apps/migration-readiness/encrypted-ledger.js';
import type { RehearsalInput } from '../../apps/migration-readiness/reconciliation.js';

function fixture(): RehearsalInput {
  return {
    formatVersion: 1,
    runId: 'synthetic-ledger-run',
    transformVersion: 'synthetic-transform',
    exportSha256: 'a'.repeat(64),
    sourceCounts: [{ system: 'legacy', type: 'PRINCIPAL', count: 2 }],
    sources: [
      {
        key: { system: 'legacy', type: 'PRINCIPAL', id: 'restricted-synthetic-source' },
        sha256: 'b'.repeat(64),
      },
      {
        key: { system: 'legacy', type: 'PRINCIPAL', id: 'mapped-synthetic-source' },
        sha256: 'c'.repeat(64),
      },
    ],
    ledger: [
      {
        source: { system: 'legacy', type: 'PRINCIPAL', id: 'restricted-synthetic-source' },
        sourceSha256: 'b'.repeat(64),
        outcome: 'QUARANTINED',
        tenantId: null,
        facilityId: null,
        owner: 'synthetic-owner',
        reviewRef: 'synthetic-review',
        reasonCode: 'COLLISION',
      },
      {
        source: { system: 'legacy', type: 'PRINCIPAL', id: 'mapped-synthetic-source' },
        sourceSha256: 'c'.repeat(64),
        outcome: 'MIGRATED',
        target: { type: 'PRINCIPAL', id: '00000000-0000-4000-8000-000000000001' },
        targetSha256: 'd'.repeat(64),
        tenantId: null,
        facilityId: null,
      },
    ],
    targets: [
      {
        key: { type: 'PRINCIPAL', id: '00000000-0000-4000-8000-000000000001' },
        sha256: 'd'.repeat(64),
        tenantId: null,
        facilityId: null,
        parents: [],
      },
    ],
  };
}

describe('encrypted immutable rehearsal ledger', () => {
  let root: string, directory: string, genesis: LedgerAnchor, keyring: LedgerKeyring;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'resq-ledger-'));
    directory = join(root, 'ledger');
    genesis = await initializeLedger(directory);
    keyring = { activeVersion: 'test-v1', keys: new Map([['test-v1', randomBytes(32)]]) };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('persists encrypted maps/outcomes, survives reopen, and preserves quarantine accounting', async () => {
    const first = await appendLedgerCheckpoint(directory, genesis, keyring, fixture());
    const second = await appendLedgerCheckpoint(directory, first, keyring, fixture());
    const inspection = await inspectLedger(directory, second, keyring);
    expect(inspection.latest).toEqual(fixture());
    expect(inspection.reconciliation).toMatchObject({
      disposition: 'RECONCILED',
      counts: { quarantined: 1, migrated: 1 },
      productionAuthorized: false,
    });
    expect(inspection.advanced).toBe(false);
    const encrypted = await readFile(join(directory, '000001.entry'), 'utf8');
    for (const text of [
      'restricted-synthetic-source',
      'COLLISION',
      'synthetic-owner',
      'synthetic-transform',
      'mapped-synthetic-source',
      '00000000-0000-4000-8000-000000000001',
    ]) {
      expect(encrypted).not.toContain(text);
    }
    const firstEnvelope = JSON.parse(encrypted) as { nonce: string };
    const secondEnvelope = JSON.parse(await readFile(join(directory, '000002.entry'), 'utf8')) as {
      nonce: string;
    };
    expect(firstEnvelope.nonce).not.toEqual(secondEnvelope.nonce);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, '000001.entry'))).mode & 0o777).toBe(0o600);
  });

  it('recovers a committed suffix after receipt loss and refuses a stale append', async () => {
    const head = await appendLedgerCheckpoint(directory, genesis, keyring, fixture());
    await expect(appendLedgerCheckpoint(directory, genesis, keyring, fixture())).rejects.toThrow(
      'LEDGER_HEAD_CHANGED',
    );
    const recovered = await inspectLedger(directory, genesis, keyring);
    expect(recovered).toMatchObject({ anchor: head, advanced: true });
    const next = await appendLedgerCheckpoint(directory, recovered.anchor, keyring, fixture());
    expect(next.sequence).toBe(2);
  });

  it('allows only one concurrent writer to publish the next sequence', async () => {
    const outcomes = await Promise.allSettled([
      appendLedgerCheckpoint(directory, genesis, keyring, fixture()),
      appendLedgerCheckpoint(directory, genesis, keyring, {
        ...fixture(),
        runId: 'other-synthetic-run',
      }),
    ]);
    expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect((await inspectLedger(directory, genesis, keyring)).anchor.sequence).toBe(1);
    expect(await readdir(directory)).toEqual(['000001.entry']);
  });

  it('detects rollback, missing sequence, tampering and cross-ledger substitution', async () => {
    const first = await appendLedgerCheckpoint(directory, genesis, keyring, fixture());
    const second = await appendLedgerCheckpoint(directory, first, keyring, fixture());
    const firstBytes = await readFile(join(directory, '000001.entry'));
    const secondBytes = await readFile(join(directory, '000002.entry'));
    await rm(join(directory, '000002.entry'));
    await expect(inspectLedger(directory, second, keyring)).rejects.toThrow(
      'LEDGER_LAYOUT_INVALID',
    );
    await writeFile(join(directory, '000002.entry'), secondBytes, { mode: 0o600 });
    await rm(join(directory, '000001.entry'));
    await expect(inspectLedger(directory, genesis, keyring)).rejects.toThrow(
      'LEDGER_SEQUENCE_INVALID',
    );
    await writeFile(join(directory, '000001.entry'), firstBytes, { mode: 0o600 });
    const envelope = JSON.parse(firstBytes.toString('utf8')) as { tag: string };
    envelope.tag = '0'.repeat(32);
    await writeFile(join(directory, '000001.entry'), JSON.stringify(envelope));
    await expect(inspectLedger(directory, genesis, keyring)).rejects.toThrow();
    await writeFile(join(directory, '000001.entry'), firstBytes);
    const foreignDirectory = join(root, 'foreign-ledger');
    const foreign = await initializeLedger(foreignDirectory);
    await copyFile(join(directory, '000001.entry'), join(foreignDirectory, '000001.entry'));
    await expect(inspectLedger(foreignDirectory, foreign, keyring)).rejects.toThrow(
      'LEDGER_CHAIN_INVALID',
    );
    await expect(
      inspectLedger(directory, { ...second, headSha256: 'f'.repeat(64) }, keyring),
    ).rejects.toThrow('LEDGER_ANCHOR_MISMATCH');
  });

  it('requires historical keys after rotation and rejects substituted key material', async () => {
    const first = await appendLedgerCheckpoint(directory, genesis, keyring, fixture());
    const rotated = {
      activeVersion: 'test-v2',
      keys: new Map([...keyring.keys, ['test-v2', randomBytes(32)] as const]),
    };
    const second = await appendLedgerCheckpoint(directory, first, rotated, fixture());
    await expect(inspectLedger(directory, second, rotated)).resolves.toMatchObject({
      anchor: second,
    });
    await expect(
      inspectLedger(directory, second, {
        activeVersion: 'test-v2',
        keys: new Map([['test-v2', randomBytes(32)]]),
      }),
    ).rejects.toThrow('LEDGER_KEY_UNAVAILABLE');
    await expect(
      inspectLedger(directory, second, {
        activeVersion: 'test-v1',
        keys: new Map([['test-v1', randomBytes(32)]]),
      }),
    ).rejects.toThrow();
  });

  it('ignores unpublished ciphertext but rejects partial, symlinked and world-readable committed entries', async () => {
    await writeFile(
      join(directory, '00000000-0000-4000-8000-000000000001.pending'),
      'interrupted ciphertext',
      { mode: 0o600 },
    );
    expect((await inspectLedger(directory, genesis, keyring)).anchor).toEqual(genesis);
    await writeFile(join(directory, '000001.entry'), '{', { mode: 0o600 });
    await expect(inspectLedger(directory, genesis, keyring)).rejects.toThrow();
    await rm(join(directory, '000001.entry'));
    const first = await appendLedgerCheckpoint(directory, genesis, keyring, fixture());
    await chmod(join(directory, '000001.entry'), 0o644);
    await expect(inspectLedger(directory, first, keyring)).rejects.toThrow('LEDGER_FILE_INVALID');
    await chmod(join(directory, '000001.entry'), 0o600);
    await copyFile(join(directory, '000001.entry'), join(root, 'replacement'));
    await rm(join(directory, '000001.entry'));
    await symlink(join(root, 'replacement'), join(directory, '000001.entry'));
    await expect(inspectLedger(directory, first, keyring)).rejects.toThrow();
  });

  it('rejects credential-bearing input before publication and retains unreconciled evidence as HOLD', async () => {
    await expect(
      appendLedgerCheckpoint(directory, genesis, keyring, {
        ...fixture(),
        refreshToken: 'forbidden',
      }),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
    const input = fixture();
    input.ledger = [];
    const head = await appendLedgerCheckpoint(directory, genesis, keyring, input);
    expect((await inspectLedger(directory, head, keyring)).reconciliation?.disposition).toBe(
      'HOLD',
    );
  });

  it('executes the restricted CLI and recovers after an anchor-output conflict without duplicating checkpoints', async () => {
    const key = randomBytes(32).toString('base64');
    const keyPath = join(root, 'keyring.json'),
      anchorPath = join(root, 'genesis.json');
    const inputPath = join(root, 'input.json'),
      nextPath = join(root, 'next.json');
    await writeFile(
      keyPath,
      JSON.stringify({ activeVersion: 'cli-v1', keys: [{ version: 'cli-v1', keyBase64: key }] }),
      { mode: 0o600 },
    );
    await writeFile(anchorPath, JSON.stringify(genesis), { mode: 0o600 });
    await writeFile(inputPath, JSON.stringify(fixture()), { mode: 0o600 });
    await writeFile(nextPath, 'existing artifact', { mode: 0o600 });
    const cli = (...args: string[]): ReturnType<typeof spawnSync> =>
      spawnSync(
        process.execPath,
        ['--import', 'tsx', resolve('apps/migration-readiness/ledger-main.ts'), ...args],
        { encoding: 'utf8' },
      );
    const interrupted = cli('append', keyPath, directory, anchorPath, inputPath, nextPath);
    expect(interrupted.status).toBe(1);
    expect(String(interrupted.stderr)).not.toContain(key);
    expect(await readFile(nextPath, 'utf8')).toBe('existing artifact');
    const recoveredPath = join(root, 'recovered.json');
    const recovered = cli('inspect', keyPath, directory, anchorPath, recoveredPath);
    expect(recovered.status).toBe(0);
    expect(String(recovered.stdout)).toContain('advanced=true');
    expect(JSON.parse(await readFile(recoveredPath, 'utf8'))).toMatchObject({ sequence: 1 });
    expect((await stat(recoveredPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['000001.entry']);
    const rerunDirectory = join(root, 'rerun');
    const rerunGenesis = await initializeLedger(rerunDirectory);
    const cliKeyring = {
      activeVersion: 'cli-v1',
      keys: new Map([['cli-v1', Buffer.from(key, 'base64')]]),
    };
    const rerunHead = await appendLedgerCheckpoint(rerunDirectory, rerunGenesis, cliKeyring, {
      ...fixture(),
      runId: 'synthetic-independent-rerun',
    });
    const rerunAnchorPath = join(root, 'rerun-anchor.json');
    await writeFile(rerunAnchorPath, JSON.stringify(rerunHead), { mode: 0o600 });
    const comparisonPath = join(root, 'comparison.json');
    const compared = cli(
      'compare',
      keyPath,
      directory,
      recoveredPath,
      rerunDirectory,
      rerunAnchorPath,
      comparisonPath,
    );
    expect(compared.status).toBe(0);
    const report = await readFile(comparisonPath, 'utf8');
    expect(JSON.parse(report)).toMatchObject({
      disposition: 'REPEATABLE',
      productionAuthorized: false,
    });
    expect(report).not.toContain('mapped-synthetic-source');
  });
});
