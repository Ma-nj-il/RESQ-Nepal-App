# Phase 6 / Gate 6 status

- **Disposition:** HOLD — initial product backend slice implemented; Phase 6 is incomplete.
- **Evidence date:** 2026-11-04.
- **Migration:** `CreateProductServices1793664000005`, following the five Phase 2–5 migrations.
- **Production migration:** 0% of clients, traffic, or source data has moved.

## Implemented

- Self notification preferences with explicit defaults, version-zero creation, serialized first
  replacement, and idempotent replay.
- Requester-only, immutable 1–5 ratings for completed trips, at most one rating per trip.
- Exact-fare NPR cash collection by a scoped `cash.record` operator, one collection per completed
  trip, requester receipts, and bounded facility-level cash reconciliation reports.
- Support ticket creation, encrypted messages, scoped reads, replies, and named `START`/`RESOLVE`
  transitions with optimistic concurrency. A resolved ticket cannot receive another reply.
- Durable owner-only in-app notifications for staff support changes and cash recording. Mark-read
  is naturally idempotent and audits the first transition.
- Six transactional outbox contracts, bringing the catalog to 30. Audit, state, notification, and
  outbox records commit or roll back together. Restricted content reads are audited.
- API registration, DTOs, UUID and version validation, no-store responses, ETags, and replay status
  handling. Eight Phase 6 requests extend the existing local dispatch/safety Newman collection.
- Mobile integration library: canonical HTTP decoders, exact NPR money, serialized rotating-token
  sessions, requester product adapters, and an origin/environment-scoped native SecureStore vault.
- Separate token-free mobile auth state and a development-only API preview: six-digit OTP, verified
  active profile, preference mutations, paginated notifications, server-confirmed mark-read, and logout.
  Product forms cover support creation/replies/messages, receipts and ratings. Dispatch forms cover
  quotes/consent/booking/cancellation, bounded histories and labelled tracking snapshots. Access-context
  metadata and enrolled-authenticator step-up are available. Intents retain body/key/version across
  explicit retry, with a 23-hour replay ceiling. Secure named-command recovery now survives process
  recreation through account/lane-scoped write-ahead SecureStore records; native durability acceptance
  remains open.
  Native/live acceptance is pending; see
  [mobile API/session foundation](../../docs/backend-rebuild/mobile-api-foundation.md) for launch
  prerequisites and scope. Default app flows remain on Supabase.
- Password/TOTP sign-in, memory-only TOTP enrollment and component-owned authenticated step-up
  now include session/lifecycle fencing, cancellation and expiry handling. Requester realtime
  invalidates consistent recovery reads through shared-group Kafka/Redis fanout.

See [the implemented HTTP contract](./phase-6-product-api.md).

## Security and lifecycle controls

All six product tables use forced RLS. Runtime application grants are SELECT-only; mutations use
named, parameterized security-definer functions with a fixed `pg_catalog` search path. Internal
fact-writing functions are not granted to runtime roles. Restrictive outbox/stream policies prevent
application and worker roles from minting product events through older generic delivery policies.

Tenant checks re-resolve live permissions and facility scope. Authority checks combine live profile
permissions, grant resource/geography/provider scope, and PII permission for message access. A
provider-filtered grant cannot read unbound account tickets. Requesters can access only their own
tickets, ratings, preferences, notifications, and completed-trip receipts.

Support text uses AES-256-GCM with ticket/message-bound AAD. Plaintext is absent from mutation replay
bodies, audit safe context, and outbox payloads. The adapter currently uses the configured dispatch
data key and key ID. Missing, mismatched, or tampered key/content fails closed. Production key custody,
rotation/key-ring migration, retention, and independent privacy/security review remain open.

Preferences persist user choices; external delivery is not implemented. Durable in-app facts remain
visible regardless of optional delivery preferences. Neither notifications nor outbox publication
assert successful SMS, push, email, or human contact. Intended event consumers in the catalog are
ownership/planning declarations; new consumer services are not deployed by this slice.

## Executed evidence

| Check                                      | Result                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Backend ESLint                             | PASS, zero warnings                                                                             |
| Backend typecheck and build                | PASS                                                                                            |
| Backend unit tests, including architecture | PASS locally and remotely at `6ea91f6`, 26 suites / 143 tests                                   |
| Event contracts                            | PASS, 30 schemas/examples                                                                       |
| Supported integration suites               | PASS remotely at `6ea91f6`, 3 suites / 28 tests against real dependencies                       |
| Embedded SQL debugging                     | All six migrations and eight serialized product scenarios executed with temporary PGlite 0.5.15 |
| Mobile lint and typecheck                  | PASS; backend project excluded from the root Expo checker                                       |
| Mobile unit tests                          | PASS, 128 tests, including 72 backend API/session/product/command/native-auth cases             |
| Expo config introspection                  | PASS, SecureStore Android backup references and no iOS Face ID permission                       |
| Mobile development and release exports     | PASS, Android/iOS/web; release native Hermes bytecode generated                                 |
| Expo dependency compatibility              | PASS; six mismatches aligned, SecureStore/DevClient/Crypto installed                            |

