import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { DataSource } from 'typeorm';

import { trackingFreshness } from '../../src/core-dispatch/domain/core-dispatch.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import type { IdempotencyBeginResult } from '../../src/shared/application/idempotency/idempotency.js';
import {
  loadApplicationConfig,
  type ApplicationConfig,
} from '../../src/shared/infrastructure/config/application-config.js';
import type { DatabaseService } from '../../src/shared/infrastructure/persistence/database.service.js';
import { applicationDataSourceOptions } from '../../src/shared/infrastructure/persistence/data-source-options.js';
import { runMigrations } from '../../src/shared/infrastructure/persistence/migration-runner.js';
import { PostgresIdempotencyRepository } from '../../src/shared/infrastructure/persistence/postgres-idempotency.repository.js';
import { TypeOrmUnitOfWork } from '../../src/shared/infrastructure/persistence/typeorm-unit-of-work.js';

const integrationEnabled = process.env['RUN_INTEGRATION'] === '1';
const describeIntegration = integrationEnabled ? describe : describe.skip;
const GEOGRAPHIC_UNIT_ID = '019a45f0-0000-7000-8000-000000000103';

interface PartyFixture {
  readonly tenantId: string;
  readonly facilityId: string;
  readonly dispatcherUserId: string;
  readonly driverUserId: string;
  readonly driverId: string;
  readonly ambulanceId: string;
  readonly offerId: string;
}

interface DispatchFixture {
  readonly requesterUserId: string;
  readonly bookingId: string;
  readonly parties: readonly PartyFixture[];
  readonly assignmentId?: string;
  readonly tripId?: string;
}

interface Claims {
  readonly userId: string;
  readonly tenantId?: string;
  readonly accessScopeType?: 'TENANT' | 'FACILITY_SET';
  readonly facilityIds?: readonly string[];
}

function databaseName(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

function withDatabase(urlValue: string, database: string): string {
  const url = new URL(urlValue);
  url.pathname = `/${database}`;
  return url.toString();
}

function integrationConfig(database: string): ApplicationConfig {
  const migrationUrl = process.env['RESQ_MIGRATION_DATABASE_URL'];
  const applicationUrl = process.env['RESQ_DATABASE_URL'];
  if (migrationUrl === undefined || applicationUrl === undefined) {
    throw new Error('Integration database URLs are required');
  }
  return loadApplicationConfig(
    {
      ...process.env,
      NODE_ENV: 'test',
      RESQ_RELEASE: 'core-dispatch-integration',
      RESQ_LOG_PRETTY: 'false',
      RESQ_DATABASE_URL: withDatabase(applicationUrl, database),
      RESQ_MIGRATION_DATABASE_URL: withDatabase(migrationUrl, database),
      RESQ_MIGRATION_OPERATOR: 'jest-core-dispatch',
      RESQ_MIGRATION_EXPECTED_CURRENT: 'NONE',
    },
    'migration',
  );
}

async function applyClaims(client: Client, claims: Claims): Promise<void> {
  await client.query("SELECT set_config('app.user_id', $1, true)", [claims.userId]);
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [claims.tenantId ?? '']);
  await client.query("SELECT set_config('app.access_scope_type', $1, true)", [
    claims.accessScopeType ?? (claims.tenantId === undefined ? '' : 'TENANT'),
  ]);
  await client.query("SELECT set_config('app.facility_scope', $1, true)", [
    JSON.stringify(claims.facilityIds ?? []),
  ]);
  await client.query("SELECT set_config('app.authority_grant_id', '', true)");
}

