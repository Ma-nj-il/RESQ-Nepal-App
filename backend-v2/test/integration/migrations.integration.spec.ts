import { randomBytes } from 'node:crypto';

import { Client } from 'pg';
import { DataSource } from 'typeorm';

import { CreateGovernanceControl1793664000000 } from '../../migrations/1793664000000-create-governance-control.js';
import {
  loadApplicationConfig,
  type ApplicationConfig,
} from '../../src/shared/infrastructure/config/application-config.js';
import {
  migrationDataSourceOptions,
  runMigrations,
} from '../../src/shared/infrastructure/persistence/migration-runner.js';

const integrationEnabled = process.env['RUN_INTEGRATION'] === '1';
const describeIntegration = integrationEnabled ? describe : describe.skip;

function databaseName(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

function withDatabase(urlValue: string, database: string): string {
  const url = new URL(urlValue);
  url.pathname = `/${database}`;
  return url.toString();
}

function integrationConfig(database: string, expectedCurrent?: string): ApplicationConfig {
  const migrationUrl = process.env['RESQ_MIGRATION_DATABASE_URL'];
  const applicationUrl = process.env['RESQ_DATABASE_URL'];
  if (migrationUrl === undefined || applicationUrl === undefined) {
    throw new Error('Integration database URLs are required');
  }
  return loadApplicationConfig(
    {
      ...process.env,
      NODE_ENV: 'test',
      RESQ_RELEASE: 'integration-test',
      RESQ_LOG_PRETTY: 'false',
      RESQ_DATABASE_URL: withDatabase(applicationUrl, database),
      RESQ_MIGRATION_DATABASE_URL: withDatabase(migrationUrl, database),
      RESQ_MIGRATION_OPERATOR: 'jest-integration',
      ...(expectedCurrent === undefined
        ? { RESQ_MIGRATION_EXPECTED_CURRENT: undefined }
        : { RESQ_MIGRATION_EXPECTED_CURRENT: expectedCurrent }),
    },
    'migration',
  );
}

describeIntegration('forward-only governance migrations', () => {
  const createdDatabases: string[] = [];
  let admin: Client;

  beforeAll(async () => {
    const migrationUrl = process.env['RESQ_MIGRATION_DATABASE_URL'];
    if (migrationUrl === undefined) throw new Error('RESQ_MIGRATION_DATABASE_URL is required');
    admin = new Client({ connectionString: withDatabase(migrationUrl, 'postgres') });
    await admin.connect();
  });

  afterAll(async () => {
    for (const database of createdDatabases) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [database],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
    await admin.end();
  });

  async function createDatabase(prefix: string): Promise<string> {
    const name = databaseName(prefix);
    await admin.query(`CREATE DATABASE "${name}"`);
    createdDatabases.push(name);
    return name;
  }

  it('migrates an empty database and records checksummed release evidence', async () => {
    const database = await createDatabase('resq_zero');
    const config = integrationConfig(database, 'NONE');
    await runMigrations(config);

    const client = new Client({ connectionString: config.dependencies.database.migrationUrl });
    await client.connect();
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'governance' ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'audit_events',
        'idempotency_records',
        'event_stream_sequences',
        'outbox_events',
        'inbox_messages',
        'job_intents',
        'schema_migration_runs',
      ]),
    );
    const migrationCount = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM public.schema_migrations',
    );
    expect(migrationCount.rows[0]?.count).toBe('4');
    const run = await client.query<{ result: string; checksums: string }>(
      `SELECT result, jsonb_typeof(migration_checksums) AS checksums
       FROM governance.schema_migration_runs`,
    );
    expect(run.rows).toEqual([{ result: 'SUCCEEDED', checksums: 'object' }]);
    await client.end();
  });

  it('upgrades a prior migration fixture without losing its row', async () => {
    const database = await createDatabase('resq_prior');
    const priorConfig = integrationConfig(database);
    const priorSource = new DataSource({
      ...migrationDataSourceOptions(priorConfig),
      migrations: [CreateGovernanceControl1793664000000],
    });
    await priorSource.initialize();
    await priorSource.runMigrations({ transaction: 'all' });
    const fixtureId = '018f0000-0000-7000-8000-000000000101';
    await priorSource.query(
      `INSERT INTO governance.idempotency_records (
        id, tenant_id, actor_id, operation, idempotency_key_hash, request_hash, state,
        expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, 'fixture.operation', decode(repeat('ab', 32), 'hex'),
        decode(repeat('cd', 32), 'hex'), 'IN_PROGRESS', now() + interval '1 day', now(), now())`,
      [fixtureId, '018f0000-0000-7000-8000-000000000102', '018f0000-0000-7000-8000-000000000103'],
    );
    await priorSource.destroy();

    const config = integrationConfig(database, 'CreateGovernanceControl1793664000000');
    await runMigrations(config);
    const client = new Client({ connectionString: config.dependencies.database.migrationUrl });
    await client.connect();
    const fixture = await client.query<{ id: string }>(
      'SELECT id::text FROM governance.idempotency_records WHERE id = $1',
      [fixtureId],
    );
    expect(fixture.rows).toEqual([{ id: fixtureId }]);
    expect(
      await client.query("SELECT to_regclass('governance.outbox_events') IS NOT NULL AS present"),
    ).toMatchObject({ rows: [{ present: true }] });
    await client.end();
  });

  it('forces tenant RLS for the non-owner application role', async () => {
    const database = await createDatabase('resq_rls');
    const config = integrationConfig(database, 'NONE');
    await runMigrations(config);

    const appUrl = process.env['RESQ_DATABASE_URL'];
    if (appUrl === undefined) throw new Error('RESQ_DATABASE_URL is required');
    const application = new Client({ connectionString: withDatabase(appUrl, database) });
    await application.connect();
    const tenantA = '018f0000-0000-7000-8000-000000000201';
    const tenantB = '018f0000-0000-7000-8000-000000000202';
    const actor = '018f0000-0000-7000-8000-000000000203';
    await application.query('BEGIN');
    await application.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
    await application.query("SELECT set_config('app.user_id', $1, true)", [actor]);
    await application.query(
      `INSERT INTO governance.idempotency_records (
        id, tenant_id, actor_id, operation, idempotency_key_hash, request_hash, state,
        expires_at, created_at, updated_at
      ) VALUES ('018f0000-0000-7000-8000-000000000204', $1, $2, 'rls.fixture',
        decode(repeat('11', 32), 'hex'), decode(repeat('22', 32), 'hex'), 'IN_PROGRESS',
        now() + interval '1 day', now(), now())`,
      [tenantA, actor],
    );
    expect(
      await application.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM governance.idempotency_records',
      ),
    ).toMatchObject({ rows: [{ count: '1' }] });
    await application.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
    expect(
      await application.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM governance.idempotency_records',
      ),
    ).toMatchObject({ rows: [{ count: '0' }] });
    await application.query('ROLLBACK');
    await application.end();
  });

  it('isolates identity and tenant rows and clears transaction-local claims', async () => {
    const database = await createDatabase('resq_identity_rls');
    const config = integrationConfig(database, 'NONE');
    await runMigrations(config);

    const owner = new Client({ connectionString: config.dependencies.database.migrationUrl });
    await owner.connect();
    const userA = '018f0000-0000-7000-8000-000000000301';
    const userB = '018f0000-0000-7000-8000-000000000302';
    const tenantA = '018f0000-0000-7000-8000-000000000303';
    const tenantB = '018f0000-0000-7000-8000-000000000304';
    await owner.query(
      `INSERT INTO identity.users (id, status, token_version, created_at, updated_at)
       VALUES ($1, 'ACTIVE', 1, now(), now()), ($2, 'ACTIVE', 1, now(), now())`,
      [userA, userB],
    );
    await owner.query(
      `INSERT INTO tenancy.provider_organizations
         (id, legal_name, display_name, operating_status, created_at, updated_at)
       VALUES ($1, 'Tenant A Legal', 'Tenant A', 'ACTIVE', now(), now()),
              ($2, 'Tenant B Legal', 'Tenant B', 'ACTIVE', now(), now())`,
      [tenantA, tenantB],
    );
    await owner.end();

    const appUrl = process.env['RESQ_DATABASE_URL'];
    if (appUrl === undefined) throw new Error('RESQ_DATABASE_URL is required');
    const application = new Client({ connectionString: withDatabase(appUrl, database) });
    await application.connect();
    await application.query('BEGIN');
    await application.query("SELECT set_config('app.user_id', $1, true)", [userA]);
    await application.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
    await application.query("SELECT set_config('app.access_scope_type', 'TENANT', true)");
    expect(
      await application.query<{ id: string }>('SELECT id::text FROM identity.users ORDER BY id'),
    ).toMatchObject({ rows: [{ id: userA }] });
    expect(
      await application.query<{ id: string }>(
        'SELECT id::text FROM tenancy.provider_organizations ORDER BY id',
      ),
    ).toMatchObject({ rows: [{ id: tenantA }] });
    await application.query('COMMIT');

    expect(
      await application.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM tenancy.provider_organizations',
      ),
    ).toMatchObject({ rows: [{ count: '0' }] });
    await application.end();
  });

  it('isolates provider fleet rows by tenant and facility scope', async () => {
    const database = await createDatabase('resq_provider_rls');
    const config = integrationConfig(database, 'NONE');
    await runMigrations(config);

    const owner = new Client({ connectionString: config.dependencies.database.migrationUrl });
    await owner.connect();
    const actor = '018f0000-0000-7000-8000-000000000351';
    const tenantA = '018f0000-0000-7000-8000-000000000352';
    const tenantB = '018f0000-0000-7000-8000-000000000353';
    const facilityA = '018f0000-0000-7000-8000-000000000354';
    const facilityB = '018f0000-0000-7000-8000-000000000355';
    const ambulanceA = '018f0000-0000-7000-8000-000000000356';
    const ambulanceB = '018f0000-0000-7000-8000-000000000357';
    await owner.query(
      `INSERT INTO identity.users (id, status, token_version, created_at, updated_at)
       VALUES ($1, 'ACTIVE', 1, now(), now())`,
      [actor],
    );
    await owner.query(
      `INSERT INTO tenancy.provider_organizations
         (id, legal_name, display_name, operating_status, created_at, updated_at)
       VALUES ($1, 'Tenant A Legal', 'Tenant A', 'ACTIVE', now(), now()),
              ($2, 'Tenant B Legal', 'Tenant B', 'ACTIVE', now(), now())`,
      [tenantA, tenantB],
    );
    await owner.query(
      `INSERT INTO tenancy.facilities
         (id, tenant_id, geographic_unit_id, name, facility_type, operating_status,
          created_at, updated_at)
       VALUES
         ($1, $2, '019a45f0-0000-7000-8000-000000000103', 'Facility A', 'BASE', 'ACTIVE', now(), now()),
         ($3, $4, '019a45f0-0000-7000-8000-000000000104', 'Facility B', 'BASE', 'ACTIVE', now(), now())`,
      [facilityA, tenantA, facilityB, tenantB],
    );
    await owner.query(
      `INSERT INTO fleet.ambulances
         (id, tenant_id, facility_id, registered_by_user_id, plate_number, category,
          compliance_status, operational_status, gps_quality, readiness_status,
          readiness_reasons, created_at, updated_at)
       VALUES
         ($1, $2, $3, $4, 'BA1CHA1000', 'BASIC', 'PENDING_REVIEW', 'OFFLINE',
          'UNAVAILABLE', 'BLOCKED', ARRAY['COMPLIANCE_NOT_APPROVED'], now(), now()),
         ($5, $6, $7, $4, 'GA1CHA1000', 'BASIC', 'PENDING_REVIEW', 'OFFLINE',
          'UNAVAILABLE', 'BLOCKED', ARRAY['COMPLIANCE_NOT_APPROVED'], now(), now())`,
      [ambulanceA, tenantA, facilityA, actor, ambulanceB, tenantB, facilityB],
    );
    await owner.end();

    const appUrl = process.env['RESQ_DATABASE_URL'];
    if (appUrl === undefined) throw new Error('RESQ_DATABASE_URL is required');
    const application = new Client({ connectionString: withDatabase(appUrl, database) });
    await application.connect();
    await application.query('BEGIN');
    await application.query("SELECT set_config('app.user_id', $1, true)", [actor]);
    await application.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
    await application.query("SELECT set_config('app.access_scope_type', 'FACILITY_SET', true)");
    await application.query("SELECT set_config('app.facility_scope', $1, true)", [
      JSON.stringify([facilityA]),
    ]);
    expect(
      await application.query<{ id: string }>('SELECT id::text FROM fleet.ambulances ORDER BY id'),
    ).toMatchObject({ rows: [{ id: ambulanceA }] });
    expect(
      await application.query<{ id: string }>(
        'SELECT id::text FROM tenancy.facilities ORDER BY id',
      ),
    ).toMatchObject({ rows: [{ id: facilityA }] });
    await application.query('ROLLBACK');
    await application.end();
  });

  it('withholds internal security-definer functions and rejects runtime root grants', async () => {
    const database = await createDatabase('resq_authority_guard');
    const config = integrationConfig(database, 'NONE');
    await runMigrations(config);

    const owner = new Client({ connectionString: config.dependencies.database.migrationUrl });
    await owner.connect();
    const userId = '018f0000-0000-7000-8000-000000000401';
    await owner.query(
      `INSERT INTO identity.users (id, status, token_version, created_at, updated_at)
       VALUES ($1, 'ACTIVE', 1, now(), now())`,
      [userId],
    );
    await owner.end();

    const appUrl = process.env['RESQ_DATABASE_URL'];
    if (appUrl === undefined) throw new Error('RESQ_DATABASE_URL is required');
    const application = new Client({ connectionString: withDatabase(appUrl, database) });
    await application.connect();
    expect(
      await application.query<{ permitted: boolean }>(
        `SELECT has_function_privilege(
           current_user,
           'access_control.authority_scope_contains(uuid,uuid,uuid,timestamptz)',
           'EXECUTE'
         ) AS permitted`,
      ),
    ).toMatchObject({ rows: [{ permitted: false }] });

    await application.query('BEGIN');
    await application.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await expect(
      application.query(
        `INSERT INTO access_control.authority_grants (
           id, subject_user_id, issued_by_user_id, role_profile_id, level, national_scope,
           purpose, human_reason, status, valid_from, expires_at, required_assurance,
           created_at, updated_at
         ) VALUES (
           '018f0000-0000-7000-8000-000000000402', $1, $1,
           '019a45f0-0000-7000-8200-000000000010', 'PLATFORM', true,
           'Runtime bootstrap attempt', 'Must be rejected', 'PENDING_APPROVAL', now(),
           now() + interval '1 hour', 'AAL2', now(), now()
         )`,
        [userId],
      ),
    ).rejects.toThrow(
      /parentless authority grants require a reviewed bootstrap migration|row-level security/i,
    );
    await application.query('ROLLBACK');
    await application.end();
  });
});
