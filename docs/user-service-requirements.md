# User Service Requirements

Status date: 2026-11-04

## Scope

The user service owns rider account registration, authentication, sessions, profile data,
password management, recovery, and self-service account lifecycle. Ambulance booking,
dispatch, cancellation, ratings, payments, notifications, driver operations, and KYC review
belong to other services and are outside this document.

Status values:

- `Complete`: implemented end to end and covered by executable verification.
- `Backend complete`: API is implemented; mobile integration or final contract evidence is pending.
- `Deferred external`: requires credentials or an external provider and must not be presented as active.

## Functional Requirements

| ID | Requirement | Acceptance criteria | Status |
|---|---|---|---|
| USR-FR-001 | Rider registration | Canonical email and Nepali E.164 phone create one rider; names are 1-100 characters; password is 8-72 bytes; terms version is recorded; duplicate email/phone returns `409`; public role escalation is rejected. | Complete |
| USR-FR-002 | Email/password login | Valid active credentials return a 15-minute access token, opaque refresh token, sanitized user, and session metadata; invalid credentials return one generic `401`; deactivated accounts return a stable `403`. | Complete |
| USR-FR-003 | Persistent session restore | Remembered sessions last at most 30 days; non-remembered sessions at most 24 hours; expired access tokens rotate through a valid refresh token without losing the user session. | Complete |
| USR-FR-004 | Refresh rotation | Each refresh token is single-use and stored only as SHA-256; successful refresh replaces it and returns a new access/refresh pair; revoked or expired tokens return `401`. | Complete |
| USR-FR-005 | Current-session logout | Logout revokes the server session immediately and removes local credentials; the old access and refresh credentials cannot call protected user-service endpoints. | Complete |
| USR-FR-006 | Read own profile | An authenticated active account can read only its own sanitized profile; password hash and auth internals are never returned. | Complete |
| USR-FR-007 | Update own profile | First name, last name, Nepali phone, and profile-image URL can be patched; phone changes require the current password; duplicate phone returns `409`; role/status/email cannot be changed here. | Complete |
| USR-FR-008 | Change password | Current password is required; new password is 8-72 bytes and differs from the old password; all other sessions are revoked immediately. | Complete |
| USR-FR-009 | Generate recovery codes | An authenticated user who confirms the current password receives ten cryptographically random one-time recovery codes; only bcrypt hashes are stored and regeneration invalidates old codes. | Complete |
| USR-FR-010 | Recover password with code | Email, one unused recovery code, and a valid new password reset the password atomically, consume the code, and revoke every session; replay returns `401`. | Complete |
| USR-FR-011 | List active sessions | The user can list only their non-revoked, non-expired sessions with current-device flag, device name, IP, user agent, and timestamps; no token/hash is returned. | Complete |
| USR-FR-012 | Revoke one session | A user can revoke only a session they own; another user's or unknown ID returns `404`; revocation is effective on the next request. | Complete |
| USR-FR-013 | Revoke all sessions | Current-password confirmation revokes all sessions, including the current session, and signs the app out. | Complete |
| USR-FR-014 | Deactivate account | Current-password confirmation changes the account to deactivated, marks it inactive, increments auth version, and revokes every session. | Complete |
| USR-FR-015 | Reactivate account | Correct email/password may reactivate only a self-deactivated account and create a fresh session; active accounts return `409`; deleted accounts cannot reactivate. | Complete |
| USR-FR-016 | Delete account | Current-password confirmation anonymizes direct PII, clears profile image and recovery codes, invalidates the password, marks the account deleted, and revokes all sessions while preserving referenced operational records. | Complete |
| USR-FR-017 | Immediate authorization state | Every protected user-service request validates JWT signature, issuer, audience, subject, session ID, session revocation/expiry, auth version, and active account state. | Complete |
| USR-FR-018 | Authentication audit history | Registration, login success/failure, refresh, logout, password, recovery, revocation, deactivation, reactivation, and deletion create audit events without passwords or raw tokens. | Complete |

## External Functional Deferrals

| ID | Requirement | Reason and safe behavior |
|---|---|---|
| USR-EXT-001 | SMS phone verification | Requires an SMS provider. The production UI must not claim delivery until configured. |
| USR-EXT-002 | Email verification/reset delivery | Requires an email provider and verified sending domain. Provider-free recovery codes remain available. |
| USR-EXT-003 | Google/social login | Requires OAuth client credentials and callback configuration. Existing controls must remain explicitly unavailable. |
| USR-EXT-004 | Automated identity/KYC verification | Requires an authorized reviewer or external KYC provider and is not an auth-service responsibility. |
| USR-EXT-005 | Binary avatar upload/CDN | Requires a reviewed media-storage policy. The service currently supports a bounded profile-image URL only. |

