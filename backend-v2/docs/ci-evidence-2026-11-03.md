# Infrastructure-backed CI evidence — 2026-11-03

Updated 2026-11-04.

This record supplements the earlier local-only Phase 2–5 snapshots. Gates 2–8 remain **HOLD**;
production client, traffic and source-data migration remains **0%**.

## Verified remote runs

- [Mobile run 41679283466](https://github.com/Ma-nj-il/RESQ-Nepal-App/actions/runs/41679283466),
  commit `6e193d65c729a808a8cbc8841e7bc7619bcaf725`: **PASS**. Clean locked install, Expo
  compatibility, lint, typecheck, 128 unit tests, configured production dependency audit, and
  development/release exports for Android, iOS and web, including secure command recovery.
- [Backend run 41679283351](https://github.com/Ma-nj-il/RESQ-Nepal-App/actions/runs/41679283351),
  same commit: quality **PASS**, image **PASS**, integration job **FAIL** at dispatch/product Newman.
  Earlier integration steps passed: PostgreSQL/PostGIS, two Redis instances, Kafka and object storage;
  six baseline migrations; all three integration suites / 22 tests; API readiness; Newman health.
- The image job built the runtime, exercised non-root/read-only/capability-dropped startup, generated
  SPDX SBOM and uploaded the Trivy report. The configured HIGH/CRITICAL scan uses `--ignore-unfixed`;
  passing it is not a claim of zero findings at every severity or of independent security approval.
- [Backend run 41680454101](https://github.com/Ma-nj-il/RESQ-Nepal-App/actions/runs/41680454101),
  commit `e2a744bfeeb459369148173a0019239baad57b56`: image and the existing 22 integration tests
  **PASS**. Identity Newman passes authenticated-profile checks, confirming the context correction,
  then fails refresh with HTTP 500. Provider and dispatch/product collections were skipped. Quality
  stopped on Phase 6 documentation formatting, now corrected locally.
- [Backend run 41682049144](https://github.com/Ma-nj-il/RESQ-Nepal-App/actions/runs/41682049144),
  commit `3bf7cdf4aec2fa7951f1d972fc3b96fa4d01ff90`: quality and image **PASS**. Four new
  authentication persistence cases pass, including committed rotation, family/session revocation,
  OTP/MFA counts and one-time TOTP steps. The provider case fails at PostgreSQL parameter inference
  (`42P08`), before Newman. This confirms the returning-row fix independently of HTTP scripts.
- [Backend run 41683243167](https://github.com/Ma-nj-il/RESQ-Nepal-App/actions/runs/41683243167),
  commit `d08effc7934b1eb7e369d4274d80e80259001c0c`: quality and image **PASS**; all three
  integration suites / **28 tests**, including all 184 static SQL preparations, **PASS**. Health and
  all 16 identity Newman requests pass, including rotation/logout/reuse invalidation. Provider
  submission returns HTTP 201 instead of its recorded 200; provider Newman fails there and
  dispatch/product Newman is skipped.
- [Backend run 41684428128](https://github.com/Ma-nj-il/RESQ-Nepal-App/actions/runs/41684428128),
  commit `6e9b7dcb3263e6e7b869da883c215aea1f7d97e3`: **all jobs PASS**. Quality includes 25
  unit suites / 135 tests. All three integration suites / 28 tests, all four Newman collections
  (health, identity, provider, dispatch/product), hardened runtime smoke, image/SBOM and configured
  HIGH/CRITICAL image scanning pass. This is the first fully passing backend run after the HTTP fixes.
- [Backend run 41685824483](https://github.com/Ma-nj-il/RESQ-Nepal-App/actions/runs/41685824483),
  commit `6ea91f63ffce9c71c9d40623ae501f99e53d31a7`: **all jobs PASS** with the encrypted
  checkpoint ledger. Quality includes **26 suites / 143 tests**; all 28 integration tests, all four
  Newman collections, image build, hardened smoke, SBOM and the configured image scan pass again.
- [Backend run 41690932171](https://github.com/Ma-nj-il/RESQ-Nepal-App/actions/runs/41690932171),
  commit `2481a37497188637f57a2543fb572e297e805a17`: **all three jobs PASS**, including
  quality/unit checks, migrations/dependencies/Newman, and production image/SBOM/scan.
  This revision adds execution-bound document/compliance workers, migration 0006,
  S3/ClamAV adapters, 36 event contracts, and nine document PostgreSQL cases. Its local
  unit result is **29 suites / 174 tests**. Public REST job conclusions were inspected;
  downloadable Actions logs were unavailable. Live bucket-policy/encryption/conditional-write
  acceptance and ClamAV corpus/signature-freshness acceptance remain unexecuted.

The first successful scanner execution at `b05fe8d` exposed six HIGH findings in Node's bundled
npm (`undici` 6.28.0 and `brace-expansion` 5.0.9). All runtime entrypoints execute compiled Node code.
Removing build-only npm/Yarn from the runtime resolved that image gate; build stages retain npm.
The application dependency lockfile was not downgraded or given vulnerability exclusions.

## Corrections after these runs

- Recovery revision `d883f2fe1d1bc727dbe36cec55a274bbfa1ce62a`: backend run
  [41692631660](https://github.com/Ma-nj-il/RESQ-Nepal-App/actions/runs/41692631660) passes
  quality and image, but the new concurrent recovery fixture fails because direct lifecycle
  updates correctly trip the named-command guard. The fixture now invokes requester cancellation
  through an independent application transaction. Mobile run
  [41692631575](https://github.com/Ma-nj-il/RESQ-Nepal-App/actions/runs/41692631575) stops at
  Expo compatibility validation; local reproduction requires Expo 58.0.23, splash screen 58.0.13
  and safe-area-context 5.11.1. Those compatible packages were installed through Expo CLI.

- PostgreSQL's superuser `pg_has_role` behavior required a short-lived, non-application bootstrap
  identity in synthetic authority fixtures. The root-grant guard and forced RLS remain enabled.
- Dispatch acceptance checks optimistic version before terminal status; a competing acceptance
  correctly returns `STALE_VERSION`. The integration expectation now matches that contract.
- The migration-count assertion follows the catalog; its client now closes even on assertion failure.
- Newman exposed an asynchronous request-context defect: replacing an AsyncLocalStorage store in a
  guard did not reach the awaiting controller continuation. A per-request context cell now preserves
  the immutable authorized context across awaits, with overlapping/nested request isolation tests.
- Top-level Postman `data` bindings conflicted with sandbox globals. The scripts use scoped projection
  names. Identity and provider collections are now included alongside health and dispatch/product CI.
- Independent migration-rerun comparison validates both runs and rejects source/map/ownership/money/
  disposition drift even when the individual manifests reconcile. Local CLI checks verify input hashes,
  0600 output permissions, overwrite refusal and HOLD exit status.
- Refresh diagnosis found TypeORM's PostgreSQL raw UPDATE result is `[rows, affectedCount]`, while
  repositories expected only rows. A successful rotation therefore failed its row-count assertion and
  rolled back. The same defect affected OTP/MFA counts, TOTP consumption, session/grant revocation,
  optimistic provider updates and document transitions. These callers now consume structured records
  from the active transaction's query runner. Installed-driver contract tests cover zero/one/many rows;
  five additional PostgreSQL integration cases cover rotation/family revocation, session isolation and
  counts, persisted OTP/MFA attempts, one-time TOTP steps, and stale/foreign provider transitions.
- PostgreSQL parameter inference also exposed status parameters used as both varchar assignments
  and text comparisons in provider/driver transitions, plus maintenance status/completion expressions.
  Explicit varchar/timestamptz casts resolve those statements. A read-only PREPARE check covers all
  complete static query arguments against the migrated schema; all **184** pass locally with embedded
  PostgreSQL. CI runs the same check on its real PostgreSQL instance. Interpolated statements still
  require operation-specific execution coverage.
- Identity Newman now checks successor access, immediate access/refresh invalidation after logout,
  consumed-token reuse, and revocation of both successor refresh and access credentials.
- Provider, dispatch and access-administration response handlers now propagate the recorded command
  status. Installed Nest/Express HTTP regression tests reproduced five transition routes incorrectly
  returning 201, then passed for initial and replayed responses after the correction; creation remains 201. Seven real-controller HTTP cases cover the affected response paths with mocked application services.

The HTTP status correction is verified remotely at `6e9b7dcb3263e6e7b869da883c215aea1f7d97e3`.
The subsequent encrypted rehearsal-ledger implementation adds local persistence, authenticated
hash-chain/anchor verification, atomic concurrent append, historical key versions, lost-receipt
recovery and in-memory comparison of encrypted snapshots. Its synthetic checks do not establish
power-loss durability, managed KMS readiness or full-volume migration acceptance.

At the ledger revision, local checks passed: backend lint, typecheck, build, formatting and **26 suites / 143 tests**,
plus root mobile lint and typecheck. Eight new encrypted-ledger cases include the real CLI and
filesystem adapter with synthetic manifests and ephemeral keys. The ledger is also verified in the
complete passing run at `6ea91f6` above.

## Acceptance still required

Native binary signing/install and device crash/recovery/accessibility acceptance; complete production
mobile and portal flows; approved provider integrations and canaries; production-role/security review;
multi-replica load/failure, broker/worker replay and restore/DR drills; approved source mappings and
encrypted full-volume migration rehearsals; releases, named owners and cutover/stabilization decisions.
The CI artifacts are generated review inputs. No production deployment, source-data migration,
credential rotation, traffic transfer or legacy retirement was performed.
