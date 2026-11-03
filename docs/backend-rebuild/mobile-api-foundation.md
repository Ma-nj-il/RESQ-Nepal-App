# Mobile API/session foundation

**Status (2026-11-04):** API library, native secure-session adapter, auth controller, and opt-in
development preview implemented and unit-tested. Default app flows still use the existing Supabase
services. Native-device/live-backend acceptance is pending; production client/traffic/data migration
remains 0%.

## Entry points

| File under `src/services/api/backend/` | Responsibility                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `transport.ts`                         | Dedicated-origin HTTP, success/error envelopes, timeout/cancellation, ETag, replay status, `Retry-After`, preconditions |
| `session.ts`                           | Mobile OTP/password/TOTP, restoration, one-time refresh rotation, session-scoped responses, local logout and remote revocation |
| `decoders.ts`                          | Runtime wire validation, canonical booking/trip states, exact NPR amounts, bounded product pages                        |
| `requester.ts`                         | Self profile, preferences, ratings, receipts, support tickets/messages, notifications/read state                        |
| `dispatch.ts`                          | Coverage/quote, booking/cancellation, assignment/timeline, trips/tracking snapshots and safety incident adapters        |
| `commandIntent.ts`                     | Immutable body/key/version, single-flight presses, explicit retry, Retry-After and bounded replay lifetime              |
| `durableCommands.ts` / `commandRegistry.ts` | Account-bound named commands, serialized recovery and token-free UI state |
| `secureCommandVault.ts`                | Write-ahead SecureStore payloads, bounded chunks, integrity checks and crash-safe settlement |
| `errors.ts`                            | Structured public errors without raw transport objects                                                                  |
| `secureRefreshVault.ts`                | One versioned SecureStore record scoped to normalized API origin and environment                                        |
| `authController.ts`                    | Secret-free OTP/password/TOTP state, matching active profile, cancellation and logout/revocation lifecycle |
| `mfaEnrollment.ts`                     | Component-owned TOTP setup, expiry, concealment, cancellation and ambiguous-outcome handling |
| `nativeRuntime.native.ts`              | Module-lifetime native session/vault owner shared across component remounts                                             |
| `nativeRuntime.ts`                     | Web refusal with `CLIENT.NATIVE_REQUIRED`                                                                               |
| `previewConfig.ts`                     | Explicit development-only preview configuration validation                                                              |

These contracts follow the implemented identity controllers and product projections. The historical
`src/services/api/contracts.ts` proposal is not the target API. No backend code is imported into the
mobile dependency graph.

## Session ownership and secure storage

Construct one `BackendTransport` with a dedicated HTTPS API origin, one `BackendSession` with an
exclusive `RefreshVault`, and `createRequesterApi(session)`. Injecting fetch and the clock supports
deterministic testing. HTTP requires the explicit development-only transport option.

The native adapter uses SDK 58-compatible `expo-secure-store@~58.0.2`:

- An injectively encoded key binds storage to the normalized API origin and environment. One JSON
  record contains `formatVersion: 1`, that scope, and user/session IDs with refresh credentials.
