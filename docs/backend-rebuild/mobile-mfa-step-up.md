# Authenticated mobile MFA step-up

Implemented in the opt-in development preview, 2026-11-04. `runtime.security.createStepUp()`
creates a component-owned `MfaStepUp`; it stores challenge metadata and UI status only.

- Starting calls `POST /api/v1/auth/mfa-challenges` using the current session. Only a UUID/TOTP
  challenge with a future, bounded expiry is accepted. One start or verification may run at a time.
- An idle challenge survives switching to an authenticator. Background/blur clears the form's code,
  blocks dispatch and cancels in-flight work. Expiry timers plus foreground/dispatch clock checks
  discard unusable challenges. Unmount, close, account/session replacement and stale effect cleanup
  fence late responses. Ordinary access-token rotation for the same session preserves the challenge.
- Six-digit verification sends one `POST /api/v1/auth/mfa-challenges/:id/verifications`. The challenge
  leaves the snapshot before dispatch. Network/ambiguous outcomes become `unknown`; explicit close
  is required before starting another challenge. There is no automatic business-command replay.
- Definitive HTTP 401 `AUTH.MFA_INVALID` permits correction while the challenge is still valid.
  HTTP 429 `RATE_LIMIT.EXCEEDED` preserves it with a cooldown that survives close/restart. Exhausted
  attempts or expiry require a new challenge.
- Only the named step-up/enrollment session methods distinguish `AUTH.MFA_INVALID` from a revoked
  session. Other 401 failures retain the existing logout behavior. Explicit pre-handler expired/stale
  access rejection may use the existing single refresh/retry path; invalid-code responses never do.
- The session owner requires matching user/session AAL2 access credentials and preserves the current
  refresh credential. A pending older refresh must finish first; cancellation during that wait blocks
  the access upgrade while letting the shared refresh persist its successor. Logout on synchronous
  identity notification prevents a stale successful result from returning to the caller.

Successful verification confirms that response, not permanent authority. The server rechecks current
assurance, permissions, grants and resource relationships on subsequent operations. Local cancellation
does not undo verification already accepted by the backend.

Nine controller and three session regression cases cover lifecycle, duplicate presses, challenge bounds,
expiry/rollback, lost responses, retry limits, session replacement, refresh concurrency and listener
reentrancy. The complete mobile suite passes **179 tests**, lint and typecheck. Physical-device,
authenticator, accessibility, signed native builds and live staging acceptance remain pending.
