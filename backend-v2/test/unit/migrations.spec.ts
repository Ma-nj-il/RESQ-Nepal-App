import { MIGRATIONS, MIGRATION_CHECKSUMS } from '../../migrations/catalog.js';
import { GOVERNANCE_CONTROL_SQL } from '../../migrations/1793664000000-create-governance-control.js';
import { GOVERNANCE_DELIVERY_SQL } from '../../migrations/1793664000001-create-governance-delivery.js';
import { IDENTITY_ACCESS_SQL } from '../../migrations/1793664000002-create-identity-access.js';
import { PROVIDER_OPERATIONS_SQL } from '../../migrations/1793664000003-create-provider-operations.js';

describe('migration artifacts', () => {
  it('uses stable SHA-256 checksums for every ordered migration', () => {
    const names = MIGRATIONS.map((Migration) => new Migration().name);
    expect(Object.keys(MIGRATION_CHECKSUMS)).toEqual(names);
    expect(new Set(Object.values(MIGRATION_CHECKSUMS)).size).toBe(names.length);
    for (const checksum of Object.values(MIGRATION_CHECKSUMS)) {
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('contains synchronization, RLS, outbox/inbox, and durable job-intent controls', () => {
    const sql = `${GOVERNANCE_CONTROL_SQL}\n${GOVERNANCE_DELIVERY_SQL}`;
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('governance.outbox_events');
    expect(sql).toContain('governance.inbox_messages');
    expect(sql).toContain('governance.job_intents');
    expect(sql).toContain('governance.event_stream_sequences');
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|SCHEMA)/i);
  });

  it('contains identity, refresh rotation, RBAC hierarchy, authority, and tenant RLS controls', () => {
    expect(IDENTITY_ACCESS_SQL).toContain('identity.refresh_tokens');
    expect(IDENTITY_ACCESS_SQL).toContain('access_control.role_profile_roles');
    expect(IDENTITY_ACCESS_SQL).toContain('access_control.access_assignments');
    expect(IDENTITY_ACCESS_SQL).toContain('access_control.authority_grants');
    expect(IDENTITY_ACCESS_SQL).toContain('FORCE ROW LEVEL SECURITY');
    expect(IDENTITY_ACCESS_SQL).toContain('access_assignments_one_active_user_tenant_idx');
    expect(IDENTITY_ACCESS_SQL).not.toMatch(/DROP\s+(?:TABLE|SCHEMA)/i);
  });

  it('contains provider segregation, facility-exact authority, readiness, and private document controls', () => {
    expect(PROVIDER_OPERATIONS_SQL).toContain('approve_provider_application');
    expect(PROVIDER_OPERATIONS_SQL).toContain('authority_allows_facility');
    expect(PROVIDER_OPERATIONS_SQL).toContain('authority_allows_driver');
    expect(PROVIDER_OPERATIONS_SQL).toContain('refresh_ambulance_readiness');
    expect(PROVIDER_OPERATIONS_SQL).toContain('documents.document_objects');
    expect(PROVIDER_OPERATIONS_SQL).toContain('FORCE ROW LEVEL SECURITY');
    expect(PROVIDER_OPERATIONS_SQL).toContain(
      'application.applicant_user_id = selected_reviewer_user_id',
    );
    expect(PROVIDER_OPERATIONS_SQL).not.toMatch(/DROP\s+(?:TABLE|SCHEMA)/i);
  });
});