Formatting and the intended-file Git whitespace check passed. All 68 contract/Postman JSON artifacts
parse; the combined dispatch/product collection contains 20 requests.

Mobile transport/session tests use injected fetch and vault implementations with synthetic tokens.
They cover parallel/late refresh, logout and persistence races, lost responses, revocation, exact
money, protocol validation and command preconditions. The additional native-auth tests cover scoped
vault records, unavailable/corrupt storage, OTP challenge lifecycle, active-profile matching, and
auth-store teardown. Native secure-storage and live API acceptance remain unexecuted. The mobile
test runner reports existing informational Node module-type warnings. Backend lint/typecheck were
rerun successfully during the earlier mobile API-library continuation.

Exports used isolated CLI homes, disabled dotenv loading, offline CLI mode, and synthetic public
backend configuration. Config introspection generated no native projects. These checks establish
JavaScript bundling and static plugin configuration, not signed native builds, real-device behavior,
or release acceptance. `expo-dev-client`, `expo-crypto`, EAS device/simulator profiles and an upload
exclusion file are configured; project linking, signing and binary/device installation are pending.

The temporary PGlite checks include role switching, exact cash totals, transaction rollback, support
scope/content restrictions, notification ownership, and reserved outbox writes. PGlite serializes
those checks; it does **not** establish multi-connection race behavior or equivalence to the supported
PostgreSQL/PostGIS image and role setup. The PostgreSQL cases are implemented in
`test/integration/product-services.cases.ts` and use the isolated dispatch fixture.

The local Docker daemon remains unavailable. Remote CI at `d08effc` passes all PostgreSQL migration,
dispatch/product/RLS and dependency integration suites / 28 tests, health Newman, and all 16 identity
HTTP checks. At `6e9b7dc`, the complete backend workflow passes, including corrected provider
submission and all dispatch/product Newman requests. Image build, hardened runtime smoke, SBOM
and configured HIGH/CRITICAL Trivy scan pass. Mobile CI at `6e193d6` passes, including durable
recovery and development/release exports on all platforms. See the CI evidence for exact run
outcomes; these results do not pass Gate 6.

The complete backend workflow passes again at `6ea91f6`, including the encrypted rehearsal-ledger
addition and all 143 unit tests.

The runtime tracking-unavailable threshold was aligned to the existing contract/tests: 120 seconds
from capture time, replacing the inconsistent five-minute module constant.

## Remaining Phase 6 work

All backend/mobile jobs pass at `804f6f5` (196 backend / 167 mobile tests), including migrations,
Newman, image checks and all-platform exports. The following step-up changes pass 179 mobile tests,
lint and typecheck locally. See [exact CI evidence](ci-evidence-2026-11-03.md).

1. EAS project/signing/device preparation and native/live preview acceptance; production screen
   integration, managed-context selection, other realtime audiences and broader offline behavior,
   native acceptance of durable command recovery, and removal of direct Supabase mutations on approved cutover paths.
   The preview is opt-in and development-only; the production mobile data path has not migrated.
2. Hospital, province, and platform portal adapters and persona acceptance. Portal sources are absent
   from this checkout.
3. Approved external messaging/routing/storage/scanning adapters and provider evidence; broader
   notification policies, reports/exports, support escalation, and operational dashboards.
4. Full-persona role/RLS/concurrency acceptance, provider canaries, accessibility/error/offline acceptance,
   privacy/security review, capacity tests, and operational drills.

## Phase 7–8 handoff

The roadmap's migration pipeline remains the source of requirements. Source snapshots, canonical
tenant/identity mappings, source transforms, migration ledgers, and volume rehearsals require approved
source access and data-owner decisions. No source data was inspected or transformed in this slice.
Before cutover, the API mobile release/minimum-version enforcement, portal releases, one-writer
registry, final-delta reconciliation, backup/restore exercise, and signed go/no-go evidence are still
required. Controlled cutover and stabilization have not started. Gates 2–6 remain HOLD; Gates 7–8
have no passing execution evidence. Offline preparation now exists; see [Phase 7](phase-7-status.md)
and [Phase 8](phase-8-status.md). The synthetic CLI results do not establish migration acceptance.
