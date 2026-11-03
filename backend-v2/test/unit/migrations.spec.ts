import { MIGRATIONS, MIGRATION_CHECKSUMS } from '../../migrations/catalog.js';
import { GOVERNANCE_CONTROL_SQL } from '../../migrations/1793664000000-create-governance-control.js';
import { GOVERNANCE_DELIVERY_SQL } from '../../migrations/1793664000001-create-governance-delivery.js';

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
});
