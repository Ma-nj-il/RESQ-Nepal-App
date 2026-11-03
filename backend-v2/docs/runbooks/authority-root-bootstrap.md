# Root authority grant bootstrap runbook

## Purpose and hard boundary

A parentless platform authority grant is the trust root for subsequent bounded authority delegation.
The API and application database role reject parentless grants. A root grant may be created only by a
reviewed, checksummed, forward-only migration executed by the separately authorized migration job.
This runbook is not authorization to create one.

Never create a root grant from an API route, interactive production SQL session, seed script, generic
administrator bypass, or by temporarily disabling RLS/triggers.

## Required approvals and inputs

Before preparing the migration, record:

- change/release ID, source revision, migration checksum, environment, and execution window;
- one issuer, one subject, and one independent approver — three distinct active canonical users;
- accountable security and platform-engineering approval, plus the authority/business owner;
- exact system role profile, permission codes, resource classes, purpose, human reason, and expiry;
- whether PII, document content, export, and intervention are each required (default `false`);
- managed migration identity, backup/PITR evidence, monitoring owner, and rollback/forward-fix owner.

The grant must be AAL2-only, time-bounded, national only when explicitly approved, and no broader
than the minimum bootstrap duty. Indefinite or wildcard permission/resource grants are prohibited.

## Migration design checklist

1. Add a uniquely named forward-only migration; do not edit a migration that has run anywhere.
2. Assert the expected prior migration and all three users are active and distinct.
3. Assert the selected system role profile is active, has `PLATFORM_GRANT` scope, and resolves exactly
   the approved active permissions.
4. Insert the parentless grant with `parent_grant_id` and `approved_under_grant_id` null, the named
   independent approval evidence populated, and `status = 'ACTIVE'`.
5. Insert the exact permission and resource rows. For national scope, insert no geography row;
   otherwise insert the exact reviewed geography set.
6. Let the deferred well-formedness constraint run before commit. Do not disable any guard.
7. Insert immutable security audit evidence containing only safe change IDs/reasons, never secrets.
8. Include read-only postconditions that prove one expected row, scope, expiry, profile permissions,
   and active-chain resolution. Abort on any difference.

The migration must contain fixed reviewed IDs/values or consume a signed release artifact through an
approved mechanism. It must not read unconstrained environment values or choose users by mutable
display names.

## Rehearsal and execution

1. Rehearse from an empty database and a sanitized prior-version snapshot using production-equivalent
   roles and PostgreSQL version.
2. Prove the application role still cannot create a parentless grant or execute internal scope
   functions.
3. Prove an unrelated user cannot read/use the root and that scope/expiry checks fail closed.
4. Run backup/PITR prechecks, acquire the standard migration advisory lock, verify prior checksums,
   and execute once through release automation.
5. Capture migration result/checksum, row-level postconditions, audit ID, operator/workload identity,
   timestamps, and database logs. Do not capture credentials or MFA/token material.
6. Have the subject perform a fresh administrative login and step-up; verify only the approved
   authority context appears.

## Failure and revocation

- Before commit, any failed assertion rolls back the transaction.
- After commit, do not edit history or run a down migration. Revoke the grant using a separately
  authorized emergency authority path if available; otherwise use a reviewed compensating migration
  that records revoker, reason, and credential invalidation.
- Treat unexpected scope, subject, approval, or visibility as a security incident. Disable affected
  access, preserve audit/database evidence, rotate exposed credentials if relevant, and reconcile all
  descendants before restoring authority operations.
- Expiry is not cleanup evidence. Confirm descendant grants are unusable and retain records according
  to the approved security/audit schedule.

## Evidence record

```text
Environment/release/change ID:
Source revision and migration checksum:
Expected prior migration/checksum:
Issuer / subject / independent approver user IDs:
Profile / permissions / resources / geography / capabilities:
Valid from / expires at:
Security approval:
Platform approval:
Authority owner approval:
Rehearsal report:
Backup/PITR evidence:
Execution operator and timestamps:
Postcondition and negative-test report:
Audit event ID:
Decision: APPROVED | HOLD | REVOKED
```
