# Password and TOTP mobile sign-in

Implemented in the opt-in development preview, 2026-11-04. Production client migration remains 0%.

## Protocol

1. Select **Use password and authenticator**. `POST /api/v1/auth/password-sessions` sends
   `{ identifier, password, clientType: "MOBILE" }`. The identifier is trimmed and bounded to
   3–320 characters. The password is 12–1024 characters and is never trimmed.
2. The client accepts only `{ challengeId, expiresAt, nextStep: "TOTP" }`. Password acceptance
   creates no local session. The backend requires an ACTIVE administrative identity and an
   existing verified TOTP factor; invalid credentials or missing enrollment remain server errors.
3. `POST /api/v1/auth/mfa-challenges/:challengeId/verifications` sends `{ code }`, six decimal
   digits. The response must contain a complete mobile session with AAL2 and valid access/refresh
   credentials. AAL1, browser/access-only, malformed or expired responses cannot establish login.
4. Refresh credentials are saved before the access token is usable. The controller requires a
   matching ACTIVE `/api/v1/me` profile before entering authenticated UI. Profile failure permits
   explicit profile-only retry or logout; it never repeats password/TOTP verification.

## Ownership, cancellation and retries

- Passwords, identifiers and codes stay out of the canonical auth store and refresh vault. The
  form clears password/code fields on submission and background/blur; access tokens remain in
  the session owner. JavaScript/native memory erasure is not claimed.
- Duplicate presses issue one request. Switching methods or restarting a pending challenge drops
  its local identity. Method changes during a request are blocked. Server `Retry-After` survives
  method changes; an expired challenge or clock rollback prevents verification dispatch.
- An idle TOTP challenge survives authenticator app switching. Background/blur or form cleanup
  during password dispatch, verification or profile loading aborts the request and signs out
  locally. Late responses cannot restore login. Cleanup after successful authentication keeps
  the established session. A request already accepted by the server may still have completed;
  local cancellation does not confirm remote revocation.
- Definitive HTTP 401 `AUTH.MFA_INVALID` allows code correction while the challenge is still
  current. HTTP 429 `RATE_LIMIT.EXCEEDED` retains the challenge but blocks early retries. Attempt
  exhaustion, malformed responses, transport failure or ambiguous outcomes drop the challenge.
  Password/TOTP POSTs never automatically refresh or replay.
- Cancellation during a native write queues clearing behind it, preventing later restoration of
  the cancelled credentials. Session clearing captures ownership and queues storage before
  synchronous identity listeners run. Store listeners cannot dispatch work after cancellation.

## Evidence

Fifteen added mobile cases exercise these boundaries using the real transport/session/controller
and synthetic HTTP/native-storage fixtures. The complete mobile suite passes **167 tests**, lint
and typecheck locally. CI outcomes are recorded in
[the evidence document](../../backend-v2/docs/ci-evidence-2026-11-03.md).

Physical-device password-manager/autofill, authenticator switching, accessibility, native process
death and live staging acceptance remain open. This preview does not supply the production
administrative portal, recovery-factor management or managed-context workflows.
