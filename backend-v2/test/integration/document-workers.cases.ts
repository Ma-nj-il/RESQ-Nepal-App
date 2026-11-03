import { randomUUID } from 'node:crypto';

import type { Client, QueryResult } from 'pg';

interface Party {
  readonly tenantId: string;
  readonly facilityId: string;
  readonly ambulanceId: string;
}
interface Harness {
  owner(): Client;
  createUser(): Promise<string>;
  seedDispatchFixture(input: {
    partyCount: 1 | 2;
    active: boolean;
  }): Promise<{ readonly parties: readonly Party[] }>;
}

export function documentWorkerCases(harness: Harness): void {
  async function document(party?: Party): Promise<{ id: string; linkId: string }> {
    const owner = harness.owner(),
      userId = await harness.createUser(),
      id = randomUUID(),
      linkId = randomUUID();
    await owner.query(
      `INSERT INTO documents.document_objects(id,uploaded_by_user_id,owner_user_id,tenant_id,facility_id,
      object_key,expected_sha256,size_bytes,declared_mime_type,upload_status,version,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,decode(repeat('ab',32),'hex'),100,'application/pdf','SCANNING',2,now(),now())`,
      [
        id,
        userId,
        party === undefined ? userId : null,
        party?.tenantId ?? null,
        party?.facilityId ?? null,
        `restricted/documents/${id}`,
      ],
    );
    if (party === undefined) {
      await owner.query(
        `INSERT INTO documents.user_identity_documents(id,user_id,document_object_id,document_type,review_status,expires_on,created_at,updated_at)
        VALUES($1,$2,$3,'IDENTITY','NOT_SUBMITTED',CURRENT_DATE-1,now(),now())`,
        [linkId, userId, id],
      );
    } else {
      await owner.query(
        `INSERT INTO documents.ambulance_documents(id,tenant_id,facility_id,ambulance_id,document_object_id,document_type,review_status,expires_on,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'REGISTRATION','NOT_SUBMITTED',CURRENT_DATE-1,now(),now())`,
        [linkId, party.tenantId, party.facilityId, party.ambulanceId, id],
      );
    }
    return { id, linkId };
  }

  async function intent(
    resourceId: string,
    options: { tenantId?: string; type?: string; resourceType?: string; version?: number } = {},
  ): Promise<{ id: string; executionId: string }> {
    const id = randomUUID(),
      executionId = randomUUID(),
      type = options.type ?? 'document.scan-object.v1';
    await harness.owner().query(
      `INSERT INTO governance.job_intents(id,deterministic_job_id,job_type,queue_name,tenant_id,
      resource_type,resource_id,resource_version,run_at,correlation_id,causation_id,requested_by_type,requested_by_id,
      job_data,state,enqueued_at,queue_job_id,created_at,updated_at,execution_id)
      VALUES($1::uuid,$1::uuid::text,$2,$3,$4,$5,$6,$7,now(),'document-integration','document-integration','SYSTEM_POLICY','fixture',
      '{}','RUNNING',now(),$1::uuid::text,now(),now(),$8)`,
      [
        id,
        type,
        type.startsWith('document.') ? 'documents' : 'compliance',
        options.tenantId ?? null,
        options.resourceType ?? 'documentObject',
        resourceId,
        options.version ?? 2,
        executionId,
      ],
    );
    return { id, executionId };
  }

  async function worker<T>(
    claim: { id: string; executionId: string },
    work: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = harness.owner();
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE resq_worker');
      await client.query(
        "SELECT set_config('app.job_intent_id',$1,true),set_config('app.job_execution_id',$2,true)",
        [claim.id, claim.executionId],
      );
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  const scan = (
    client: Client,
    id: string,
    version = 2,
  ): Promise<QueryResult<{ changed: boolean }>> =>
    client.query<{ changed: boolean }>(
      "SELECT documents.record_worker_scan($1,$2,'READY','application/pdf','CLEAN') AS changed",
      [id, version],
    );

  describe('durable document worker PostgreSQL authority', () => {
    it('reads only the bound personal document and rejects direct mutation', async () => {
      const target = await document(),
        other = await document(),
        claim = await intent(target.id);
      await worker(claim, async (client) => {
        expect((await client.query('SELECT id FROM documents.document_projection')).rows).toEqual([
          { id: target.id },
        ]);
        expect((await scan(client, other.id)).rows).toEqual([{ changed: false }]);
        expect((await scan(client, target.id)).rows).toEqual([{ changed: true }]);
      });
      await expect(
        worker(claim, (client) =>
          client.query("UPDATE documents.document_objects SET upload_status='READY' WHERE id=$1", [
            target.id,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      expect(
        (
          await harness
            .owner()
            .query('SELECT version,upload_status FROM documents.document_objects WHERE id=$1', [
              target.id,
            ])
        ).rows,
      ).toEqual([{ version: 3, upload_status: 'READY' }]);
    });

    it('rejects tenant mismatches even with a broad tenant context', async () => {
      const fixture = await harness.seedDispatchFixture({ partyCount: 2, active: false });
      const first = fixture.parties[0],
        second = fixture.parties[1];
      if (first === undefined || second === undefined) throw new Error('Missing tenant fixtures');
      const target = await document(first),
        other = await document(second);
      const wrong = await intent(target.id, { tenantId: second.tenantId });
      await worker(wrong, async (client) => {
        await client.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.access_scope_type','TENANT',true)",
          [first.tenantId],
        );
        expect((await client.query('SELECT id FROM documents.document_projection')).rows).toEqual(
          [],
        );
        expect((await scan(client, target.id)).rows).toEqual([{ changed: false }]);
      });
      const bound = await intent(target.id, { tenantId: first.tenantId });
      await worker(bound, async (client) => {
        expect((await client.query('SELECT id FROM documents.document_projection')).rows).toEqual([
          { id: target.id },
        ]);
        expect((await scan(client, other.id)).rows).toEqual([{ changed: false }]);
      });
    });

    it('fences replaced executions, stale versions, wrong operations and terminal intents', async () => {
      const target = await document(),
        claim = await intent(target.id);
      await worker({ ...claim, executionId: randomUUID() }, async (client) => {
        expect((await scan(client, target.id)).rows).toEqual([{ changed: false }]);
        expect((await client.query('SELECT id FROM documents.document_projection')).rows).toEqual(
          [],
        );
      });
      await worker(claim, async (client) => {
        expect((await scan(client, target.id, 3)).rows).toEqual([{ changed: false }]);
        expect(
          (
            await client.query('SELECT documents.expire_worker_document($1,2) AS changed', [
              target.id,
            ])
          ).rows,
        ).toEqual([{ changed: false }]);
      });
      await harness
        .owner()
        .query(
          "UPDATE governance.job_intents SET state='SUCCEEDED',completed_at=now(),result_code='DONE' WHERE id=$1",
          [claim.id],
        );
      await worker(claim, async (client) => {
        expect((await scan(client, target.id)).rows).toEqual([{ changed: false }]);
        expect((await client.query('SELECT id FROM documents.document_projection')).rows).toEqual(
          [],
        );
      });
    });

    it('requires matching allowed MIME at the database boundary', async () => {
      const target = await document(),
        claim = await intent(target.id);
      await worker(claim, async (client) => {
        expect(
          (
            await client.query(
              "SELECT documents.record_worker_scan($1,2,'READY','image/png','CLEAN') AS changed",
              [target.id],
            )
          ).rows,
        ).toEqual([{ changed: false }]);
      });
      expect(
        (
          await harness
            .owner()
            .query('SELECT upload_status FROM documents.document_objects WHERE id=$1', [target.id])
        ).rows,
      ).toEqual([{ upload_status: 'SCANNING' }]);
    });

    it('expires once and rolls back if the enclosing evidence transaction fails', async () => {
      const target = await document();
      await harness
        .owner()
        .query("UPDATE documents.document_objects SET upload_status='READY' WHERE id=$1", [
          target.id,
        ]);
      await harness
        .owner()
        .query(
          "UPDATE documents.user_identity_documents SET review_status='APPROVED' WHERE id=$1",
          [target.linkId],
        );
      const claim = await intent(target.id, { type: 'document.expire.v1' });
      await expect(
        worker(claim, async (client) => {
          expect(
            (
              await client.query('SELECT documents.expire_worker_document($1,2) AS changed', [
                target.id,
              ])
            ).rows,
          ).toEqual([{ changed: true }]);
          throw new Error('simulated evidence write failure');
        }),
      ).rejects.toThrow('simulated evidence write failure');
      expect(
        (
          await harness
            .owner()
            .query('SELECT version FROM documents.document_objects WHERE id=$1', [target.id])
        ).rows,
      ).toEqual([{ version: 2 }]);
      await worker(claim, async (client) => {
        expect(
          (
            await client.query('SELECT documents.expire_worker_document($1,2) AS changed', [
              target.id,
            ])
          ).rows,
        ).toEqual([{ changed: true }]);
        expect(
          (
            await client.query('SELECT documents.expire_worker_document($1,2) AS changed', [
              target.id,
            ])
          ).rows,
        ).toEqual([{ changed: false }]);
      });
    });

    it('recalculates only the linked ambulance without repeating a readiness change', async () => {
      const fixture = await harness.seedDispatchFixture({ partyCount: 2, active: false });
      const party = fixture.parties[0],
        other = fixture.parties[1];
      if (party === undefined || other === undefined) throw new Error('Missing tenant fixtures');
      const target = await document(party);
      await harness
        .owner()
        .query(
          "UPDATE fleet.ambulances SET readiness_status='READY',readiness_reasons='{}' WHERE id=$1",
          [party.ambulanceId],
        );
      await harness
        .owner()
        .query('DELETE FROM documents.ambulance_documents WHERE ambulance_id=$1 AND id<>$2', [
          party.ambulanceId,
          target.linkId,
        ]);
      const claim = await intent(target.id, {
        tenantId: party.tenantId,
        type: 'compliance.recalculate-readiness.v1',
      });
      await worker(claim, async (client) => {
        expect(
          (
            await client.query('SELECT * FROM documents.refresh_worker_readiness($1,2)', [
              other.ambulanceId,
            ])
          ).rows,
        ).toEqual([]);
        const changed = (
          await client.query('SELECT * FROM documents.refresh_worker_readiness($1,2)', [target.id])
        ).rows;
        expect(changed).toHaveLength(1);
        expect(changed[0]).toMatchObject({
          ambulance_id: party.ambulanceId,
          readiness_status: 'BLOCKED',
        });
        expect(
          (
            await client.query('SELECT * FROM documents.refresh_worker_readiness($1,2)', [
              target.id,
            ])
          ).rows,
        ).toEqual([]);
      });
    });
  });
}
