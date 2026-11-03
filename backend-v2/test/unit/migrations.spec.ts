import { MIGRATIONS, MIGRATION_CHECKSUMS } from '../../migrations/catalog.js';
import { GOVERNANCE_CONTROL_SQL } from '../../migrations/1793664000000-create-governance-control.js';
import { GOVERNANCE_DELIVERY_SQL } from '../../migrations/1793664000001-create-governance-delivery.js';
import { IDENTITY_ACCESS_SQL } from '../../migrations/1793664000002-create-identity-access.js';
import { PROVIDER_OPERATIONS_SQL } from '../../migrations/1793664000003-create-provider-operations.js';
import { CORE_DISPATCH_SQL } from '../../migrations/1793664000004-create-core-dispatch.js';

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

  it('contains atomic dispatch, named lifecycle, relationship-bound tracking, and safety controls', () => {
    expect(CORE_DISPATCH_SQL).toContain('dispatch.start_booking_search');
    expect(CORE_DISPATCH_SQL).toContain('dispatch.accept_offer');
    expect(CORE_DISPATCH_SQL).toContain('dispatch.transition_trip');
    expect(CORE_DISPATCH_SQL).toContain('dispatch.cancel_booking');
    expect(CORE_DISPATCH_SQL).toContain('tracking.ingest_location_point');
    expect(CORE_DISPATCH_SQL).toContain('safety.escalate_unacknowledged');
    expect(CORE_DISPATCH_SQL).toContain('FORCE ROW LEVEL SECURITY');
    expect(CORE_DISPATCH_SQL).toContain('statement_timestamp()');
    expect(CORE_DISPATCH_SQL).toContain("CONSTRAINT coverage_currency CHECK (currency = 'NPR')");
    expect(CORE_DISPATCH_SQL).toContain("CONSTRAINT fare_quote_currency CHECK (currency = 'NPR')");
    expect(CORE_DISPATCH_SQL).toContain('dispatch.cancellation_actor_class');
    expect(CORE_DISPATCH_SQL).toContain(
      'selected_actor_class IS DISTINCT FROM resolved_actor_class',
    );
    expect(CORE_DISPATCH_SQL).toContain(
      'SELECT * INTO trip FROM dispatch.trips WHERE id = selected_trip_id FOR UPDATE',
    );
    expect(CORE_DISPATCH_SQL).toContain(
      'IF target_tier IS NULL OR target_tier < incident.escalation_tier',
    );
    expect(CORE_DISPATCH_SQL).toContain("RETURN 'STALE_SEQUENCE'");
    expect(CORE_DISPATCH_SQL).toContain("state IN ('ENQUEUEING','ENQUEUED','RUNNING')");
    expect(CORE_DISPATCH_SQL).toContain(
      "selected_user_id = governance.current_setting_uuid('app.user_id')",
    );
    expect(CORE_DISPATCH_SQL).toContain(
      "tenant_id IS NULL AND stream_type NOT IN ('bookingDispatch','trip','safetyIncident')",
    );
    expect(CORE_DISPATCH_SQL).toContain('dispatch.principal_can_write_trip_delivery');
    expect(CORE_DISPATCH_SQL).toContain("event_type = 'trip.cancelled.v1'");
    expect(CORE_DISPATCH_SQL).toContain(
      "resource_type NOT IN ('booking','dispatchOffer','trip','safetyIncident')",
    );
    expect(CORE_DISPATCH_SQL).toContain("job_type NOT LIKE 'dispatch.%'");
    expect(CORE_DISPATCH_SQL).toContain("job_type NOT LIKE 'safety.%'");
    expect(CORE_DISPATCH_SQL).not.toMatch(
      /tenant_id IS NULL AND governance\.current_setting_uuid\('app\.user_id'\) IS NOT NULL/,
    );
    expect(CORE_DISPATCH_SQL).not.toMatch(/DROP\s+(?:TABLE|SCHEMA)/i);
  });
});