## Non-Functional Requirements

| ID | Requirement | Measurable acceptance criteria | Status |
|---|---|---|---|
| USR-NFR-001 | Transport security | Production mobile configuration rejects non-HTTPS API URLs; bearer credentials are accepted only through `Authorization`, never query strings. | Complete |
| USR-NFR-002 | Password security | Passwords are 8-72 bytes, bcrypt hashed, omitted from JSON, never logged, and required again for sensitive operations. | Complete |
| USR-NFR-003 | Token security | Access JWT uses HS256 allowlist, rotating `kid`, issuer, audience, subject, session ID, JTI, issued/not-before/expiry claims, and a 15-minute lifetime. | Complete |
| USR-NFR-004 | Revocation latency | Session/account revocation is checked from PostgreSQL on every protected user-service request and is effective in under one request round trip. | Complete |
| USR-NFR-005 | Client credential storage | Native credentials use Expo SecureStore; non-remembered sessions are memory-only; web does not persist access or refresh credentials. | Complete |
| USR-NFR-006 | Validation and integrity | Server canonicalization is authoritative; database unique indexes and transactions protect concurrent writes; stable conflict/validation codes are returned. | Complete |
| USR-NFR-007 | Privacy | Responses omit password/session hashes; ordinary logs redact authorization, password, token, secret, code, cookie, and API-key fields; deletion removes direct PII. | Complete |
| USR-NFR-008 | Abuse resistance | Login, registration, refresh, and recovery endpoints enforce documented per-IP/account rate limits and return `429` with retry guidance. | Pending |
| USR-NFR-009 | Availability | Liveness and database readiness endpoints exist; request timeout is bounded; mobile restore distinguishes revocation from temporary network failure. | Complete |
| USR-NFR-010 | Performance | At 50 concurrent clients, profile/session p95 is below 200 ms and bcrypt-backed login/register p95 below 750 ms excluding network. | Pending measurement |
| USR-NFR-011 | Observability | Every error includes a correlation ID; structured logs and audit events contain no secrets; auth endpoint status/latency can be measured. | Complete |
| USR-NFR-012 | Authorization isolation | Profile, session, password, and lifecycle operations derive user identity from validated claims and enforce repository ownership. | Complete |
| USR-NFR-013 | API compatibility | `/api/v1` keeps the success/error envelope and legacy `token` during migration; Postman covers all public contracts and negative cases. | Complete |
| USR-NFR-014 | Accessibility and usability | Auth/account controls have labels, loading state, inline field errors, password-manager hints, and actionable recovery states on Android, iOS, and web. | Complete |
| USR-NFR-015 | Automated assurance | Backend service logic, API contract, mobile client, secure restore/logout, and account screens have automated positive and negative tests; lint, typecheck, Expo Doctor, Go tests, and web export pass. | Complete |
| USR-NFR-016 | Configuration safety | Production startup requires non-placeholder signing material and HTTPS; core auth has no dependency on SMS, email, Supabase, or object-storage credentials. | In progress |

## Definition of Done

The provider-free user service is complete when `USR-FR-001` through `USR-FR-018`
work from both Postman and the mobile UI, all non-deferred controls avoid false success,
and completed NFRs have executable evidence. External requirements remain hidden or
explicitly unavailable until their providers are configured. Pending NFRs are production
release gates, not hidden functional behavior.

## Verification Evidence

- Go auth and middleware tests: passing.
- Go vet for auth, auth command, and middleware: passing.
- Postman/Newman user-service contract: 38 requests and 76 assertions passing.
- Mobile unit suite: 71 tests passing.
- Expo lint and TypeScript strict checks: passing.
- Expo Doctor: 20/20 checks passing.
- Expo web production export: passing.
- Live service readiness: PostgreSQL reported healthy.

## Remaining Production NFR Gates

- `USR-NFR-008`: deploy and test distributed rate limiting for login, registration,
  refresh, and recovery endpoints.
- `USR-NFR-010`: run the documented 50-client load test and retain p95 evidence.
- `USR-NFR-016`: provision production signing-key persistence and verify startup failure
  for placeholder or unsafe deployment configuration.