describeIntegration('Phase 5 core dispatch PostgreSQL invariants', () => {
  const database = databaseName('resq_dispatch');
  let config: ApplicationConfig;
  let clusterAdmin: Client;
  let owner: Client;

  beforeAll(async () => {
    const migrationUrl = process.env['RESQ_MIGRATION_DATABASE_URL'];
    if (migrationUrl === undefined) throw new Error('RESQ_MIGRATION_DATABASE_URL is required');
    clusterAdmin = new Client({ connectionString: withDatabase(migrationUrl, 'postgres') });
    await clusterAdmin.connect();
    await clusterAdmin.query(`CREATE DATABASE "${database}"`);
    config = integrationConfig(database);
    await runMigrations(config);
    owner = new Client({ connectionString: config.dependencies.database.migrationUrl });
    await owner.connect();
  });

  afterAll(async () => {
    await owner.end();
    await clusterAdmin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [database],
    );
    await clusterAdmin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await clusterAdmin.end();
  });

  async function asApplication<T>(
    claims: Claims,
    work: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client({ connectionString: config.dependencies.database.url });
    await client.connect();
    await client.query('BEGIN');
    try {
      await applyClaims(client, claims);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.end();
    }
  }

  async function asOwner<T>(claims: Claims, work: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: config.dependencies.database.migrationUrl });
    await client.connect();
    await client.query('BEGIN');
    try {
      await applyClaims(client, claims);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.end();
    }
  }

  async function createUser(): Promise<string> {
    const userId = randomUUID();
    await owner.query(
      `INSERT INTO identity.users (id, status, token_version, created_at, updated_at)
       VALUES ($1, 'ACTIVE', 1, statement_timestamp(), statement_timestamp())`,
      [userId],
    );
    return userId;
  }

  async function seedDispatchFixture(input: {
    readonly partyCount: 1 | 2;
    readonly active: boolean;
  }): Promise<DispatchFixture> {
    const requesterUserId = randomUUID();
    const bookingId = randomUUID();
    const parties: PartyFixture[] = Array.from({ length: input.partyCount }, () => ({
      tenantId: randomUUID(),
      facilityId: randomUUID(),
      dispatcherUserId: randomUUID(),
      driverUserId: randomUUID(),
      driverId: randomUUID(),
      ambulanceId: randomUUID(),
      offerId: randomUUID(),
    }));
    const createdAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 10 * 60_000);

    await owner.query('BEGIN');
    try {
      await owner.query(
        `INSERT INTO identity.users (id, status, token_version, created_at, updated_at)
         SELECT id, 'ACTIVE', 1, $2, $2 FROM unnest($1::uuid[]) AS id`,
        [
          [
            requesterUserId,
            ...parties.flatMap((party) => [party.dispatcherUserId, party.driverUserId]),
          ],
          createdAt,
        ],
      );

      for (const [index, party] of parties.entries()) {
        await owner.query(
          `INSERT INTO tenancy.provider_organizations (
             id, legal_name, display_name, operating_status, version, created_at, updated_at
           ) VALUES ($1, $2, $3, 'ACTIVE', 1, $4, $4)`,
          [
            party.tenantId,
            `Integration Provider ${party.tenantId}`,
            `Provider ${String(index + 1)}`,
            createdAt,
          ],
        );
        await owner.query(
          `INSERT INTO tenancy.facilities (
             id, tenant_id, geographic_unit_id, name, facility_type, operating_status,
             version, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, 'AMBULANCE_BASE', 'ACTIVE', 1, $5, $5)`,
          [
            party.facilityId,
            party.tenantId,
            GEOGRAPHIC_UNIT_ID,
            `Integration Base ${String(index + 1)}`,
            createdAt,
          ],
        );
        await owner.query(
          `INSERT INTO workforce.driver_profiles (
             id, tenant_id, user_id, licence_number, licence_expires_on,
             verification_status, account_status, duty_status, version, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, current_date + 365, 'VERIFIED', 'ACTIVE', $5, 1, $6, $6)`,
          [
            party.driverId,
            party.tenantId,
            party.driverUserId,
            `LIC-${party.driverId}`,
            input.active ? 'RESERVED' : 'AVAILABLE',
            createdAt,
          ],
        );
        await owner.query(
          `INSERT INTO workforce.driver_facility_assignments (
             id, tenant_id, facility_id, driver_id, valid_from, created_at
           ) VALUES ($1, $2, $3, $4, $5, $5)`,
          [randomUUID(), party.tenantId, party.facilityId, party.driverId, createdAt],
        );
        await owner.query(
          `INSERT INTO fleet.ambulances (
             id, tenant_id, facility_id, registered_by_user_id, plate_number, category,
             compliance_status, operational_status, gps_quality, readiness_status,
             readiness_reasons, readiness_version, version, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, 'BASIC', 'APPROVED', $6, 'LIVE', 'READY',
             ARRAY[]::varchar[], 1, 1, $7, $7
           )`,
          [
            party.ambulanceId,
            party.tenantId,
            party.facilityId,
            party.dispatcherUserId,
            `INT-${party.ambulanceId.slice(0, 8)}`,
            input.active ? 'RESERVED' : 'AVAILABLE',
            createdAt,
          ],
        );
        const documentObjectId = randomUUID();
        await owner.query(
          `INSERT INTO documents.document_objects (
             id, uploaded_by_user_id, tenant_id, facility_id, object_key, expected_sha256,
             size_bytes, declared_mime_type, detected_mime_type, encryption_key_version,
             upload_status, scanner_code, version, finalized_at, scanned_at, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, decode(repeat('a1', 32), 'hex'), 128,
             'application/pdf', 'application/pdf', 'integration-key', 'READY',
             'INTEGRATION_CLEAN', 1, $6, $6, $6, $6
           )`,
          [
            documentObjectId,
            party.dispatcherUserId,
            party.tenantId,
            party.facilityId,
            `integration/${documentObjectId}.pdf`,
            createdAt,
          ],
        );
        await owner.query(
          `INSERT INTO documents.driver_documents (
             id, tenant_id, driver_id, document_object_id, document_type, review_status,
             expires_on, version, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, 'DRIVER_LICENCE', 'APPROVED', current_date + 365, 1, $5, $5
           )`,
          [randomUUID(), party.tenantId, party.driverId, documentObjectId, createdAt],
        );
      }

      await owner.query(
        `INSERT INTO dispatch.bookings (
           id, booking_reference, requester_user_id, pickup_geographic_unit_id,
           destination_geographic_unit_id, service_category, urgency, payment_method,
           pickup_latitude, pickup_longitude, destination_latitude, destination_longitude,
           patient_payload_ciphertext, patient_payload_nonce, patient_payload_tag,
           patient_payload_key_version, consent_flags, status, version, search_deadline,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $4, 'EMERGENCY_TRANSPORT', 'EMERGENCY', 'CASH',
           27.7172, 85.3240, 27.7000, 85.3333, decode('abcd', 'hex'),
           decode(repeat('01', 12), 'hex'), decode(repeat('02', 16), 'hex'),
           'integration-key', '{"emergencyTransport":true,"locationSharing":true}'::jsonb,
           $5, $6, $7, $8, $8
         )`,
        [
          bookingId,
          `B-${bookingId.replaceAll('-', '').slice(0, 20)}`,
          requesterUserId,
          GEOGRAPHIC_UNIT_ID,
          input.active ? 'ACTIVE' : 'SEARCHING',
          input.active ? 4 : 2,
          expiresAt,
          createdAt,
        ],
      );

      for (const [index, party] of parties.entries()) {
        const accepted = input.active && index === 0;
        await owner.query(
          `INSERT INTO dispatch.dispatch_offers (
             id, booking_id, tenant_id, facility_id, status, version, expires_at,
             responded_at, response_reason_code, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [
            party.offerId,
            bookingId,
            party.tenantId,
            party.facilityId,
            accepted ? 'ACCEPTED' : 'PENDING',
            accepted ? 2 : 1,
            expiresAt,
            accepted ? createdAt : null,
            accepted ? 'OFFER_ACCEPTED' : null,
            createdAt,
          ],
        );
      }

      if (input.active) {
        const party = parties[0];
        if (party === undefined) throw new Error('Active fixture requires one party');
        const assignmentId = randomUUID();
        const tripId = randomUUID();
        await owner.query(
          `INSERT INTO dispatch.booking_assignments (
             id, booking_id, offer_id, tenant_id, facility_id, driver_id, ambulance_id,
             dispatcher_user_id, accepted_at, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
          [
            assignmentId,
            bookingId,
            party.offerId,
            party.tenantId,
            party.facilityId,
            party.driverId,
            party.ambulanceId,
            party.dispatcherUserId,
            createdAt,
          ],
        );
        await owner.query(
          `INSERT INTO dispatch.trips (
             id, assignment_id, booking_id, requester_user_id, tenant_id, facility_id,
             driver_id, ambulance_id, status, version, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ASSIGNED', 1, $9, $9)`,
          [
            tripId,
            assignmentId,
            bookingId,
            requesterUserId,
            party.tenantId,
            party.facilityId,
            party.driverId,
            party.ambulanceId,
            createdAt,
          ],
        );
        await owner.query('COMMIT');
        return { requesterUserId, bookingId, parties, assignmentId, tripId };
      }

      await owner.query('COMMIT');
      return { requesterUserId, bookingId, parties };
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  }

  it('serializes competing tenant acceptances and permits the winner to deliver every outcome', async () => {
    const fixture = await seedDispatchFixture({ partyCount: 2, active: false });
    const attempts = fixture.parties.map(async (party) => {
      const assignmentId = randomUUID();
      const tripId = randomUUID();
      const result = await asApplication(
        { userId: party.dispatcherUserId, tenantId: party.tenantId },
        async (client) => {
          const response = await client.query<{ result: string }>(
            `SELECT dispatch.accept_offer(
               $1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10
             ) AS result`,
            [
              party.offerId,
              assignmentId,
              tripId,
              randomUUID(),
              randomUUID(),
              randomUUID(),
              party.driverId,
              party.ambulanceId,
              party.dispatcherUserId,
              `accept-${party.offerId}`,
            ],
          );
          return response.rows[0]?.result;
        },
      );
      return { party, assignmentId, tripId, result };
    });

    const results = await Promise.all(attempts);
    expect(results.map((result) => result.result).sort()).toEqual(['ACCEPTED', 'OFFER_RESOLVED']);
    const winner = results.find((result) => result.result === 'ACCEPTED');
    const loser = results.find((result) => result.result !== 'ACCEPTED');
    if (winner === undefined || loser === undefined)
      throw new Error('Acceptance race had no winner');

    expect(
      await owner.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM dispatch.booking_assignments WHERE booking_id = $1',
        [fixture.bookingId],
      ),
    ).toMatchObject({ rows: [{ count: '1' }] });
    expect(
      await owner.query<{ status: string; count: string }>(
        `SELECT status, count(*)::text AS count
           FROM dispatch.dispatch_offers WHERE booking_id = $1
          GROUP BY status ORDER BY status`,
        [fixture.bookingId],
      ),
    ).toMatchObject({
      rows: [
        { status: 'ACCEPTED', count: '1' },
        { status: 'SUPERSEDED', count: '1' },
      ],
    });

    await asApplication(
      { userId: winner.party.dispatcherUserId, tenantId: winner.party.tenantId },
      async (client) => {
        const outcomes = await client.query<{ id: string; status: string }>(
          'SELECT id::text, status FROM dispatch.accepted_offer_outcomes($1,$2)',
          [winner.party.offerId, winner.party.dispatcherUserId],
        );
        expect(outcomes.rows.map((row) => row.status).sort()).toEqual(['ACCEPTED', 'SUPERSEDED']);
        await client.query(
          `INSERT INTO governance.outbox_events (
             event_id, event_type, schema_version, producer, aggregate_type, aggregate_id,
             aggregate_version, stream_type, stream_id, stream_sequence, tenant_id, facility_id,
             correlation_id, causation_id, actor_type, actor_id, event_data,
             occurred_at, available_at
           ) VALUES (
             $1, 'dispatch.offer.superseded.v1', 1, 'integration', 'dispatchOffer', $2,
             2, 'bookingDispatch', $3, 1, $4, $5, 'integration-race', 'integration-race',
             'USER', $6, '{"status":"SUPERSEDED"}'::jsonb,
             statement_timestamp(), statement_timestamp()
           )`,
          [
            randomUUID(),
            loser.party.offerId,
            fixture.bookingId,
            loser.party.tenantId,
            loser.party.facilityId,
            winner.party.dispatcherUserId,
          ],
        );
      },
    );

    const outsider = await createUser();
    await asApplication({ userId: outsider }, async (client) => {
      expect(
        await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM governance.outbox_events
            WHERE stream_id = $1 AND event_type = 'dispatch.offer.superseded.v1'`,
          [fixture.bookingId],
        ),
      ).toMatchObject({ rows: [{ count: '0' }] });
    });
  });

  it('serializes cancellation against SOS creation without an inconsistent active trip', async () => {
    const fixture = await seedDispatchFixture({ partyCount: 1, active: true });
    const party = fixture.parties[0];
    if (party === undefined || fixture.tripId === undefined)
      throw new Error('Active fixture missing');
    const cancellation = asApplication({ userId: fixture.requesterUserId }, async (client) => {
      const response = await client.query<{ result: string }>(
        `SELECT dispatch.cancel_booking(
           $1, 4, $2, $3, $4, $5, 'REQUESTER', 'INTEGRATION_POLICY', 'v1',
           'REQUESTER_CANCELLED', 'Integration cancellation', 0, 'NPR'::char(3), true, $6
         ) AS result`,
        [
          fixture.bookingId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          fixture.requesterUserId,
          randomUUID(),
        ],
      );
      return response.rows[0]?.result;
    });
    const incidentId = randomUUID();
    const incident = asApplication({ userId: fixture.requesterUserId }, async (client) => {
      const response = await client.query<{ created: boolean }>(
        `SELECT safety.create_incident(
           $1, $2, $3, $4, $5, $6, 'SOS', 'CRITICAL', decode('abcd','hex'),
           decode(repeat('03',12),'hex'), decode(repeat('04',16),'hex'), 'integration-key'
         ) AS created`,
        [
          incidentId,
          randomUUID(),
          fixture.tripId,
          fixture.bookingId,
          party.tenantId,
          party.facilityId,
        ],
      );
      return response.rows[0]?.created;
    });

    const [cancelResult, incidentCreated] = await Promise.all([cancellation, incident]);
    expect(cancelResult).toBe('CANCELLED');
    expect([true, false]).toContain(incidentCreated);
    expect(
      await owner.query<{ booking_status: string; trip_status: string }>(
        `SELECT booking.status AS booking_status, trip.status AS trip_status
           FROM dispatch.bookings booking
           JOIN dispatch.trips trip ON trip.booking_id = booking.id
          WHERE booking.id = $1`,
        [fixture.bookingId],
      ),
    ).toMatchObject({ rows: [{ booking_status: 'CANCELLED', trip_status: 'CANCELLED' }] });
    expect(
      await owner.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM safety.safety_incidents WHERE id = $1',
        [incidentId],
      ),
    ).toMatchObject({ rows: [{ count: incidentCreated === true ? '1' : '0' }] });
  });

  it('allows exactly one acknowledgement or automatic escalation at an incident version', async () => {
    const fixture = await seedDispatchFixture({ partyCount: 1, active: true });
    const party = fixture.parties[0];
    if (party === undefined || fixture.tripId === undefined)
      throw new Error('Active fixture missing');
    const incidentId = randomUUID();
    await asApplication({ userId: fixture.requesterUserId }, async (client) => {
      expect(
        await client.query<{ created: boolean }>(
          `SELECT safety.create_incident(
             $1, $2, $3, $4, $5, $6, 'SOS', 'CRITICAL', decode('abcd','hex'),
             decode(repeat('05',12),'hex'), decode(repeat('06',16),'hex'), 'integration-key'
           ) AS created`,
          [
            incidentId,
            randomUUID(),
            fixture.tripId,
            fixture.bookingId,
            party.tenantId,
            party.facilityId,
          ],
        ),
      ).toMatchObject({ rows: [{ created: true }] });
    });

    const acknowledgement = asApplication(
      { userId: party.dispatcherUserId, tenantId: party.tenantId },
      async (client) => {
        const response = await client.query<{ result: string }>(
          `SELECT safety.transition_incident(
             $1, 1, $2, $3, 'ACKNOWLEDGE', 0, 'RESPONDER_ACKNOWLEDGED', NULL
           ) AS result`,
          [incidentId, randomUUID(), party.dispatcherUserId],
        );
        return response.rows[0]?.result;
      },
    );
    const escalation = asOwner(
      { userId: party.dispatcherUserId, tenantId: party.tenantId },
      async (client) => {
        const response = await client.query<{ changed: boolean }>(
          'SELECT safety.escalate_unacknowledged($1, 1, 0, $2) AS changed',
          [incidentId, randomUUID()],
        );
        return response.rows[0]?.changed;
      },
    );
    const [acknowledgementResult, escalationResult] = await Promise.all([
      acknowledgement,
      escalation,
    ]);
    expect(
      (acknowledgementResult === 'ACKNOWLEDGED' ? 1 : 0) + (escalationResult === true ? 1 : 0),
    ).toBe(1);
    expect(['ACKNOWLEDGED', 'STALE_VERSION']).toContain(acknowledgementResult);
    expect(
      await owner.query<{ version: number; count: string }>(
        `SELECT incident.version, count(event.id)::text AS count
           FROM safety.safety_incidents incident
           JOIN safety.safety_incident_events event ON event.incident_id = incident.id
          WHERE incident.id = $1 GROUP BY incident.version`,
        [incidentId],
      ),
    ).toMatchObject({ rows: [{ version: 2, count: '2' }] });
  });

  it('rejects duplicate, stale-sequence, stale-capture, and out-of-window tracking points', async () => {
    const fixture = await seedDispatchFixture({ partyCount: 1, active: true });
    const party = fixture.parties[0];
    if (party === undefined || fixture.tripId === undefined)
      throw new Error('Active fixture missing');
    const capturedAt = new Date(Date.now() - 10_000);
    const results = await asApplication(
      { userId: party.driverUserId, tenantId: party.tenantId },
      async (client) => {
        const ingest = async (input: {
          pointId: string;
          sequence: number;
          capturedAt: Date;
        }): Promise<string | undefined> => {
          const response = await client.query<{ result: string }>(
            `SELECT tracking.ingest_location_point(
               $1, $2, $3, $4, $5, 27.7172, 85.3240, 8, 90, 12,
               'GOOD', $6
             ) AS result`,
            [
              randomUUID(),
              fixture.tripId,
              party.driverUserId,
              input.pointId,
              input.sequence,
              input.capturedAt,
            ],
          );
          return response.rows[0]?.result;
        };
        const firstPointId = randomUUID();
        return [
          await ingest({
            pointId: firstPointId,
            sequence: 1,
            capturedAt: new Date(capturedAt.getTime() - 10_000),
          }),
          await ingest({ pointId: randomUUID(), sequence: 3, capturedAt }),
          await ingest({
            pointId: randomUUID(),
            sequence: 2,
            capturedAt: new Date(capturedAt.getTime() + 1_000),
          }),
          await ingest({
            pointId: randomUUID(),
            sequence: 4,
            capturedAt: new Date(capturedAt.getTime() - 1_000),
          }),
          await ingest({
            pointId: firstPointId,
            sequence: 1,
            capturedAt: new Date(capturedAt.getTime() + 2_000),
          }),
          await ingest({
            pointId: randomUUID(),
            sequence: 5,
            capturedAt: new Date(Date.now() - 25 * 60 * 60_000),
          }),
        ];
      },
    );
    expect(results).toEqual([
      'ACCEPTED',
      'ACCEPTED',
      'STALE_SEQUENCE',
      'STALE_CAPTURE',
      'DUPLICATE',
      'INVALID_POINT',
    ]);

    const requesterState = await asApplication(
      { userId: fixture.requesterUserId },
      async (client) =>
        client.query<{ last_sequence: string; last_captured_at: Date }>(
          `SELECT last_sequence::text, last_captured_at
             FROM tracking.trip_tracking_state WHERE trip_id = $1`,
          [fixture.tripId],
        ),
    );
    expect(requesterState.rows[0]?.last_sequence).toBe('3');
    const storedCapture = requesterState.rows[0]?.last_captured_at;
    if (storedCapture === undefined) throw new Error('Tracking state was not stored');
    expect(trackingFreshness(storedCapture, new Date(storedCapture.getTime() + 29_999))).toBe(
      'LIVE',
    );
    expect(trackingFreshness(storedCapture, new Date(storedCapture.getTime() + 30_000))).toBe(
      'STALE',
    );
    expect(trackingFreshness(storedCapture, new Date(storedCapture.getTime() + 120_000))).toBe(
      'UNAVAILABLE',
    );

    const outsider = await createUser();
    await asApplication({ userId: outsider }, async (client) => {
      expect(
        await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM tracking.trip_tracking_state WHERE trip_id = $1',
          [fixture.tripId],
        ),
      ).toMatchObject({ rows: [{ count: '0' }] });
    });
  });

  it('allows requester-owned delivery/audit writes but rejects generic Phase 5 bypasses', async () => {
    const fixture = await seedDispatchFixture({ partyCount: 1, active: true });
    const party = fixture.parties[0];
    if (party === undefined || fixture.tripId === undefined)
      throw new Error('Active fixture missing');
    const outsider = await createUser();

    await expect(
      asApplication({ userId: outsider }, (client) =>
        client.query(
          `INSERT INTO governance.event_stream_sequences (
             stream_type, stream_id, tenant_id, current_sequence, updated_at
           ) VALUES ('bookingDispatch', $1, NULL, 1, statement_timestamp())`,
          [fixture.bookingId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    await expect(
      asApplication({ userId: outsider }, (client) =>
        client.query(
          `INSERT INTO governance.outbox_events (
             event_id, event_type, schema_version, producer, aggregate_type, aggregate_id,
             aggregate_version, stream_type, stream_id, stream_sequence, tenant_id, facility_id,
             correlation_id, causation_id, actor_type, actor_id, event_data,
             occurred_at, available_at
           ) VALUES (
             $1, 'trip.cancelled.v1', 1, 'integration', 'trip', $2,
             2, 'trip', $2, 99, NULL, NULL, 'integration-forged-trip',
             'integration-forged-trip', 'USER', $3, '{}'::jsonb,
             statement_timestamp(), statement_timestamp()
           )`,
          [randomUUID(), fixture.tripId, outsider],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    await expect(
      asApplication({ userId: outsider }, (client) =>
        client.query(
          `INSERT INTO governance.job_intents (
             id, deterministic_job_id, job_type, queue_name, tenant_id, resource_type,
             resource_id, resource_version, run_at, correlation_id, causation_id,
             requested_by_type, requested_by_id, job_data, state, created_at, updated_at
           ) VALUES (
             $1, $2, 'dispatch.forged-trip.v1', 'dispatch-critical', NULL, 'trip',
             $3, 1, statement_timestamp(), 'integration-forged-job', 'integration-forged-job',
             'USER', $4, '{}'::jsonb, 'PENDING', statement_timestamp(), statement_timestamp()
           )`,
          [randomUUID(), `forged-trip-${randomUUID()}`, fixture.tripId, outsider],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    await expect(
      asApplication({ userId: outsider }, (client) =>
        client.query(
          `INSERT INTO governance.event_stream_sequences (
             stream_type, stream_id, tenant_id, current_sequence, updated_at
           ) VALUES ('trip', $1, NULL, 1, statement_timestamp())`,
          [fixture.tripId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    await asApplication({ userId: fixture.requesterUserId }, async (client) => {
      await client.query(
        `INSERT INTO governance.event_stream_sequences (
           stream_type, stream_id, tenant_id, current_sequence, updated_at
         ) VALUES ('bookingDispatch', $1, NULL, 1, statement_timestamp())`,
        [fixture.bookingId],
      );
      const cancellation = await client.query<{ result: string }>(
        `SELECT dispatch.cancel_booking(
           $1, 4, $2, $3, $4, $5, 'REQUESTER', 'INTEGRATION_POLICY', 'v1',
           'REQUESTER_CANCELLED', 'Integration cancellation', 0, 'NPR'::char(3), true, $6
         ) AS result`,
        [
          fixture.bookingId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          fixture.requesterUserId,
          randomUUID(),
        ],
      );
      expect(cancellation.rows[0]?.result).toBe('CANCELLED');
      await client.query(
        `INSERT INTO governance.event_stream_sequences (
           stream_type, stream_id, tenant_id, current_sequence, updated_at
         ) VALUES ('trip', $1, $2, 1, statement_timestamp())`,
        [fixture.tripId, party.tenantId],
      );
      await client.query(
        `INSERT INTO governance.outbox_events (
           event_id, event_type, schema_version, producer, aggregate_type, aggregate_id,
           aggregate_version, stream_type, stream_id, stream_sequence, tenant_id, facility_id,
           correlation_id, causation_id, actor_type, actor_id, event_data,
           occurred_at, available_at
         ) VALUES (
           $1, 'trip.cancelled.v1', 1, 'integration', 'trip', $2,
           2, 'trip', $2, 1, $3, $4, 'integration-trip-cancel', 'integration-trip-cancel',
           'USER', $5, $6::jsonb, statement_timestamp(), statement_timestamp()
         )`,
        [
          randomUUID(),
          fixture.tripId,
          party.tenantId,
          party.facilityId,
          fixture.requesterUserId,
          JSON.stringify({
            bookingId: fixture.bookingId,
            status: 'CANCELLED',
            reasonCode: 'REQUESTER_CANCELLED',
          }),
        ],
      );
      expect(
        await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM governance.outbox_events
            WHERE event_type = 'trip.cancelled.v1' AND aggregate_id = $1`,
          [fixture.tripId],
        ),
      ).toMatchObject({ rows: [{ count: '1' }] });
      await client.query(
        `INSERT INTO governance.audit_events (
           occurred_at, id, tenant_id, actor_type, actor_id, authentication_assurance,
           action, resource_type, resource_id, outcome, reason_code, correlation_id,
           causation_id, source_channel, safe_context, event_hash, retention_class
         ) VALUES (
           statement_timestamp(), $1, $2, 'USER', $3, 'AAL1',
           'dispatch.booking.cancel', 'booking', $4, 'ALLOWED', 'REQUESTER_CANCELLED',
           'integration-audit', 'integration-audit', 'HTTP', '{}'::jsonb,
           decode(repeat('ab',32),'hex'), 'SECURITY'
         )`,
        [randomUUID(), party.tenantId, fixture.requesterUserId, fixture.bookingId],
      );
      expect(
        await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM governance.audit_events
            WHERE action = 'dispatch.booking.cancel' AND resource_id = $1`,
          [fixture.bookingId],
        ),
      ).toMatchObject({ rows: [{ count: '1' }] });
    });

    await asApplication({ userId: outsider }, async (client) => {
      await client.query(
        `INSERT INTO governance.event_stream_sequences (
           stream_type, stream_id, tenant_id, current_sequence, updated_at
         ) VALUES ('identityUser', $1, NULL, 1, statement_timestamp())`,
        [outsider],
      );
      expect(
        await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM dispatch.bookings WHERE id = $1',
          [fixture.bookingId],
        ),
      ).toMatchObject({ rows: [{ count: '0' }] });
    });

    await expect(
      asApplication({ userId: outsider }, (client) =>
        client.query(
          `INSERT INTO governance.audit_events (
             occurred_at, id, tenant_id, actor_type, actor_id, authentication_assurance,
             action, resource_type, resource_id, outcome, reason_code, correlation_id,
             causation_id, source_channel, safe_context, event_hash, retention_class
           ) VALUES (
             statement_timestamp(), $1, $2, 'USER', $3, 'AAL1',
             'dispatch.booking.cancel', 'booking', $4, 'ALLOWED', 'FORGED',
             'integration-forged', 'integration-forged', 'HTTP', '{}'::jsonb,
             decode(repeat('cd',32),'hex'), 'SECURITY'
           )`,
          [randomUUID(), party.tenantId, outsider, fixture.bookingId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('recovers an expired idempotency lease and replays the committed response', async () => {
    const actorId = await createUser();
    const source = new DataSource(applicationDataSourceOptions(config));
    await source.initialize();
    const databaseService = {
      getDataSource: () => Promise.resolve(source),
    } as unknown as DatabaseService;
    const unitOfWork = new TypeOrmUnitOfWork(databaseService, { generate: randomUUID });
    const repository = new PostgresIdempotencyRepository();
    const context = new RequestContext({
      requestId: randomUUID(),
      correlationId: randomUUID(),
      source: 'HTTP',
      actor: { type: 'USER', id: actorId },
    });
    const keyHash = createHash('sha256').update('integration-key').digest();
    const requestHash = createHash('sha256').update('request-a').digest();
    const base = new Date();
    const operation = `integration.idempotency:${randomUUID()}`;

    try {
      const begin = (
        now: Date,
        lockedUntil: Date,
        expiresAt: Date,
      ): Promise<IdempotencyBeginResult> =>
        unitOfWork.execute(context, (transaction) =>
          repository.begin(transaction, {
            id: randomUUID(),
            actorId,
            operation,
            keyHash,
            requestHash,
            now,
            lockedUntil,
            expiresAt,
          }),
        );
      await expect(
        begin(base, new Date(base.getTime() + 30_000), new Date(base.getTime() + 86_400_000)),
      ).resolves.toEqual({ kind: 'STARTED' });
      await expect(
        begin(
          new Date(base.getTime() + 10_000),
          new Date(base.getTime() + 40_000),
          new Date(base.getTime() + 86_400_000),
        ),
      ).resolves.toEqual({ kind: 'IN_PROGRESS' });
      const recoveryTime = new Date(base.getTime() + 31_000);
      await expect(
        begin(
          recoveryTime,
          new Date(recoveryTime.getTime() + 30_000),
          new Date(recoveryTime.getTime() + 86_400_000),
        ),
      ).resolves.toEqual({ kind: 'STARTED' });
      await unitOfWork.execute(context, (transaction) =>
        repository.complete(transaction, {
          actorId,
          operation,
          keyHash,
          status: 201,
          body: { id: 'stable-result' },
          now: new Date(recoveryTime.getTime() + 1_000),
        }),
      );
      await expect(
        begin(
          new Date(recoveryTime.getTime() + 2_000),
          new Date(recoveryTime.getTime() + 32_000),
          new Date(recoveryTime.getTime() + 86_400_000),
        ),
      ).resolves.toEqual({ kind: 'REPLAY', status: 201, body: { id: 'stable-result' } });
    } finally {
      await source.destroy();
    }
  });

  it('accepts durable ENQUEUEING/RUNNING recovery states and indexes both watchdog paths', async () => {
    const intentId = randomUUID();
    await owner.query(
      `INSERT INTO governance.job_intents (
         id, deterministic_job_id, job_type, queue_name, resource_type, resource_id,
         run_at, correlation_id, causation_id, requested_by_type, requested_by_id,
         job_data, state, created_at, updated_at
       ) VALUES (
         $1, $2, 'dispatch.finish-search.v1', 'dispatch-critical', 'booking', $3,
         statement_timestamp(), 'integration-job', 'integration-job', 'SYSTEM_POLICY',
         'integration-policy', '{}'::jsonb, 'PENDING', statement_timestamp(), statement_timestamp()
       )`,
      [intentId, `integration-job-${intentId}`, randomUUID()],
    );
    await owner.query(
      `UPDATE governance.job_intents
          SET state = 'ENQUEUEING', enqueued_at = statement_timestamp(),
              queue_job_id = deterministic_job_id, updated_at = statement_timestamp()
        WHERE id = $1`,
      [intentId],
    );
    await owner.query("UPDATE governance.job_intents SET state = 'RUNNING' WHERE id = $1", [
      intentId,
    ]);
    expect(
      await owner.query<{ state: string }>(
        'SELECT state FROM governance.job_intents WHERE id = $1',
        [intentId],
      ),
    ).toMatchObject({ rows: [{ state: 'RUNNING' }] });
    const predicate = await owner.query<{ predicate: string }>(
      `SELECT pg_get_expr(indexprs.indpred, indexprs.indrelid) AS predicate
         FROM pg_index indexprs
         JOIN pg_class index_class ON index_class.oid = indexprs.indexrelid
        WHERE index_class.relname = 'job_intents_enqueue_recovery_idx'`,
    );
    expect(predicate.rows[0]?.predicate).toMatch(/ENQUEUEING/);
    expect(predicate.rows[0]?.predicate).toMatch(/RUNNING/);
  });
});
