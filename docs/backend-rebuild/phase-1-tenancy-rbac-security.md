# Phase 1 — tenancy, RBAC, and security

## 1. Terminology

| Term | Meaning |
|---|---|
| Principal | A human user or non-human workload with an authenticated identity |
| Tenant | One provider organization operating ambulance services |
| Facility | A hospital or operating base owned by one tenant |
| Membership | A principal's relationship to a tenant/facility |
| Permission | One atomic action code, such as `trip.transition` |
| Role | A named set of permissions |
| Role profile | One or more roles plus an allowed scope ceiling and policy conditions |
| Access assignment | Assignment of one role profile to one user in one operational scope |
| Authority grant | Explicit province/platform authorization to inspect or act across tenant boundaries |
| Request context | Server-resolved principal, session, tenant/facility/authority scope, and trace metadata |

The required hierarchy is implemented literally:

```text
Permissions ──many-to-many──► Roles
Roles       ──many-to-many──► Role Profiles
Role Profiles ──assigned through scoped access assignments──► Users
```

Users never receive ad hoc permissions directly. This keeps review, comparison, versioning, and
revocation tractable.

## 2. Tenant and facility model

### 2.1 Tenant root

A provider organization is the tenant root. Examples include a single independent hospital, a
hospital network, or an ambulance operator. A facility belongs to exactly one provider organization.
A single-facility provider still has an organization row and one facility row.

This avoids two failure modes:

- treating a province as a tenant would mix government oversight with provider operations;
- treating every hospital as a tenant would make a multi-facility provider share users, fleet, and
  reporting through unsafe cross-tenant exceptions.

### 2.2 Request context classes

| Context | Tenant required? | Resource access |
|---|---:|---|
| Patient/self | No | Own profile, service requests, assigned trip projection, own documents/support |
| Tenant operator | Yes | Assigned tenant and allowed facilities only |
| Driver/crew | Yes | Own workforce identity and assigned facility/trip resources |
| Province authority | No tenant impersonation | Only resources matched by active province grant |
| Platform authority | No tenant impersonation | Only grant-listed actions/resources; national scope if explicitly approved |
| Workload | Explicit per message/job | Narrow service identity plus event/job tenant scope |

A global patient service request is not exposed as a global provider work queue. Dispatch creates a
separate tenant-owned offer for each eligible provider. A provider can read only its own offer and
the minimum request projection needed to respond. Once accepted, the assignment and trip are
tenant-owned.

## 3. Context resolution

1. Verify access JWT signature, issuer, audience, expiry, key ID, and session identifiers.
2. Resolve the server-side session and token version; reject revoked, expired, or risk-blocked
   sessions.
3. For tenant routes, read the requested tenant selector (`X-Tenant-Id`) and resolve it against the
   user's active access assignments. The header selects among authority the user already has; it
   grants nothing.
4. If a facility is selected, verify it belongs to that tenant and is inside the assignment's
   facility scope.
5. For authority routes, resolve an `X-Authority-Grant-Id` when needed and verify subject, validity,
   geography, actions, resource classes, purpose, and revocation.
6. Load the role-profile version and effective permission projection. Stale or missing projections
   fall back to PostgreSQL or deny.
7. Freeze the result in `RequestContext`; ignore `tenantId`, `facilityId`, `userId`, or authority
   claims in a body when determining ownership.
8. Start the scoped PostgreSQL transaction and set local RLS claims.

Public/self endpoints do not accept a tenant selector. Authority endpoints never switch the actor
into a tenant member and never use an unrestricted “all tenants” repository method.

## 4. PostgreSQL isolation

### 4.1 Data ownership classes

Every table is assigned one reviewed class:

| Class | Examples | Required keys |
|---|---|---|
| Global reference | provinces, districts, permission catalog | no tenant key; read policy is explicit |
| Principal-owned | users, auth sessions, own preferences | `user_id` and subject policy |
| Platform workflow | service requests before assignment, provider applications | owning principal plus purpose-specific access policy |
| Tenant-owned | facilities, fleet, workforce, offers, assignments, trips, tenant reports | `tenant_id NOT NULL` |
| Facility-owned | ambulances, facility staff, maintenance | `tenant_id NOT NULL`, `facility_id NOT NULL` |
| Authority-visible | provider review, compliance queues, audit projections | underlying owner key plus grant-mediated query |
| Telemetry | trip locations, device health | tenant/trip/assignment key, time partition, retention |

There is no convention where `tenant_id IS NULL` silently means “platform-wide.” Deliberately global
tables are modeled and reviewed as global. Polymorphic scope records use a checked `scope_type` and
matching required key shape.

### 4.2 Structural constraints

- Tenant-owned tables use a composite candidate key such as `UNIQUE (tenant_id, id)`.
- Cross-table references carry the tenant key:

  ```sql
  FOREIGN KEY (tenant_id, facility_id)
    REFERENCES facilities (tenant_id, id)
  ```

