import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import {
  reconcileManifest,
  rehearsalSchema,
  type ReconciliationReport,
  type RehearsalInput,
} from './reconciliation.js';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_CHECKPOINTS = 1000;
const ZERO_HASH = '0'.repeat(64);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const ledgerAnchorSchema = z
  .object({
    formatVersion: z.literal(1),
    ledgerId: z.uuid(),
    sequence: z.number().int().min(0).max(MAX_CHECKPOINTS),
    headSha256: hash,
    productionAuthorized: z.literal(false),
  })
  .strict();
export type LedgerAnchor = z.infer<typeof ledgerAnchorSchema>;
export interface LedgerKeyring {
  readonly activeVersion: string;
  readonly keys: ReadonlyMap<string, Uint8Array>;
}
const envelopeSchema = z
  .object({
    formatVersion: z.literal(1),
    ledgerId: z.uuid(),
    sequence: z.number().int().min(1).max(MAX_CHECKPOINTS),
    previousSha256: hash,
    keyVersion: version,
    nonce: z.string().regex(/^[a-f0-9]{24}$/),
    tag: z.string().regex(/^[a-f0-9]{32}$/),
    ciphertext: z
      .string()
      .min(1)
      .max(Math.ceil(MAX_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
type Envelope = z.infer<typeof envelopeSchema>;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function aad(
  header: Pick<Envelope, 'ledgerId' | 'sequence' | 'previousSha256' | 'keyVersion'>,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      'resq:migration-ledger:v1',
      header.ledgerId,
      header.sequence,
      header.previousSha256,
      header.keyVersion,
    ]),
  );
}
function keyFor(keyring: LedgerKeyring, keyVersion: string): Uint8Array {
  const key = keyring.keys.get(version.parse(keyVersion));
  if (!key || key.byteLength !== 32) throw new Error('LEDGER_KEY_UNAVAILABLE');
  return key;
}

/** Read through one no-follow handle; never echo restricted file contents in an error. */
export async function readRestrictedFile(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      (process.getuid && metadata.uid !== process.getuid()) ||
      metadata.size > limit
    ) {
      throw new Error('LEDGER_FILE_INVALID');
    }
    // Bound the read even if the file grows after fstat.
    const bytes = Buffer.alloc(Math.min(metadata.size + 1, limit + 1));
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length !== metadata.size || length > limit) throw new Error('LEDGER_FILE_CHANGED');
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

async function checkDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    (metadata.mode & 0o077) !== 0 ||
    (process.getuid && metadata.uid !== process.getuid())
  )
    throw new Error('LEDGER_DIRECTORY_INVALID');
}
export async function syncLedgerDirectory(directory: string): Promise<void> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
function slot(sequence: number): string {
  return `${String(sequence).padStart(6, '0')}.entry`;
}

/** The returned anchor must be retained independently of the ledger directory. */
export async function initializeLedger(directory: string): Promise<LedgerAnchor> {
  await mkdir(directory, { mode: 0o700 });
  await syncLedgerDirectory(dirname(directory));
  return {
    formatVersion: 1,
    ledgerId: randomUUID(),
    sequence: 0,
    headSha256: ZERO_HASH,
    productionAuthorized: false,
  };
}

export interface LedgerInspection {
  readonly anchor: LedgerAnchor;
  readonly advanced: boolean;
  readonly latest?: RehearsalInput;
  readonly reconciliation?: ReconciliationReport;
}

/** Verify the entire chain and the externally retained prefix before recovering any newer head.
 * A valid encrypted suffix may be an append whose receipt was lost; this never replays a data write.
 */