- Keychain access uses `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, `requireAuthentication: false`, and a scoped
  `keychainService`. Records are bounded to 2 KiB. There is no plaintext or browser-storage fallback.
- Writes and clears wait for native acknowledgement. Invalid/cross-scope records fail closed;
  unavailable storage returns a sanitized error. Session operations serialize storage access.
- `app.json` enables SecureStore Android backup exclusion and sets `faceIDPermission: false`.
- The native runtime shares one session owner across component remounts and rejects environment
  changes until a full app reload. Concurrent JavaScript runtimes/background owners still need
  explicit coordination before sharing a vault; single-flight is per instance.
- Access tokens stay in session memory. `identity()` and `subscribe()` expose only user/session IDs
  and assurance. Consumer exceptions cannot poison a persisted rotation. These client-visible
  statuses never replace server authorization.

Restoration validates stored credentials and rotates them before exposing an authenticated identity.
Before dispatching refresh, the old persisted credential is cleared. The successor is persisted before
being used. Concurrent callers share one rotation; late rejection of the prior access token uses the
already-issued successor. Logout/account replacement invalidates pending responses and serializes
storage clearing behind in-progress writes.

A lost refresh response, failed persistence, rejected rotation, or process death during rotation
requires sign-in again. This deliberately favors losing a local session over replaying a consumed
refresh token, which would revoke the backend refresh family. Refresh POSTs are never retried.
Crash/restart, locked-device access, native storage failures, and Android backup/restore behavior
still need device verification. iOS Keychain data may survive app uninstall; uninstall must not be
treated as logout or proof of server revocation.

OTP verification sends `clientType: MOBILE`; browser cookie flows are not implemented by this library.
Enrolled-authenticator step-up keeps the new access token private to `BackendSession`, verifies the
same user/session and AAL2, and retains the current rotating refresh credential. Older concurrent
refresh completion cannot overwrite the step-up result. Access-context metadata is read from the
server; displaying it never authorizes an operation. New TOTP enrollment is available in the
development preview; see [enrollment semantics](mobile-mfa-enrollment.md).
[Password/TOTP sign-in](mobile-password-sign-in.md) is also available there. Managed-context
production-client flows remain open.
An OTP challenge's `deliveryState: ACCEPTED` does not establish message delivery or authentication.
Logout immediately removes local authentication. It returns `remoteRevocation: CONFIRMED` only after
HTTP 204; it returns `NOT_ATTEMPTED` without an in-memory session, and rejects if remote revocation
fails. Local logout alone is not evidence that the server session was revoked.

## Development preview

`src/App.tsx` lazily selects `src/components/backend/BackendPreview.tsx` when `__DEV__` is true and
`EXPO_PUBLIC_BACKEND_PREVIEW=1`. Enabled configuration requires a dedicated HTTPS origin and an
environment of `local`, `test`, or `staging`. Invalid enabled configuration displays an error.
Release builds disable the preview even when the flag is set; web reports `CLIENT.NATIVE_REQUIRED`.

The selected preview path does not initialize the legacy navigator/Supabase auth flow. Its separate
Zustand controller never populates the legacy/demo auth store. Authentication requires both a saved
session and a matching `ACTIVE` profile from `/api/v1/me`. A profile failure exposes explicit retry
and sign-out actions. OTP challenges, resend cooldowns, server `Retry-After`, duplicate presses, late
responses, and session revocation are handled without storing OTPs or tokens in the auth store.

The account preview now supports:

- verified profile, server-confirmed preference changes, notification pages and mark-read;
- support ticket creation, bounded ticket/message pages, versioned replies and resolved-ticket state;
- exact cash receipts and immutable completed-trip ratings;
- coverage/quotes, explicit transport/location consent, test booking creation and versioned cancellation;
- bounded booking/trip pages, timelines and explicitly labelled tracking snapshots;
- access-context metadata, enrolled-authenticator step-up and memory-only TOTP enrollment.

Each new page replaces the previous page. Logout/revocation unmounts the account panels and discards
their data. Forms remain a development acceptance surface, not the finished production mobile UX.
The preview performs explicit reads/retries; it has no automatic offline mutation queue.
[Requester realtime](../../backend-v2/docs/requester-realtime.md) invalidates a selected booking's
consistent recovery read. A fetched tracking snapshot is never advertised as continuously live.

### Launch

Prerequisites: a reachable approved non-production HTTPS backend, a test account/OTP delivery path,
and an installed SDK-compatible iOS or Android development binary containing SecureStore and Crypto.
SDK-compatible `expo-dev-client` is installed. `eas.json` defines internal `development` and iOS
`development-simulator` profiles. `.easignore` excludes backend files, dotenv/credential files, tests,
and generated artifacts from mobile build uploads. Authenticated EAS project linking, signing and
binary/device installation remain pending. With the approved EAS project/account configured:

```sh
EXPO_NO_DOTENV=1 npx eas-cli@latest build --profile development --platform android
EXPO_NO_DOTENV=1 npx eas-cli@latest build --profile development --platform ios
EXPO_NO_DOTENV=1 npx eas-cli@latest build --profile development-simulator --platform ios
```

These commands were not executed here; exports below are local JS/Hermes validation, not EAS builds.

Once the development binary is available, substitute the approved backend origin below and run:

```sh
EXPO_NO_DOTENV=1 \
EXPO_PUBLIC_BACKEND_PREVIEW=1 \
EXPO_PUBLIC_BACKEND_ORIGIN=https://api.example.test \
EXPO_PUBLIC_BACKEND_ENVIRONMENT=test \
npx expo start --dev-client
```

The example origin is a placeholder. These three public configuration values contain no credentials.
Reload the app after changing them; a production/release bundle cannot enable this preview.
`EXPO_NO_DOTENV=1` keeps existing dotenv files out of this launch path.

## Requests and UI integration rules

- Requests target `/api/v1/...` on the configured origin. They omit browser credentials, request
  no caching and reject redirects. Query parameters are encoded independently of path construction.
- Every response passes runtime decoding. Unknown lifecycle values, numerical money, malformed
  envelopes and incompatible product pages fail with `CLIENT.INVALID_RESPONSE`.
- Monetary minor units remain decimal integer strings, including beyond JavaScript's safe integer
  range. `formatNprMinor` renders them without floating-point conversion. Product lists have at most
  50 items and use `nextAfterId`, not the historical `nextCursor` field.
- Native commands use `expo-crypto.randomUUID()` at the intent boundary. `CommandIntent` snapshots
  body/key/version and coalesces duplicate presses. Successful commands cannot be resent. Explicit
  retries preserve the exact request and honor `Retry-After`; no mutation is automatically retried.
  Version `0` is valid for preference creation. Unknown outcomes lock the form against a new command.
  Only a definitive initial 400/403/404/412/422 backend rejection or `409 REQUEST.STALE_VERSION`
  permits correction (refresh the resource first). A later rejection
  cannot erase an earlier ambiguous outcome. At 23 hours (within the backend's default 24-hour
  retention), or on clock rollback, replay stops and requires reconciliation.
- Preview forms now use module-owned `DurableCommands` controllers for account, product and dispatch
  lanes. Each lane allows one unresolved intent per authenticated account. Payloads contain only
  allowlisted domain fields and a named operation; URLs, headers, credentials and callbacks are excluded.
  SecureStore keys bind origin, environment, user and lane. Large Unicode payloads use ASCII-escaped
  chunks of at most 1 KiB (64 chunks maximum), with a SHA-256 digest bound to command identity and scope.
  The manifest stays below 2 KiB, with a separate checksum covering its phase, ambiguity, retry
  timing and payload identity before any cleanup/replay decision. All values use device-only,
  unlocked-device Keychain accessibility.
- A `PREPARING` marker precedes payload writes; a `PENDING` manifest commits the complete request.
  Write-ahead ambiguity is acknowledged before HTTP dispatch. A `SETTLED` marker precedes deletion,
  so interrupted cleanup cannot resend confirmed work. Read/write failures block dispatch; malformed
  or incomplete pending records block replacement. A new process cleans only unsent preparation or
  settled payloads, never a pending request. Restoration itself never sends a mutation.
- Sign-out hides account data and retains unresolved secure intents for the same account's next verified
  sign-in. An account/session switch during persistence prevents dispatch under the successor identity.
  Explicit retries preserve original body/key/version and persisted `Retry-After`. After recovered
  confirmation, refresh the affected resource. Expired or corrupt unresolved requests remain blocked
  pending server-outcome reconciliation; there is no blind discard/reissue action. Real-device
  interruption, Keychain/Keystore durability and uninstall behavior still require acceptance evidence.
- Booking/trip lists now use `afterId` input and `nextCursor` output (at most 50, ascending ID) for
  requester, tenant and authority scopes. Product pages use `nextAfterId`. Timeline retains its
  per-aggregate `nextCursor: null` contract. Every page is freshly authorized; cursors convey no access.
- Only explicit `AUTH.ACCESS_TOKEN_EXPIRED` / `AUTH.ACCESS_TOKEN_STALE` guard rejections permit one
  refresh and replay. These backend guard errors occur before the handler. Other 401s clear the
  local session. 403, stale version, rate limits, validation errors and network failures do not
  trigger automatic mutation retries. `retryable` and `Retry-After` are advisory, not replay permission.
- For 409, refetch and reconcile with the user's intent. For 403/step-up, present the permission or
  assurance requirement. For cancellation/timeouts, avoid inventing successful work. Cancellation
  of one waiter does not cancel shared token rotation.
- Self product methods do not accept a user ID or tenant selector. Support replies return metadata;
  message content uses the separately authorized messages endpoint. In-app notification facts do
  not imply external delivery.

## Executed checks

- Root mobile typecheck: PASS. `tsconfig.json` now excludes the separately configured `backend-v2`
  project; this resolves the earlier Expo/backend configuration collision.
- Root `EXPO_NO_DOTENV=1 npm run lint`: PASS. Backend files are checked by their own ESLint config.
- Targeted API library/test ESLint: PASS, zero warnings.
- `npm run test:unit`: PASS, 128 tests, including 72 backend transport/session/product/command/native-auth
  cases. The dispatch tests decode actual backend projection functions. Existing Node
  module-type warnings remain informational; no root package module-mode change was made.
- Expo config introspection: PASS. Android manifest references both SecureStore backup resources;
  iOS has no Face ID permission. Introspection generated no native project files.
- `expo export --dev --platform all` and `expo export --platform all`: PASS for Android, iOS, and web.
  Release exports generated native Hermes bytecode. Development exports resolve the native runtime on
  Android/iOS and the refusal adapter on web. Both used an isolated CLI home, disabled dotenv loading,
  offline/telemetry-disabled CLI settings, and only synthetic public backend configuration. Outputs
  are temporary local artifacts, not published builds or updates.
- Independent backend lint and typecheck: PASS during the earlier mobile API-library continuation.
- Dependency audit at the high/critical threshold: PASS. The updated mobile lockfile still reports
  10 moderate transitive Expo CLI/config/glob/minimatch findings. npm's suggested forced downgrade to
  Expo 51 is incompatible with this SDK 58 app and was not applied; upstream-compatible remediation
  remains tracked for release review. Backend production dependency audit reports zero vulnerabilities.
- Remote mobile CI at `9117464`: PASS, including clean installation, lint, typecheck, unit tests,
  high/critical audit and development/release exports. The lockfile now includes the optional emnapi
  peers required by npm 12; the previous npm 11-only local installation had not exposed their absence.
- Durable-command fault injection covers every initial-write and settlement mutation boundary, lost
  responses, byte-bounded Nepali payloads, changed/missing chunks, account isolation, logout during a
  native write, late responses after account switching, corrupt manifest metadata, oversized retry
  headers, restart without dispatch, retry deadlines and ambiguity preservation. These are injected
  storage tests, not evidence of native crash consistency.
- Local development and release exports with durable recovery: PASS for Android, iOS and web,
  using synthetic API configuration and outputs outside the repository.

`EXPO_NO_DOTENV=1 npx expo install --check`: PASS after aligning all six mismatches and installing
SDK-compatible SecureStore, DevClient and Crypto:

| Package                | Installed | Expected by Expo check |
| ---------------------- | --------- | ---------------------- |
| `expo`                 | `58.0.22` | `~58.0.22`             |
| `expo-location`        | `58.0.20` | `~58.0.20`             |
| `expo-splash-screen`   | `58.0.12` | `~58.0.12`             |
| `expo-status-bar`      | `58.0.4`  | `~58.0.4`              |
| `react-native`         | `0.88.1`  | `0.88.1`               |
| `react-native-screens` | `4.30.1`  | `~4.30.1`              |

Tests exercise parallel and late refresh rejections, logout/storage races, ambiguous rotation,
revocation, one-retry bounds, command identity preservation, cancellation, bounded pages, exact
money, malformed responses, requester preconditions, vault isolation/corruption, OTP throttling and
ambiguity, active-profile matching, and auth-store teardown. They use synthetic credentials and
injected fetch/SecureStore implementations. Bundling and config introspection do not establish native
binary compilation, live server behavior, secure-storage durability, redirect/abort/cache behavior
on React Native, accessible device interaction, or end-to-end persona acceptance.

## Remaining integration

Complete EAS project/signing/device installation and native/live preview acceptance. Integrate the
preview capabilities into approved production screens, managed-context selection, administrative
password/MFA enrollment, realtime reconnect, native command-recovery acceptance and offline UX. The default app's
authentication and demo/driver flows still require deliberate reconciliation with these backend
capabilities. Direct Supabase writes require the roadmap's one-writer/minimum-version cutover controls.

See [Phase 6 status](../../backend-v2/docs/phase-6-status.md) for infrastructure, provider, portal,
security-review and release blockers. Gates 2–8 remain HOLD; offline migration/cutover preparation is
tracked in [overall delivery status](implementation-status.md).