- Facility-owned child rows similarly reference `(tenant_id, facility_id, parent_id)` where
  practical.
- Unique business identifiers are scoped correctly, for example
  `(tenant_id, normalized_plate_number)` rather than a global plate assumption unless Nepal policy
  requires and validates global uniqueness.
- Assignment uniqueness is enforced in PostgreSQL with partial unique indexes, not a Redis lock.
- Tenant/facility ownership columns cannot be updated through ordinary domain commands. Moving a
  resource is a reviewed transfer workflow that records old/new ownership.

### 4.3 RLS execution

The application role does not own tables, is not superuser, and has no `BYPASSRLS`. Tenant tables
use `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Per request/worker transaction:

```sql
SELECT set_config('app.user_id', :user_id, true);
SELECT set_config('app.tenant_id', :tenant_id, true);
SELECT set_config('app.facility_scope', :facility_ids_json, true);
SELECT set_config('app.authority_grant_id', :grant_id, true);
SELECT set_config('app.correlation_id', :correlation_id, true);
```

Policies compare rows to these settings or call small stable authorization functions. Empty or
malformed settings deny. `SET LOCAL` plus a request transaction prevents pool leakage.

Only an offline migration/controlled break-glass role can bypass RLS. Background workers set an
explicit tenant for each job/event and use the normal policies. Reporting across tenants goes
through grant-aware functions/read models, never a service role with arbitrary SQL.

### 4.4 Repository rules

- Repository methods require `RequestContext`/unit of work and have scoped names.
- No production repository accepts a free-form tenant ID independent of that context.
- Raw SQL is isolated, parameterized, reviewed for tenant predicates and RLS behavior, and covered
  by cross-tenant negative tests.
- Bulk jobs split by tenant and record progress; one tenant's failure cannot expose or corrupt
  another tenant.
- Cache keys start with ownership class and opaque tenant/facility identifiers.

## 5. RBAC model

### 5.1 Core records

| Record | Important fields/invariants |
|---|---|
| `permissions` | immutable code, description, risk class, resource/action; retirement instead of reuse |
| `roles` | system or tenant owner, name, version, active state |
| `role_permissions` | role/permission link; reviewed mutations |
| `role_profiles` | system or tenant owner, name, scope ceiling, constraints, version, active state |
| `role_profile_roles` | composition link; cycles are impossible because roles do not contain profiles |
| `access_assignments` | user, profile, tenant, optional facilities, valid dates, grantor, status |
| `authority_grants` | subject, level, geography, resource/action allowlist, purpose, validity, approvals |

System templates can be cloned or used directly. Tenant custom roles/profiles cannot include a
permission or scope the creating administrator does not hold with delegation authority.

### 5.2 Scope lattice

```text
SELF < ASSIGNED_TRIP < FACILITY_SET < TENANT < PROVINCE_GRANT < PLATFORM_GRANT
```

This is not a blanket inheritance rule. A broader geography does not imply every action. Effective
access is the intersection of:

- permissions provided by active roles in the assigned profile;
- the role profile's scope ceiling and conditions;
- the assignment's tenant/facility scope and validity;
- any authority grant's geography, resource, action, purpose, and validity;
- actor-resource relationship and aggregate state;
- explicit policy denials, segregation-of-duty rules, and account/session state.

### 5.3 Authorization algorithm

For every protected use case:

1. Map the command/query to one required permission code.
2. Confirm active principal, session, access assignment/profile version, and MFA level when required.
3. Confirm the permission is in the role-profile projection.
4. Confirm the selected context is within the assignment's scope.
5. Load or lock the resource through a scoped repository; a missing out-of-scope resource returns
   the same `404` shape as a nonexistent resource where disclosure matters.
6. Evaluate resource relationship and lifecycle policy.
7. If crossing tenant boundaries, require a matching authority grant; no role name bypasses this.
8. Apply segregation of duties and step-up requirements.
9. Record allowed high-risk actions and all denied high-risk attempts with the decision basis.

Policy denials override grants. Controllers never compare strings such as `role === 'admin'`.

### 5.4 Initial permission catalog

The catalog is seeded and migration-controlled. Representative codes:

| Domain | Read | Mutate/high risk |
|---|---|---|
| Access | `access.assignment.read`, `access.role.read` | `access.assignment.manage`, `access.role.manage`, `access.authority.grant` |
| Provider | `provider.read`, `facility.read` | `provider.review`, `provider.suspend`, `facility.manage` |
| Workforce | `driver.read` | `driver.manage`, `driver.verify`, `driver.suspend` |
| Fleet | `ambulance.read`, `maintenance.read` | `ambulance.manage`, `ambulance.status.change`, `maintenance.manage` |
| Documents | `document.metadata.read`, `document.content.read` | `document.upload`, `document.review`, `document.invalidate` |
| Dispatch | `booking.read`, `dispatch.offer.read` | `booking.create`, `booking.cancel`, `dispatch.respond`, `dispatch.override` |
| Trips | `trip.read`, `tracking.read` | `trip.transition`, `trip.cancel`, `tracking.publish` |
| Safety | `safety.incident.read` | `safety.sos.create`, `safety.incident.manage` |
| Support | `support.ticket.read` | `support.ticket.create`, `support.ticket.manage`, `support.escalate` |
| Reporting | `report.tenant.read`, `report.province.read` | `report.export` |
| Governance | `audit.read` | `audit.export`, `session.revoke`, `breakglass.activate` |
| Finance | `fare.read`, `ledger.read` | `cash.record`, `payment.refund`, `settlement.manage` |

Separate content and metadata permissions are intentional for identity/compliance documents.

### 5.5 Baseline role profiles

These are seeded profiles, not hard-coded branches:

| Profile | Typical roles | Scope ceiling |
|---|---|---|
| Patient Self | profile owner, booking requester, support requester | self |
| Driver/Crew | driver self, trip crew, tracking publisher | self + assigned trip/facility |
| Facility Dispatcher | booking reader, dispatch responder, trip operator | assigned facilities |
| Facility Fleet Manager | fleet/document/maintenance operator | assigned facilities |
| Facility Administrator | tenant access delegator + facility operations | tenant, subject to delegation ceiling |
| Provincial Reviewer | provider/document reviewer | explicit province grant |
| Provincial Monitor | operational read/report/escalation | explicit province grant |
| Platform Support | support and narrow user/session assistance | explicit case/purpose grant |
| Platform Auditor | immutable audit/report reads | explicit platform/province grant, no mutation |
| Platform Security Owner | access/security administration | explicit high-risk grant + step-up + dual control |

“Platform Owner” is not an implicit superuser. Database migration and emergency break-glass access
are separate operational identities.

Bootstrap migrations seed permission codes and system role/profile templates, never a default user,
password, token, or permanent global grant. The first platform security assignment/grant is created
for an already verified MFA principal through a logged two-person operational ceremony with an
expiry/review date. Subsequent administration uses the normal delegation/dual-control policies;
break-glass remains separate, time-bounded, alerted, and reviewed after use.

## 6. Authority grants

An authority grant includes:

- grant ID, subject user, issuing authority, and approval chain;
- `PROVINCE` or `PLATFORM` level and geography root(s);
- allowed resource classes and action/permission codes;
- optional provider/facility inclusion or exclusion sets;
- case/ticket/purpose and human-readable reason;
- `valid_from`, `expires_at`, status, revocation actor/reason;
- whether export, document content, PII, intervention, or suspension is allowed;
- required MFA assurance and, for critical grants, a second approver.

Grants can only narrow a role profile; they cannot create a permission absent from it. National
scope is an explicit grant value, never inferred from `province_id = NULL`. Expiry and revocation
invalidate authorization caches and active privileged WebSocket subscriptions.

## 7. High-risk and segregation-of-duty policies

The following require recent MFA/step-up, a reason, and immutable audit:

- issue/revoke province or platform authority;
- manage roles/profiles or delegate access;
- approve, reject, or suspend a provider/facility;
- verify/invalidate identity or compliance documents;
- override dispatch, reassign an active trip, or force cancellation;
- view/download unmasked identity content;
- suspend a user, driver, or ambulance;
- refund/adjust money or change payout configuration;
- export PII or audit evidence;
- activate break-glass access.

The submitter cannot be the final approver for provider onboarding, their own access elevation,
document review where policy requires dual control, or financial adjustment above the approved
threshold.

## 8. Authentication and token rotation

### 8.1 Access tokens

- Asymmetric signing (`EdDSA` or `RS256`, finalized during implementation based on KMS support).
- Short lifetime, proposed 10 minutes for portals and 15 minutes for mobile.
- Required claims: `iss`, `aud`, `sub`, `sid`, `jti`, `iat`, `nbf`, `exp`, `kid` header,
  authentication assurance, and token/session version.
- Selected access-assignment/context identifiers may be claims for routing but are revalidated; the
  token does not embed a long-lived permission list.
- Public JWKS contains active and grace-period verification keys only. Private keys remain in
  KMS/secrets infrastructure and never on disk in the image.
- Rotation publishes a new key before signing with it, retains old public keys through maximum
  token lifetime plus clock skew, then retires them. Emergency compromise revokes the key and
  affected sessions.

### 8.2 Refresh-token families

- Refresh tokens are opaque CSPRNG values, not long-lived JWTs.
- Only a keyed HMAC digest of the high-entropy token and metadata are stored; raw values are returned
  once and are never recoverable from the database.
- Every refresh consumes one token and atomically issues a successor in the same family.
- Reuse of a consumed token revokes the entire family, records a security event, clears caches, and
  requires reauthentication.
- Sessions track device label, client type, IP/risk metadata, absolute expiry, idle expiry, last
  use, MFA assurance, and revocation.
- Logout revokes the current family; “log out all devices” increments user token version and revokes
  all families.

Mobile stores tokens in OS-protected secure storage. Browser portals use a secure, `HttpOnly`,
`SameSite` refresh cookie and keep short-lived access tokens out of persistent `localStorage`.
Cookie-authenticated endpoints enforce origin/CSRF controls.

### 8.3 Login and MFA

- Phone OTP is rate-limited by normalized phone, IP/device, and risk signal. Codes are CSPRNG,
  single-use, short-lived, hashed at rest, attempt-limited, and never logged.
- Administrative password credentials, if retained, use Argon2id with current reviewed parameters
  and breached-password controls.
- Administrative profiles require TOTP or WebAuthn-equivalent MFA; SMS is recovery/step-up only if
  policy accepts its risk.
- Recovery codes are individually hashed and one-time. MFA reset is a high-risk, dual-evidence
  workflow.
- Error messages and timing do not reveal whether a phone/email exists.

Legacy sessions, Supabase refresh tokens, Go JWTs, portal mock tokens, and browser local-storage
tokens are not migrated. Users reauthenticate at cutover.

## 9. Data protection

### 9.1 Classification

| Class | Examples | Controls |
|---|---|---|
| Public | facility directory, approved service categories | integrity, cache policy |
| Internal | operational aggregates, non-PII metrics | tenant scope, audit |
| Confidential | phone, patient details, trip locations, support messages | encryption, masking, least privilege, retention |
| Restricted | citizenship/licence documents, MFA secrets, provider credentials, payment tokens | field/object encryption, content permission, step-up, no logs |

### 9.2 Storage and transport

- TLS is required for all external and service connections; database/Redis/Kafka encryption and
  authentication are environment gates.
- Managed encryption at rest is supplemented by application/column encryption for selected
  restricted values, using versioned keys and associated data containing record purpose/ID.
- Private object keys are opaque and server-generated under an ownership-class prefix (tenant or
  principal/pre-tenant workflow). Presigned grants are short-lived, operation- and MIME-bound, and
  finalized only after size/hash/type checks and malware scanning.
- Original filenames and identity numbers are not used as object keys.
- Document downloads require content permission and produce an audit event. URLs are never written
  to logs or analytics.
- Data retention and deletion account for legal holds and append-only audit requirements; a delete
  request becomes a policy-driven erasure/anonymization workflow.

## 10. Audit model

Audit events are distinct from Pino application logs. They include:

- immutable event ID and UTC time;
- actor principal/session and authentication assurance;
- effective tenant/facility/authority grant and role-profile version;
- action, resource class/ID, before/after field summary or status transition;
- decision outcome and stable reason code;
- correlation/causation/trace IDs, source channel, and client/network metadata;
- human reason/ticket for high-risk actions;
- integrity hash chain or signed archive batch for tamper evidence.

Secrets, token values, full document content, and unnecessary patient details are excluded. Audit
tables are append-only to application roles, time-partitioned, exported to immutable retention, and
queried only through scope-aware projections.

## 11. Threat controls

| Threat | Required controls |
|---|---|
| Cross-tenant IDOR | server-derived context, scoped repositories, RLS, composite FKs, indistinguishable 404, negative tests |
| Confused deputy admin | explicit authority grant/purpose, no tenant impersonation, step-up, audit |
| Stolen refresh token | one-time rotation, family reuse detection, secure storage/cookie, device/session revocation |
| Double booking/acceptance | row lock or conditional update, unique active assignment, idempotency key |
| Replay/duplicate event | outbox ID, stream sequence, aggregate version, Kafka key, inbox deduplication |
| Fake/stale GPS | assignment/state binding, point ID/sequence/time checks, rate limits, quality derivation |
| Malicious file | presigned constraints, magic-byte/MIME check, hash, malware scan, quarantine |
| Provider webhook spoof | TLS, timestamped signature, replay window, idempotency, source policy where reliable |
| DVR SSRF/credential leak | fixed approved base URL, terminal allowlist, egress policy, secret manager, sanitized errors |
| Log leakage | Pino redaction, allowlisted fields, production stack suppression, log access controls |
| Privilege escalation | delegation ceiling, profile versioning, dual control, assignment expiry, cache invalidation |
| Enumeration/brute force | normalized identifiers, generic responses, Redis-backed layered limits, risk throttles |

Security acceptance cannot be inferred from code review alone. The required automated isolation,
authorization, token-reuse, race, file, and provider tests are specified in
[phase-1-operations-testing.md](./phase-1-operations-testing.md).
