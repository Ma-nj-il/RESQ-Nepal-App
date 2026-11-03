import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { DataSource } from 'typeorm';

import { DocumentJobProcessor } from '../../src/provider-operations/application/document-job.processor.js';
import { DocumentService } from '../../src/provider-operations/application/document.service.js';
import type { ObjectStorage } from '../../src/provider-operations/application/ports/object-storage.js';
import { PostgresDocumentRepository } from '../../src/provider-operations/infrastructure/persistence/postgres-document.repository.js';
import { PostgresReadinessRepository } from '../../src/provider-operations/infrastructure/persistence/postgres-readiness.repository.js';
import type { AuditWriter } from '../../src/shared/application/audit/audit-writer.js';
import type { IdempotencyExecutor } from '../../src/shared/application/idempotency/idempotency.js';
import type { JobIntentEnvelope } from '../../src/shared/application/messaging/job-intent.js';
import { PostgresAuditWriter } from '../../src/shared/infrastructure/audit/postgres-audit-writer.js';
import type { ApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';
import { PostgresDeliveryWriter } from '../../src/shared/infrastructure/messaging/postgres-delivery-writer.js';
import type { DatabaseService } from '../../src/shared/infrastructure/persistence/database.service.js';
import { TypeOrmUnitOfWork } from '../../src/shared/infrastructure/persistence/typeorm-unit-of-work.js';

export function documentPersistenceCases(harness: {
  config(): ApplicationConfig;
  owner(): Client;
  createUser(): Promise<string>;
}): void {
  async function fixture(): Promise<{ job: JobIntentEnvelope; linkId: string }> {
    const owner = harness.owner(),
      userId = await harness.createUser(),
      resourceId = randomUUID(),
      linkId = randomUUID();
    const job: JobIntentEnvelope = {
      jobIntentId: randomUUID(),
      executionId: randomUUID(),
      jobType: 'document.scan-object.v1',
      resourceType: 'documentObject',
      resourceId,
      resourceVersion: 2,
      runAt: new Date().toISOString(),
      correlationId: randomUUID(),
      causationId: randomUUID(),
      data: {},
    };
    await owner.query(
      `INSERT INTO documents.document_objects(id,uploaded_by_user_id,owner_user_id,object_key,expected_sha256,size_bytes,
      declared_mime_type,upload_status,version,created_at,updated_at) VALUES($1,$2,$2,$3,decode(repeat('ab',32),'hex'),100,'application/pdf','SCANNING',2,now(),now())`,
      [resourceId, userId, `restricted/documents/${resourceId}`],
    );
    await owner.query(
      `INSERT INTO documents.user_identity_documents(id,user_id,document_object_id,document_type,review_status,created_at,updated_at)
      VALUES($1,$2,$3,'IDENTITY','NOT_SUBMITTED',now(),now())`,
      [linkId, userId, resourceId],
    );
    await owner.query(
      `INSERT INTO governance.job_intents(id,deterministic_job_id,job_type,queue_name,resource_type,resource_id,resource_version,run_at,
      correlation_id,causation_id,requested_by_type,requested_by_id,state,enqueued_at,queue_job_id,created_at,updated_at,execution_id)
      VALUES($1::uuid,$1::uuid::text,'document.scan-object.v1','documents','documentObject',$2,2,now(),$3,$3,'SYSTEM_POLICY','fixture','RUNNING',now(),$1::uuid::text,now(),now(),$4)`,
      [job.jobIntentId, resourceId, job.correlationId, job.executionId],
    );
    return { job, linkId };
  }

  async function persistence(
    work: (source: DataSource, processor: DocumentJobProcessor) => Promise<void>,
    audit: AuditWriter = new PostgresAuditWriter(),
  ): Promise<void> {
    const url = harness.config().dependencies.database.migrationUrl;
    if (url === undefined) throw new Error('Integration owner connection required');
    const source = new DataSource({
      type: 'postgres',
      url,
      entities: [],
      synchronize: false,
      extra: { options: '-c role=resq_worker', max: 4 },
    });
    await source.initialize();
    try {
      expect(await source.query('SELECT current_user AS role')).toEqual([{ role: 'resq_worker' }]);
      const database = {
        getDataSource: () => Promise.resolve(source),
      } as unknown as DatabaseService;
      const unit = new TypeOrmUnitOfWork(database, { generate: randomUUID }),
        delivery = new PostgresDeliveryWriter();
      const clock = { now: () => new Date() },
        ids = { generate: randomUUID };
      const documents = new DocumentService(
        new PostgresDocumentRepository(),
        {} as ObjectStorage,
        {
          scanImmutableObject: () =>
            Promise.resolve({
              outcome: 'CLEAN',
              detectedMimeType: 'application/pdf',
              scannerCode: 'SYNTHETIC.CLEAN',
            }),
        },
        {} as IdempotencyExecutor,
        unit,
        audit,
        delivery,
        clock,
        ids,
      );
      await work(
        source,
        new DocumentJobProcessor(
          documents,
          new PostgresReadinessRepository(),
          unit,
          audit,
          delivery,
          clock,
          ids,
        ),
      );
    } finally {
      await source.destroy();
    }
  }

  it('commits one scan event and causation-bound audit under concurrent document processing', async () => {
    const { job, linkId } = await fixture();
    await persistence(async (_source, processor) => {
      await Promise.all([processor.process(job), processor.process(job)]);
      await processor.process(job);
    });
    const owner = harness.owner();
    expect(
      (
        await owner.query(
          'SELECT upload_status,version FROM documents.document_objects WHERE id=$1',
          [job.resourceId],
        )
      ).rows,
    ).toEqual([{ upload_status: 'READY', version: 3 }]);
    expect(
      (
        await owner.query('SELECT event_type FROM governance.outbox_events WHERE aggregate_id=$1', [
          job.resourceId,
        ])
      ).rows,
    ).toEqual([{ event_type: 'document.object-ready.v1' }]);
    expect(
      (
        await owner.query(
          'SELECT action,causation_id FROM governance.audit_events WHERE resource_id=$1',
          [linkId],
        )
      ).rows,
    ).toEqual([{ action: 'document.scan', causation_id: job.jobIntentId }]);
  });

  it('rolls back document, link, event and audit together if evidence completion fails', async () => {
    const { job, linkId } = await fixture();
    await persistence(
      async (_source, processor) => {
        await expect(processor.process(job)).rejects.toThrow('synthetic evidence failure');
      },
      {
        append: async (transaction, input) => {
          await new PostgresAuditWriter().append(transaction, input);
          throw new Error('synthetic evidence failure');
        },
      },
    );
    const owner = harness.owner();
    expect(
      (
        await owner.query(
          'SELECT upload_status,version FROM documents.document_objects WHERE id=$1',
          [job.resourceId],
        )
      ).rows,
    ).toEqual([{ upload_status: 'SCANNING', version: 2 }]);
    expect(
      (
        await owner.query(
          'SELECT review_status FROM documents.user_identity_documents WHERE id=$1',
          [linkId],
        )
      ).rows,
    ).toEqual([{ review_status: 'NOT_SUBMITTED' }]);
    expect(
      (
        await owner.query('SELECT event_id FROM governance.outbox_events WHERE aggregate_id=$1', [
          job.resourceId,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (await owner.query('SELECT id FROM governance.audit_events WHERE resource_id=$1', [linkId]))
        .rows,
    ).toEqual([]);
  });

  it('holds the execution fence until the document transaction commits', async () => {
    const { job } = await fixture();
    await persistence(async (source) => {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(
          "SELECT set_config('app.job_intent_id',$1,true),set_config('app.job_execution_id',$2,true)",
          [job.jobIntentId, job.executionId],
        );
        expect(
          await runner.query(
            "SELECT documents.record_worker_scan($1,2,'READY','application/pdf','CLEAN') AS changed",
            [job.resourceId],
          ),
        ).toEqual([{ changed: true }]);
        await harness.owner().query("SET lock_timeout='150ms'");
        await expect(
          harness
            .owner()
            .query('UPDATE governance.job_intents SET execution_id=$2 WHERE id=$1', [
              job.jobIntentId,
              randomUUID(),
            ]),
        ).rejects.toMatchObject({ code: '55P03' });
        await runner.commitTransaction();
        await harness
          .owner()
          .query('UPDATE governance.job_intents SET execution_id=$2 WHERE id=$1', [
            job.jobIntentId,
            randomUUID(),
          ]);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await harness.owner().query('RESET lock_timeout');
      }
    });
  });
}
