# Infrastructure-backed CI evidence — 2026-11-03

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

The first successful scanner execution at `b05fe8d` exposed six HIGH findings in Node's bundled
npm (`undici` 6.28.0 and `brace-expansion` 5.0.9). All runtime entrypoints execute compiled Node code.
Removing build-only npm/Yarn from the runtime resolved that image gate; build stages retain npm.
The application dependency lockfile was not downgraded or given vulnerability exclusions.

## Corrections after these runs

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

Current local backend unit checks pass: **24 suites / 128 tests**. The returning-row corrections and
five new integration cases require the next infrastructure-backed run; full Newman passage is pending.

## Acceptance still required

Native binary signing/install and device crash/recovery/accessibility acceptance; complete production
mobile and portal flows; approved provider integrations and canaries; production-role/security review;
multi-replica load/failure, broker/worker replay and restore/DR drills; approved source mappings and
encrypted full-volume migration rehearsals; releases, named owners and cutover/stabilization decisions.
The CI artifacts are generated review inputs. No production deployment, source-data migration,
credential rotation, traffic transfer or legacy retirement was performed.
