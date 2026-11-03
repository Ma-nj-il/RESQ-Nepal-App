# Phase 7 / Gate 7 status

- **Disposition:** HOLD — offline preparation implemented; production-source migration and full-volume rehearsal are incomplete.
- **Evidence date:** 2026-11-03.
- **Production migration:** 0% of source data, clients, or traffic.

## Executable preparation

`apps/migration-readiness/` is an offline command-line tool, outside the running API. It does not
connect to a database, load dotenv files, extract production data, or mutate target records.

```sh
# Run in backend-v2; choose a NEW output filename on each run.
npm run readiness -- reconcile test/fixtures/migration-manifest.synthetic.json /approved/local/path/reconciliation.json
npm run readiness -- cutover test/fixtures/cutover-hold.synthetic.json /approved/local/path/cutover.json
```

Exit codes: `0` means the selected offline check passed; `2` means HOLD; `1` means invalid input or
an execution/output failure. Output files use exclusive creation and owner-only permissions. Every
report contains the SHA-256 of its exact input bytes and `productionAuthorized: false`. CLI errors
omit input content and schema error values. The committed fixtures contain synthetic metadata only.

The strict TypeScript/Zod schemas in `reconciliation.ts` and `cutover.ts` are the input contracts.
The JSON examples illustrate these contracts. Do not put credentials, raw patient/contact data,
tokens, MFA secrets, document bytes or connection strings into a manifest. Metadata/IDs/hashes may
still be sensitive: use the approved encrypted, access-logged evidence workspace. File permissions
and hashes do not provide encryption or signatures.

### Reconciliation coverage

- Source/system/type counts, unique source keys, immutable extraction hashes, exactly one ledger
  disposition per source, and no unaccounted or invented source rows.
- Unique target keys, explicit source-to-target maps and transformed hashes, target type/ownership
  consistency, declared parent existence, and tenant/facility relationship checks.
- `MIGRATED`, reviewed `MERGED`, reviewed `SKIPPED_BY_POLICY`, and owner/reason/review-bound
  `QUARANTINED` accounting. A reviewed quarantine remains a quarantine; it does not become migrated.
- Every target must be mapped. Colliding maps must all be explicit reviewed merges.
- Exact integer money comparison by mapped target, tenant, and original currency; no float math,
  tolerance, or currency relabeling. Reviewed exclusions are reported separately from migrated money.
- A deterministic SHA-256/UUIDv8 ID helper binds an approved namespace to system/type/source ID.
  It does not infer identity equivalence or tenant grouping. Keep namespace stable across reruns;
  transform versions describe content changes, not new identities.
- Strict allowlisted fields reject accidental credential-bearing metadata. Reports expose aggregate
  failure codes/counts rather than source records.

`RECONCILED` means the supplied metadata satisfies these checks. It does not prove source snapshot
authenticity/completeness, transformed row hashes, real database constraints/RLS, lifecycle sequences,
active-resource contention, private object hashes/scans, audit/outbox/inbox correctness, or signoff.
Independent extraction, post-load database/security checks and signed evidence establish those facts.
The current in-memory CLI accepts files up to 64 MiB; full-volume execution needs reviewed partitioning
plus global identity/FK/money reconciliation, or a streaming/database implementation.

## Remaining inputs and execution

| Required work                                                                        | Accountable function   | Current blocker                                                           |
| ------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------- |
| Read-only source discovery; encrypted consistent exports and object manifests        | Data/platform          | Approved source access and snapshots unavailable                          |
| Canonical tenant/facility/geography and identity outcomes                            | Product/data/security  | Reviewed mappings and collision decisions unavailable                     |
| Source-specific deterministic transforms and restricted staging/bulk repositories    | Data/engineering       | Actual source schemas and approved field/status mappings unavailable      |
| Encrypted durable migration ledger/legacy-ID maps and rerun comparison               | Data/platform/security | Approved storage/KMS and target staging environment unavailable           |
| Repeated full-volume loads with duration/lock/storage measurements                   | Data/platform          | PostgreSQL/PostGIS staging and representative volume unavailable          |
| Target lifecycle, FK/RLS, assignment, exact finance, object/privacy and event checks | Data/security/finance  | Post-load environment and independent acceptance unavailable              |
| Shadow comparisons and capability/cohort writer registry                             | Operations/engineering | Proven live sources/cohorts unavailable                                   |
| Minimum-version mobile release and all three portal persona releases                 | Mobile/portal/product  | Native/device acceptance, portal sources and release evidence unavailable |
| Restore/DR, support/training and communications rehearsal                            | Operations/product     | Environment, operators and approved run window unavailable                |

Synthetic tests validate the tool's behavior and rejection paths. They are not a migration rehearsal
against real production volume. Gate 7 remains HOLD until all roadmap section 7 invariants and owners'
acceptance records exist. See [Phase 8 preparation](phase-8-status.md).

## Executed local evidence

- Synthetic CLI manifest: `RECONCILED`, exit 0.
- Missing-evidence cutover fixture: `HOLD`, exit 2.
- Output permissions 0600, exact input SHA-256, and refusal to overwrite an earlier report: PASS.
- Reconciliation/readiness unit tests are included in the backend's 22 passing suites / 117 tests.