export async function inspectLedger(
  directory: string,
  trustedAnchor: LedgerAnchor,
  keyring: LedgerKeyring,
): Promise<LedgerInspection> {
  const trusted = ledgerAnchorSchema.parse(trustedAnchor);
  if (trusted.sequence === 0 && trusted.headSha256 !== ZERO_HASH)
    throw new Error('LEDGER_ANCHOR_INVALID');
  await checkDirectory(directory);
  const names = await readdir(directory);
  const entries = names.filter((name) => /^\d{6}\.entry$/.test(name)).sort();
  if (
    entries.length > MAX_CHECKPOINTS ||
    entries.length < trusted.sequence ||
    names.some((name) => !/^\d{6}\.entry$/.test(name) && !/^[a-f0-9-]{36}\.pending$/.test(name))
  ) {
    throw new Error('LEDGER_LAYOUT_INVALID');
  }
  let head = ZERO_HASH;
  let latest: RehearsalInput | undefined;
  for (const [index, name] of entries.entries()) {
    const sequence = index + 1;
    if (name !== slot(sequence)) throw new Error('LEDGER_SEQUENCE_INVALID');
    const bytes = await readRestrictedFile(
      join(directory, name),
      Math.ceil(MAX_BYTES / 3) * 4 + 4096,
    );
    const envelope = envelopeSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (
      envelope.ledgerId !== trusted.ledgerId ||
      envelope.sequence !== sequence ||
      envelope.previousSha256 !== head
    )
      throw new Error('LEDGER_CHAIN_INVALID');
    head = sha256(bytes);
    if (sequence === trusted.sequence && head !== trusted.headSha256)
      throw new Error('LEDGER_ANCHOR_MISMATCH');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFor(keyring, envelope.keyVersion),
      Buffer.from(envelope.nonce, 'hex'),
    );
    decipher.setAAD(aad(envelope));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    try {
      if (plaintext.length > MAX_BYTES) throw new Error('LEDGER_CHECKPOINT_TOO_LARGE');
      latest = rehearsalSchema.parse(JSON.parse(plaintext.toString('utf8')));
    } finally {
      plaintext.fill(0);
    }
  }
  return {
    anchor: { ...trusted, sequence: entries.length, headSha256: head },
    advanced: entries.length !== trusted.sequence,
    ...(latest === undefined ? {} : { latest, reconciliation: reconcileManifest(latest) }),
  };
}

/** Append an immutable encrypted checkpoint. Concurrent/stale writers cannot replace an entry.
 * Only records offline evidence; it neither writes target rows nor asserts database commit success.
 */
export async function appendLedgerCheckpoint(
  directory: string,
  expected: LedgerAnchor,
  keyring: LedgerKeyring,
  value: unknown,
): Promise<LedgerAnchor> {
  const input = rehearsalSchema.parse(value);
  const current = await inspectLedger(directory, expected, keyring);
  if (current.advanced) throw new Error('LEDGER_HEAD_CHANGED');
  if (current.anchor.sequence >= MAX_CHECKPOINTS) throw new Error('LEDGER_CHECKPOINT_LIMIT');
  const header = {
    ledgerId: current.anchor.ledgerId,
    sequence: current.anchor.sequence + 1,
    previousSha256: current.anchor.headSha256,
    keyVersion: version.parse(keyring.activeVersion),
  };
  const plaintext = Buffer.from(JSON.stringify(input));
  let bytes: Buffer;
  try {
    if (plaintext.length > MAX_BYTES) throw new Error('LEDGER_CHECKPOINT_TOO_LARGE');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyFor(keyring, header.keyVersion), nonce);
    cipher.setAAD(aad(header));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    bytes = Buffer.from(
      JSON.stringify({
        formatVersion: 1,
        ...header,
        nonce: nonce.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        ciphertext: ciphertext.toString('base64'),
      }),
    );
  } finally {
    plaintext.fill(0);
  }
  const temporary = join(directory, `${randomUUID()}.pending`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
    // link is atomic and exclusive; rename would overwrite a concurrently committed checkpoint.
    await link(temporary, join(directory, slot(header.sequence)));
    await syncLedgerDirectory(directory);
  } finally {
    await file.close();
    await unlink(temporary);
  }
  await syncLedgerDirectory(directory);
  return { ...current.anchor, sequence: header.sequence, headSha256: sha256(bytes) };
}
