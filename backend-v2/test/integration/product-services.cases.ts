import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';

interface Claims {
  readonly userId: string;
  readonly tenantId?: string;
  readonly accessScopeType?: 'TENANT' | 'FACILITY_SET';
  readonly facilityIds?: readonly string[];
  readonly authorityGrantId?: string;
}
interface Party {
  readonly tenantId: string;
  readonly facilityId: string;
  readonly dispatcherUserId: string;
}
interface Fixture {
  readonly requesterUserId: string;
  readonly tripId?: string;
  readonly parties: readonly Party[];
}
interface Harness {
  owner(): Client;
  readonly asApplication: <T>(claims: Claims, work: (client: Client) => Promise<T>) => Promise<T>;
  readonly createUser: () => Promise<string>;
  readonly seedDispatchFixture: (input: { partyCount: 1 | 2; active: boolean }) => Promise<Fixture>;
}

export function productIntegrationCases(harness: Harness): void {
  const { asApplication, createUser, seedDispatchFixture } = harness;
  const result = async (
    client: Client,
    sql: string,
    parameters: unknown[],
  ): Promise<string | boolean | undefined> =>
    (await client.query<{ result: string | boolean }>(sql, parameters)).rows[0]?.result;

  async function completedTrip(): Promise<{
    tripId: string;
    requesterUserId: string;
    party: Party;
  }> {
    const fixture = await seedDispatchFixture({ partyCount: 1, active: true });
    const party = fixture.parties[0],
      tripId = fixture.tripId;
    if (party === undefined || tripId === undefined) throw new Error('Missing product fixture');
    await asApplication(
      { userId: party.dispatcherUserId, tenantId: party.tenantId },
      async (client) => {
        const commands = [
          'DEPART_TO_PICKUP',
          'ARRIVE_AT_PICKUP',
          'BOARD_PATIENT',
          'DEPART_TO_DESTINATION',
          'ARRIVE_AT_DESTINATION',
          'COMPLETE',
        ];
        const statuses = [
          'EN_ROUTE_TO_PICKUP',
          'ARRIVED_AT_PICKUP',
          'PATIENT_ON_BOARD',
          'EN_ROUTE_TO_DESTINATION',
          'ARRIVED_AT_DESTINATION',
          'COMPLETED',
        ];
        for (const [index, command] of commands.entries()) {
          expect(
            await result(
              client,
              `SELECT dispatch.transition_trip($1,$2,$3,$4,$5,$6,'INTEGRATION',NULL,
          NULL,NULL,1200,45000,'NPR'::char(3),'INTEGRATION_FARE') AS result`,
              [tripId, index + 1, randomUUID(), party.dispatcherUserId, command, randomUUID()],
            ),
          ).toBe(statuses[index]);
        }
      },
    );
    const assignmentId = randomUUID();
    await harness.owner().query('BEGIN');
    try {
      await harness.owner().query(
        `INSERT INTO tenancy.memberships(id,tenant_id,user_id,status,joined_at,created_at,updated_at)
        VALUES($1,$2,$3,'ACTIVE',now(),now(),now())`,
        [randomUUID(), party.tenantId, party.dispatcherUserId],
      );
      await harness.owner().query(
        `INSERT INTO access_control.access_assignments(id,tenant_id,user_id,role_profile_id,
        scope_type,status,valid_from,valid_until,granted_by,delegation_evidence,created_at,updated_at)
        VALUES($1,$2,$3,'019a45f0-0000-7000-8200-000000000003','FACILITY_SET','ACTIVE',now()-interval '1 minute',
          now()+interval '1 hour',$3,'{}',now(),now())`,
        [assignmentId, party.tenantId, party.dispatcherUserId],
      );
      await harness.owner().query(
        `INSERT INTO access_control.access_assignment_facilities(tenant_id,assignment_id,facility_id,created_at)
        VALUES($1,$2,$3,now())`,
        [party.tenantId, assignmentId, party.facilityId],
      );
      await harness.owner().query('COMMIT');
    } catch (error) {
      await harness.owner().query('ROLLBACK');
      throw error;
    }
    return { tripId, requesterUserId: fixture.requesterUserId, party };
  }

  async function ticket(userId: string, tripId: string | null = null): Promise<string> {
    const id = randomUUID();
    await asApplication({ userId }, async (client) => {
      expect(
        await result(
          client,
          `SELECT product.create_ticket($1,$2,'SERVICE',$3,decode('abcd','hex'),
        decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),'synthetic-key') AS result`,
          [id, tripId, randomUUID()],
        ),
      ).toBe('OK');
    });
    return id;
  }

  async function supportGrant(
    userId: string,
    allowsPii: boolean,
    includedTenant?: string,
  ): Promise<string> {
    const id = randomUUID(),
      issuer = await createUser(),
      approver = await createUser();
    await harness.owner().query('BEGIN');
    try {
      await harness.owner().query(
        `INSERT INTO access_control.authority_grants(id,subject_user_id,issued_by_user_id,
        approved_by_user_id,role_profile_id,level,national_scope,purpose,human_reason,status,valid_from,expires_at,
        required_assurance,allows_pii,approved_at,approval_reason,created_at,updated_at)
        VALUES($1,$2,$3,$4,'019a45f0-0000-7000-8200-000000000008','PLATFORM',true,'Integration support',
          'Synthetic integration fixture','ACTIVE',now()-interval '1 minute',now()+interval '1 hour','AAL2',$5,
          now(),'Synthetic fixture approval',now(),now())`,
        [id, userId, issuer, approver, allowsPii],
      );
      await harness.owner().query(
        `INSERT INTO access_control.authority_grant_permissions(grant_id,permission_code)
        VALUES($1,'support.ticket.read'),($1,'support.ticket.manage')`,
        [id],
      );
      await harness.owner().query(
        `INSERT INTO access_control.authority_grant_resources(grant_id,resource_class)
        VALUES($1,'support_ticket')`,
        [id],
      );
      if (includedTenant !== undefined)
        await harness.owner().query(
          `INSERT INTO access_control.authority_grant_provider_inclusions(grant_id,tenant_id)
        VALUES($1,$2)`,
          [id, includedTenant],
        );
      await harness.owner().query('COMMIT');
    } catch (error) {
      await harness.owner().query('ROLLBACK');
      throw error;
    }
    return id;
  }

  describe('Phase 6 product commands and forced RLS', () => {
    it('serializes the first preference update and denies direct table writes', async () => {
      const userId = await createUser();
      const attempts = await Promise.all(
        [true, false].map((marketing) =>
          asApplication({ userId }, (client) =>
            result(client, 'SELECT product.replace_preferences(0,true,true,true,$1,$2) AS result', [
              marketing,
              randomUUID(),
            ]),
          ),
        ),
      );
      expect(attempts.sort()).toEqual(['OK', 'STALE_VERSION']);
      await asApplication({ userId }, async (client) => {
        expect(
          (await client.query('SELECT version FROM product.notification_preferences')).rows,
        ).toEqual([{ version: 1 }]);
        expect(
          (
            await client.query(
              `SELECT has_table_privilege(current_user,'product.notification_preferences','UPDATE') AS allowed`,
            )
          ).rows,
        ).toEqual([{ allowed: false }]);
        expect(
          (
            await client.query(`SELECT has_function_privilege(current_user,
          'product.record_fact(uuid,uuid,character varying,character varying,integer,uuid,character varying)','EXECUTE') AS allowed`)
          ).rows,
        ).toEqual([{ allowed: false }]);
      });
      await asApplication({ userId: await createUser() }, async (client) => {
        expect((await client.query('SELECT * FROM product.notification_preferences')).rows).toEqual(
          [],
        );
      });
    });

    it('requires assigned cash permissions, exact fare, and one concurrent collection', async () => {
      const { tripId, party, requesterUserId } = await completedTrip();
      const claims: Claims = {
        userId: party.dispatcherUserId,
        tenantId: party.tenantId,
        accessScopeType: 'FACILITY_SET',
        facilityIds: [party.facilityId],
      };
      const collect = (actor: Claims, amount = '45000'): Promise<string | boolean | undefined> =>
        asApplication(actor, (client) =>
          result(client, 'SELECT product.record_cash($1,$2,7,$3::bigint) AS result', [
            randomUUID(),
            tripId,
            amount,
          ]),
        );
      expect(await collect({ userId: requesterUserId, tenantId: party.tenantId })).toBe(
        'NOT_FOUND',
      );
      expect(await collect({ ...claims, facilityIds: [randomUUID()] })).toBe('NOT_FOUND');
      expect(await collect(claims, '44999')).toBe('AMOUNT_MISMATCH');
      expect((await Promise.all([collect(claims), collect(claims)])).sort()).toEqual([
        'ALREADY_RECORDED',
        'OK',
      ]);
      expect(
        (
          await harness
            .owner()
            .query(
              'SELECT amount_minor::text AS amount, currency FROM product.cash_collections WHERE trip_id=$1',
              [tripId],
            )
        ).rows,
      ).toEqual([{ amount: '45000', currency: 'NPR' }]);
      expect(
        (
          await harness.owner().query(
            `SELECT count(*)::text AS count FROM governance.audit_events
        WHERE resource_id=$1 AND action='billing.cash.recorded' AND tenant_id=$2`,
            [tripId, party.tenantId],
          )
        ).rows,
      ).toEqual([{ count: '1' }]);
      const notification = (
        await harness
          .owner()
          .query<{ id: string }>('SELECT id FROM product.notifications WHERE resource_id=$1', [
            tripId,
          ])
      ).rows[0];
      if (notification === undefined) throw new Error('Missing cash notification');
      await asApplication({ userId: await createUser() }, async (client) => {
        expect((await client.query('SELECT id FROM product.notifications')).rows).toEqual([]);
        expect(
          await result(client, 'SELECT product.mark_notification_read($1,$2) AS result', [
            notification.id,
            randomUUID(),
          ]),
        ).toBe(false);
      });
      await asApplication({ userId: requesterUserId }, async (client) => {
        for (let i = 0; i < 2; i++)
          expect(
            await result(client, 'SELECT product.mark_notification_read($1,$2) AS result', [
              notification.id,
              randomUUID(),
            ]),
          ).toBe(true);
      });
      expect(
        (
          await harness.owner().query(
            `SELECT count(*)::text AS count FROM governance.audit_events
        WHERE resource_id=$1 AND action='communication.notification.read'`,
            [notification.id],
          )
        ).rows,
      ).toEqual([{ count: '1' }]);
    });

    it('rolls back cash, notification, and audit together when the enclosing transaction fails', async () => {
      const { tripId, party } = await completedTrip();
      await expect(
        asApplication(
          { userId: party.dispatcherUserId, tenantId: party.tenantId },
          async (client) => {
            expect(
              await result(client, 'SELECT product.record_cash($1,$2,7,45000) AS result', [
                randomUUID(),
                tripId,
              ]),
            ).toBe('OK');
            throw new Error('Synthetic rollback');
          },
        ),
      ).rejects.toThrow('Synthetic rollback');
      for (const table of [
        'product.cash_collections',
        'product.notifications',
        'governance.audit_events',
        'governance.outbox_events',
      ]) {
        const column =
          table === 'product.cash_collections'
            ? 'trip_id'
            : table === 'governance.outbox_events'
              ? 'aggregate_id'
              : 'resource_id';
        expect(
          (
            await harness
              .owner()
              .query(`SELECT count(*)::text AS count FROM ${table} WHERE ${column}=$1`, [tripId])
          ).rows,
        ).toEqual([{ count: '0' }]);
      }
    });

    it('reserves product outbox events and stream counters for command functions', async () => {
      const userId = await createUser();
      await expect(
        asApplication({ userId }, (client) =>
          client.query(
            `INSERT INTO governance.outbox_events(
        event_id,event_type,schema_version,producer,aggregate_type,aggregate_id,aggregate_version,
        stream_type,stream_id,stream_sequence,correlation_id,causation_id,actor_type,actor_id,event_data,occurred_at,available_at)
        VALUES($1,'support.ticket.created.v1',1,'product-services','support_ticket',$2,1,'product.support_ticket',$2,1,
          'integration-forgery','integration-forgery','USER',$3,'{}',now(),now())`,
            [randomUUID(), randomUUID(), userId],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asApplication({ userId }, (client) =>
          client.query(
            `INSERT INTO governance.event_stream_sequences(
        stream_type,stream_id,current_sequence,updated_at) VALUES('product.support_ticket',$1,1,now())`,
            [randomUUID()],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const id = await ticket(userId);
      expect(
        (
          await harness.owner().query(
            `SELECT event_type,stream_sequence::text,event_data FROM governance.outbox_events
        WHERE aggregate_id=$1`,
            [id],
          )
        ).rows,
      ).toEqual([
        {
          event_type: 'support.ticket.created.v1',
          stream_sequence: '1',
          event_data: { resourceId: id, version: 1 },
        },
      ]);
    });

    it('reconciles exact completion-cohort totals only inside report scope', async () => {
      const { tripId, party } = await completedTrip();
      const reporter = await createUser();
      await harness.owner().query(
        `INSERT INTO tenancy.memberships(id,tenant_id,user_id,status,joined_at,created_at,updated_at)
        VALUES($1,$2,$3,'ACTIVE',now(),now(),now())`,
        [randomUUID(), party.tenantId, reporter],
      );
      await harness.owner().query(
        `INSERT INTO access_control.access_assignments(id,tenant_id,user_id,role_profile_id,
        scope_type,status,valid_from,valid_until,granted_by,delegation_evidence,created_at,updated_at)
        VALUES($1,$2,$3,'019a45f0-0000-7000-8200-000000000005','TENANT','ACTIVE',now()-interval '1 minute',
          now()+interval '1 hour',$3,'{}',now(),now())`,
        [randomUUID(), party.tenantId, reporter],
      );
      const query = `SELECT completed_trips::text,recorded_trips::text,fare_minor::text,recorded_minor::text,unrecorded_minor::text
        FROM product.cash_summary(now()-interval '1 hour',now()+interval '1 hour')`;
      await asApplication({ userId: reporter, tenantId: party.tenantId }, async (client) => {
        expect((await client.query(query)).rows).toEqual([
          {
            completed_trips: '1',
            recorded_trips: '0',
            fare_minor: '45000',
            recorded_minor: '0',
            unrecorded_minor: '45000',
          },
        ]);
      });
      await asApplication(
        { userId: party.dispatcherUserId, tenantId: party.tenantId },
        async (client) => {
          expect((await client.query(query)).rows).toEqual([]);
          expect(
            await result(client, 'SELECT product.record_cash($1,$2,7,45000) AS result', [
              randomUUID(),
              tripId,
            ]),
          ).toBe('OK');
        },
      );
      await asApplication({ userId: reporter, tenantId: party.tenantId }, async (client) => {
        expect((await client.query(query)).rows).toEqual([
          {
            completed_trips: '1',
            recorded_trips: '1',
            fare_minor: '45000',
            recorded_minor: '45000',
            unrecorded_minor: '0',
          },
        ]);
      });
      await asApplication(
        {
          userId: reporter,
          tenantId: party.tenantId,
          accessScopeType: 'FACILITY_SET',
          facilityIds: [randomUUID()],
        },
        async (client) => {
          expect((await client.query(query)).rows).toEqual([]);
        },
      );
    });

    it('allows one requester rating only after completion', async () => {
      const active = await seedDispatchFixture({ partyCount: 1, active: true });
      expect(
        await asApplication({ userId: active.requesterUserId }, (client) =>
          result(client, 'SELECT product.rate_trip($1,$2,1,5::smallint) AS result', [
            randomUUID(),
            active.tripId,
          ]),
        ),
      ).toBe('INVALID_STATE');
      const { tripId, requesterUserId, party } = await completedTrip();
      const rate = (claims: Claims): Promise<string | boolean | undefined> =>
        asApplication(claims, (client) =>
          result(client, 'SELECT product.rate_trip($1,$2,7,5::smallint) AS result', [
            randomUUID(),
            tripId,
          ]),
        );
      expect(await rate({ userId: party.dispatcherUserId })).toBe('NOT_FOUND');
      expect(await rate({ userId: requesterUserId, tenantId: party.tenantId })).toBe('NOT_FOUND');
      expect(
        (
          await Promise.all([rate({ userId: requesterUserId }), rate({ userId: requesterUserId })])
        ).sort(),
      ).toEqual(['ALREADY_RECORDED', 'OK']);
    });

    it('separates support metadata, content and requester ownership; serializes resolution against reply', async () => {
      const userId = await createUser(),
        agentId = await createUser();
      const id = await ticket(userId);
      const metadataGrant = await supportGrant(agentId, false);
      const contentGrant = await supportGrant(agentId, true);
      await asApplication({ userId: await createUser() }, async (client) => {
        expect(
          (await client.query('SELECT id FROM product.support_tickets WHERE id=$1', [id])).rows,
        ).toEqual([]);
        expect(
          (await client.query('SELECT id FROM product.support_messages WHERE ticket_id=$1', [id]))
            .rows,
        ).toEqual([]);
      });
      await asApplication({ userId: agentId, authorityGrantId: metadataGrant }, async (client) => {
        expect(
          (await client.query('SELECT id FROM product.support_tickets WHERE id=$1', [id])).rows,
        ).toHaveLength(1);
        expect(
          (await client.query('SELECT id FROM product.support_messages WHERE ticket_id=$1', [id]))
            .rows,
        ).toEqual([]);
        expect(
          await result(client, 'SELECT product.audit_ticket_content($1,$2) AS result', [
            id,
            randomUUID(),
          ]),
        ).toBe(false);
      });
      await asApplication({ userId: agentId, authorityGrantId: contentGrant }, async (client) => {
        expect(
          await result(client, 'SELECT product.audit_ticket_content($1,$2) AS result', [
            id,
            randomUUID(),
          ]),
        ).toBe(true);
        expect(
          (await client.query('SELECT id FROM product.support_messages WHERE ticket_id=$1', [id]))
            .rows,
        ).toHaveLength(1);
      });
      expect(
        await asApplication({ userId }, (client) =>
          result(
            client,
            "SELECT product.transition_ticket($1,1,'RESOLVE','ISSUE_RESOLVED',$2) AS result",
            [id, randomUUID()],
          ),
        ),
      ).toBe('NOT_FOUND');
      const outcomes = await Promise.all([
        asApplication({ userId: agentId, authorityGrantId: contentGrant }, (client) =>
          result(
            client,
            "SELECT product.transition_ticket($1,1,'RESOLVE','ISSUE_RESOLVED',$2) AS result",
            [id, randomUUID()],
          ),
        ),
        asApplication({ userId }, (client) =>
          result(
            client,
            `SELECT product.reply_ticket($1,1,$2,decode('abcd','hex'),
          decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),'synthetic-key') AS result`,
            [id, randomUUID()],
          ),
        ),
      ]);
      expect(outcomes.sort()).toEqual(['OK', 'STALE_VERSION']);
    });

    it('honors authority provider inclusions and rejects unrelated trip tickets', async () => {
      const first = await completedTrip(),
        second = await completedTrip();
      const firstId = await ticket(first.requesterUserId, first.tripId),
        secondId = await ticket(second.requesterUserId, second.tripId);
      const agentId = await createUser(),
        grant = await supportGrant(agentId, true, first.party.tenantId);
      await asApplication({ userId: agentId, authorityGrantId: grant }, async (client) => {
        expect(
          (
            await client.query('SELECT id FROM product.support_tickets WHERE id=ANY($1::uuid[])', [
              [firstId, secondId],
            ])
          ).rows,
        ).toEqual([{ id: firstId }]);
      });
      expect(
        await asApplication({ userId: first.requesterUserId }, (client) =>
          result(
            client,
            `SELECT product.create_ticket($1,$2,'SERVICE',$3,
        decode('abcd','hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),'synthetic-key') AS result`,
            [randomUUID(), second.tripId, randomUUID()],
          ),
        ),
      ).toBe('NOT_FOUND');
    });
  });
}
