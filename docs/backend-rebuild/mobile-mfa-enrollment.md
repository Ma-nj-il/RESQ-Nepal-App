# Mobile MFA enrollment

Status: implemented in the opt-in development preview, 2026-11-04. Production client migration
remains 0%; device and live-backend acceptance are pending.

## HTTP contract

- `POST /api/v1/me/mfa/totp-enrollments`, body `{ label }`, returns HTTP 201 with
  `{ factorId, sharedSecret, provisioningUri, expiresAt }`. `expiresAt` is the same UTC
  deadline stored for the pending encrypted factor. Adding another factor requires live AAL2.
- `POST /api/v1/me/mfa/totp-enrollments/:factorId/verification`, body `{ code }`, returns
  HTTP 200 with `{ userId, sessionId, assurance: "AAL2", accessToken, accessTokenExpiresAt }`.
  Factor IDs must be UUIDs and codes six decimal digits. The service checks ownership,
  expiry and one-time TOTP use, then verifies the factor and upgrades the current session
  transactionally. Responses issue no refresh credential or cookie.
- Both responses use `Cache-Control: private, no-store`. The normal success envelope applies.

## Mobile ownership

`runtime.security.createEnrollment()` creates a component-owned `MfaEnrollment`. The preview
connects it to token-free session notifications and native AppState. The setup key is manually
entered into an authenticator. Decoding validates a bounded Base32 key and discards provisioning
links. Setup secrets, codes and enrollment state are never persisted to the auth store, command
vault or refresh vault. Access credentials remain private to `BackendSession`.

- Background/inactive/blur hides the key and clears the code field. Foregrounding does not reveal
  a hidden key. Pending enrollment expires, including immediate expiry/clock-rollback checks on
  foregrounding or verification. Expiry removes the key.
- Session replacement, close, unmount and effect cleanup abort outstanding work and fence late
  responses. An old cleanup cannot dispose a newer effect connection. Starting/verification
  coalesce duplicate presses; subscribers cannot cause cancelled work to dispatch.
- Verification removes the key before dispatch. An unconfirmed verification enters `unknown`;
  it cannot replay or start another enrollment until explicitly closed. Separate authenticator
  step-up may confirm current access. Closing hides local state; it does not claim server revocation
  of a factor or cancellation of a request that already reached the server.
- Enrollment and step-up accept only matching-user/session AAL2 access credentials. They preserve
  the current refresh successor, waiting for concurrent rotation. Cancellation while waiting for
  rotation prevents applying the late enrollment access response. Shared refresh still completes.
- Only explicit stale/expired-access guard rejections can trigger the existing session's single
  refresh/retry path; ambiguous handler/network outcomes never trigger verification replay.

## Verification and outstanding acceptance

Mobile cases exercise key bounds/link exclusion, duplicate submission, background concealment,
expiry/rollback, session replacement, late cancellation, unknown outcomes, effect reconnect and
concurrent refresh successors. Backend service cases check stored expiry, existing-factor AAL2
and response identity; installed Nest HTTP cases check cache headers, serialization, access-only
responses and invalid inputs. These are synthetic tests with mocked application services for HTTP.

Manual setup on physical iOS/Android devices, actual app-switcher/accessibility behavior,
authenticator interoperability, native process death and end-to-end staging enrollment still
require acceptance. No claim of secure memory erasure or screenshot prevention is made.
