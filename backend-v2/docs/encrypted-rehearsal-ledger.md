# Encrypted rehearsal checkpoint ledger

`apps/migration-readiness/encrypted-ledger.ts` persists immutable, encrypted snapshots of the strict
rehearsal manifest: source hashes, legacy-ID maps, reviewed dispositions, target hashes/ownership,
parent relationships and exact money metadata. It is an offline evidence store. Source extraction,
target writes and transaction-bound migration execution remain separate work.

## CLI

Run from `backend-v2` in a restricted evidence workspace. Use a new directory for each ledger and
new output filenames. Retain anchors independently from the ledger directory, with access logging
and tamper-resistant backups; use the latest trusted anchor for subsequent operations.

```sh
npm run migration:ledger -- init LEDGER_DIRECTORY NEW_GENESIS_ANCHOR.json
npm run migration:ledger -- append KEYRING.json LEDGER_DIRECTORY TRUSTED_ANCHOR.json MANIFEST.json NEW_ANCHOR.json
npm run migration:ledger -- inspect KEYRING.json LEDGER_DIRECTORY TRUSTED_ANCHOR.json RECOVERED_ANCHOR.json
npm run migration:ledger -- compare KEYRING.json BASELINE_DIRECTORY BASELINE_ANCHOR.json RERUN_DIRECTORY RERUN_ANCHOR.json NEW_COMPARISON.json
```

The supplied keyring, manifests and anchors must be regular, owner-only files (0600); the ledger
directory is created 0700. Final-component symlinks are rejected. Keep all ancestor directories in
the trusted workspace. The CLI keyring contract is:

```json
{
  "activeVersion": "rehearsal-v1",
  "keys": [{ "version": "rehearsal-v1", "keyBase64": "<canonical base64 of 32 random bytes>" }]
}
```

Provision key material through the environment's approved secret process, outside the repository.
The local adapter accepts at most 16 distinct versions. Rotation selects a new `activeVersion`;
historical keys remain required to verify older checkpoints. Reusing a version with different
material fails authentication. A managed KMS, key escrow/retention, access logging and operational
key-rotation acceptance are not implemented by this local adapter.

Exit `0` means the operation completed. `inspect` returns `2` if the latest manifest reconciles to
HOLD, and `compare` returns `2` for failed repeatability. Exit `1` indicates invalid input, integrity,
key, filesystem or output failure. `APPENDED` only confirms persistence; incomplete/unreconciled
manifests can be preserved as evidence. No operation authorizes production.

## Persistence and recovery

- AES-256-GCM uses a fresh 96-bit nonce for every checkpoint. Authenticated associated data binds
  the ledger UUID, sequence, preceding encrypted-file hash and key version. Source/target identifiers,
  outcome/review records and manifest contents are encrypted, including temporary files.
- Append verifies the complete chain against the supplied external anchor. It requires that anchor
  to be current, then fsyncs ciphertext and publishes a numbered entry through an exclusive atomic
  hard link. Concurrent writers compete for the same sequence; exactly one can publish it. File and
  directory synchronization complete before success. Receipts also sync their parent directory.
- Committed entries are never edited or deleted by the tool. A temporary `.pending` ciphertext file
  left before publication has no committed effect. Partial/corrupt committed entries, missing sequence
  numbers, wrong keys and mismatched anchors stop verification.
- An append can commit before writing its external receipt. After any ambiguous append error,
  `inspect` verifies the retained prefix and any authenticated suffix, then writes a new anchor.
  Inspect the recovered evidence before continuing. A stale append is rejected rather than repeated.
  Recovery does not execute any database operation or discard an entry.
- External anchors are essential: truncation below the latest retained anchor is detected. An older
  anchor cannot prove that a subsequently lost, unanchored suffix ever existed. Hashes/encryption
  do not replace trusted anchor retention or storage backups.
- `compare` decrypts in memory, requires exact/current anchors and nonempty snapshots, and applies
  the existing independent-rerun checks. Its output contains aggregate failures and encrypted-head
  hashes; no decrypted source-ID maps are written. Uninspected newer heads require explicit recovery.

Each snapshot is limited to 64 MiB of serialized plaintext, with at most 1,000 checkpoints per ledger.
Verification reads checkpoints sequentially and revalidates the latest manifest. Full-volume use
still needs reviewed partitioning/global reconciliation or a streaming/database execution ledger.
The filesystem must support local POSIX no-follow opens, exclusive hard links and directory fsync;
network/object-store semantics require their own adapter and acceptance.

## Verified scope

Synthetic filesystem and CLI tests cover encrypted legacy-ID maps, quarantine accounting, reopen,
concurrent writers, lost-receipt recovery, rollback/tamper/foreign-ledger rejection, key rotation,
pending/partial files, permission/symlink rejection, strict credential exclusion and encrypted rerun
comparison. These checks are not hardware power-loss, full-volume migration, KMS or production
acceptance. Gate 7 remains HOLD.
