import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import { entityManagerFor } from '../../../shared/infrastructure/persistence/typeorm-unit-of-work.js';
import type {
  DocumentRecord,
  DocumentRepository,
  DocumentReviewRecord,
  DocumentSubject,
} from '../../application/ports/document.repository.js';

interface DocumentProjectionRow {
  readonly id: string;
  readonly link_id: string;
  readonly uploaded_by_user_id: string;
  readonly owner_user_id: string | null;
  readonly tenant_id: string | null;
  readonly facility_id: string | null;
  readonly subject_type: DocumentSubject['type'];
  readonly subject_id: string;
  readonly document_type: string;
  readonly object_key: string;
  readonly expected_sha256: string;
  readonly size_bytes: string;
  readonly declared_mime_type: string;
  readonly detected_mime_type: string | null;
  readonly upload_status: DocumentRecord['uploadStatus'];
  readonly review_status: DocumentRecord['reviewStatus'];
  readonly expires_on: string | null;
  readonly version: number;
}

const DOCUMENT_SELECT = `
  SELECT id, link_id, uploaded_by_user_id, owner_user_id, tenant_id, facility_id,
         subject_type, subject_id, document_type, object_key, expected_sha256,
         size_bytes::text, declared_mime_type, detected_mime_type, upload_status,
         review_status, expires_on::text, version
    FROM documents.document_projection`;

function subjectFrom(row: DocumentProjectionRow): DocumentSubject {
  switch (row.subject_type) {
    case 'USER_IDENTITY':
      return { type: row.subject_type, userId: row.subject_id };
    case 'PROVIDER_APPLICATION':
      return { type: row.subject_type, applicationId: row.subject_id };
    case 'DRIVER_APPLICATION':
      return { type: row.subject_type, applicationId: row.subject_id };
    case 'DRIVER':
      return { type: row.subject_type, driverId: row.subject_id };
    case 'AMBULANCE':
      return { type: row.subject_type, ambulanceId: row.subject_id };
    case 'FACILITY':
      return { type: row.subject_type, facilityId: row.subject_id };
  }
}

function documentFrom(row: DocumentProjectionRow): DocumentRecord {
  return {
    id: row.id,
    linkId: row.link_id,
    uploadedByUserId: row.uploaded_by_user_id,
    ...(row.owner_user_id === null ? {} : { ownerUserId: row.owner_user_id }),
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.facility_id === null ? {} : { facilityId: row.facility_id }),
    subject: subjectFrom(row),
    documentType: row.document_type,
    objectKey: row.object_key,
    expectedSha256: row.expected_sha256,
    sizeBytes: Number(row.size_bytes),
    declaredMimeType: row.declared_mime_type,
    ...(row.detected_mime_type === null ? {} : { detectedMimeType: row.detected_mime_type }),
    uploadStatus: row.upload_status,
    reviewStatus: row.review_status,
    ...(row.expires_on === null ? {} : { expiresOn: row.expires_on }),
    version: row.version,
  };
}

function unavailableSubject(): ApplicationError {
  return new ApplicationError({
    code: 'RESOURCE.NOT_FOUND',
    message: 'The requested resource was not found.',
    status: 404,
  });
}

async function findDocument(
  manager: EntityManager,
  documentObjectId: string,
): Promise<DocumentRecord | undefined> {
  const rows: DocumentProjectionRow[] = await manager.query(`${DOCUMENT_SELECT} WHERE id = $1`, [
    documentObjectId,
  ]);
  return rows[0] === undefined ? undefined : documentFrom(rows[0]);
}

async function insertSubjectLink(
  manager: EntityManager,
  input: Parameters<DocumentRepository['createPendingDocument']>[1],
): Promise<void> {
  let rows: { id: string }[];
  switch (input.subject.type) {
    case 'USER_IDENTITY':
      rows = await manager.query(
        `INSERT INTO documents.user_identity_documents (
           id, user_id, document_object_id, document_type, review_status,
           expires_on, version, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$7) RETURNING id`,
        [
          input.linkId,
          input.subject.userId,
          input.id,
          input.documentType,
          input.reviewStatus,
          input.expiresOn ?? null,
          input.now,
        ],
      );
      break;
    case 'PROVIDER_APPLICATION':
      rows = await manager.query(
        `INSERT INTO documents.provider_application_documents (
           id, provider_application_id, document_object_id, document_type,
           review_status, expires_on, version, created_at, updated_at
         ) SELECT $1, application.id, $2, $3, $4, $5, 1, $6, $6
             FROM provider_registry.provider_applications application
            WHERE application.id = $7
         RETURNING id`,
        [
          input.linkId,
          input.id,
          input.documentType,
          input.reviewStatus,
          input.expiresOn ?? null,
          input.now,
          input.subject.applicationId,
        ],
      );
      break;
    case 'DRIVER_APPLICATION':
      rows = await manager.query(
        `INSERT INTO documents.driver_application_documents (
           id, tenant_id, facility_id, driver_application_id, document_object_id,
           document_type, review_status, expires_on, version, created_at, updated_at
         ) SELECT $1, application.tenant_id, application.facility_id, application.id, $2,
                  $3, $4, $5, 1, $6, $6
             FROM workforce.driver_applications application
            WHERE application.id = $7
         RETURNING id`,
        [
          input.linkId,
          input.id,
          input.documentType,
          input.reviewStatus,
          input.expiresOn ?? null,
          input.now,
          input.subject.applicationId,
        ],
      );
      break;
    case 'DRIVER':
      rows = await manager.query(
        `INSERT INTO documents.driver_documents (
           id, tenant_id, driver_id, document_object_id, document_type,
           review_status, expires_on, version, created_at, updated_at
         ) SELECT $1, driver.tenant_id, driver.id, $2, $3, $4, $5, 1, $6, $6
             FROM workforce.driver_profiles driver
            WHERE driver.id = $7 AND driver.tenant_id = $8
         RETURNING id`,
        [
          input.linkId,
          input.id,
          input.documentType,
          input.reviewStatus,
          input.expiresOn ?? null,
          input.now,
          input.subject.driverId,
          input.tenantId ?? null,
        ],
      );
      break;
    case 'AMBULANCE':
      rows = await manager.query(
        `INSERT INTO documents.ambulance_documents (
           id, tenant_id, facility_id, ambulance_id, document_object_id, document_type,
           review_status, expires_on, version, created_at, updated_at
         ) SELECT $1, ambulance.tenant_id, ambulance.facility_id, ambulance.id, $2,
                  $3, $4, $5, 1, $6, $6
             FROM fleet.ambulances ambulance
            WHERE ambulance.id = $7 AND ambulance.tenant_id = $8
              AND ambulance.facility_id = $9
         RETURNING id`,
        [
          input.linkId,
          input.id,
          input.documentType,
          input.reviewStatus,
          input.expiresOn ?? null,
          input.now,
          input.subject.ambulanceId,
          input.tenantId ?? null,
          input.facilityId ?? null,
        ],
      );
      break;
    case 'FACILITY':
      rows = await manager.query(
        `INSERT INTO documents.facility_documents (
           id, tenant_id, facility_id, document_object_id, document_type,
           review_status, expires_on, version, created_at, updated_at
         ) SELECT $1, facility.tenant_id, facility.id, $2, $3, $4, $5, 1, $6, $6
             FROM tenancy.facilities facility
            WHERE facility.id = $7 AND facility.tenant_id = $8
         RETURNING id`,
        [
          input.linkId,
          input.id,
          input.documentType,
          input.reviewStatus,
          input.expiresOn ?? null,
          input.now,
          input.subject.facilityId,
          input.tenantId ?? null,
        ],
      );
      break;
  }
  if (rows[0] === undefined) throw unavailableSubject();
}

interface SubjectLink {
  readonly table: string;
  readonly reviewColumn: string;
}

function subjectLink(subject: DocumentSubject): SubjectLink {
  switch (subject.type) {
    case 'USER_IDENTITY':
      return {
        table: 'documents.user_identity_documents',
        reviewColumn: 'user_identity_document_id',
      };
    case 'PROVIDER_APPLICATION':
      return {
        table: 'documents.provider_application_documents',
        reviewColumn: 'provider_application_document_id',
      };
    case 'DRIVER_APPLICATION':
      return {
        table: 'documents.driver_application_documents',
        reviewColumn: 'driver_application_document_id',
      };
    case 'DRIVER':
      return { table: 'documents.driver_documents', reviewColumn: 'driver_document_id' };
    case 'AMBULANCE':
      return { table: 'documents.ambulance_documents', reviewColumn: 'ambulance_document_id' };
    case 'FACILITY':
      return { table: 'documents.facility_documents', reviewColumn: 'facility_document_id' };
  }
}

async function changeReviewStatus(
  manager: EntityManager,
  document: DocumentRecord,
  status: DocumentRecord['reviewStatus'],
  now: Date,
  condition = '',
  parameters: readonly unknown[] = [],
): Promise<boolean> {
  const link = subjectLink(document.subject);
  const rows: { id: string }[] = await manager.query(
    `UPDATE ${link.table}
        SET review_status = $2, version = version + 1, updated_at = $3
      WHERE id = $1 ${condition}
      RETURNING id`,
    [document.linkId, status, now, ...parameters],
  );
  return rows[0] !== undefined;
}

@Injectable()
export class PostgresDocumentRepository implements DocumentRepository {
  async createPendingDocument(
    transaction: TransactionContext,
    input: Parameters<DocumentRepository['createPendingDocument']>[1],
  ): Promise<DocumentRecord> {
    const manager = entityManagerFor(transaction);
    await manager.query(
      `INSERT INTO documents.document_objects (
         id, uploaded_by_user_id, owner_user_id, tenant_id, facility_id, object_key,
         expected_sha256, size_bytes, declared_mime_type, upload_status, version,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,decode($7,'hex'),$8,$9,$10,1,$11,$11)`,
      [
        input.id,
        input.uploadedByUserId,
        input.ownerUserId ?? null,
        input.tenantId ?? null,
        input.facilityId ?? null,
        input.objectKey,
        input.expectedSha256,
        input.sizeBytes,
        input.declaredMimeType,
        input.uploadStatus,
        input.now,
      ],
    );
    await insertSubjectLink(manager, input);
    const created = await findDocument(manager, input.id);
    if (created === undefined) throw unavailableSubject();
    return created;
  }

  findDocument(
    transaction: TransactionContext,
    documentObjectId: string,
  ): Promise<DocumentRecord | undefined> {
    return findDocument(entityManagerFor(transaction), documentObjectId);
  }

  async listDocuments(transaction: TransactionContext): Promise<readonly DocumentRecord[]> {
    const rows: DocumentProjectionRow[] = await entityManagerFor(transaction).query(
      `${DOCUMENT_SELECT} ORDER BY id`,
    );
    return rows.map(documentFrom);
  }

  async markUploadedForScan(
    transaction: TransactionContext,
    input: Parameters<DocumentRepository['markUploadedForScan']>[1],
  ): Promise<DocumentRecord | undefined> {
    const rows: { id: string }[] = await entityManagerFor(transaction).query(
      `UPDATE documents.document_objects
          SET upload_status = 'SCANNING', detected_mime_type = $3,
              finalized_at = $4, version = version + 1, updated_at = $4
        WHERE id = $1 AND version = $2 AND upload_status = 'PENDING_UPLOAD'
        RETURNING id`,
      [input.documentObjectId, input.expectedVersion, input.detectedMimeType, input.now],
    );
    return rows[0] === undefined ? undefined : this.findDocument(transaction, rows[0].id);
  }

  async recordScanOutcome(
    transaction: TransactionContext,
    input: Parameters<DocumentRepository['recordScanOutcome']>[1],
  ): Promise<DocumentRecord | undefined> {
    const manager = entityManagerFor(transaction);
    const current = await findDocument(manager, input.documentObjectId);
    if (current === undefined) return undefined;
    const rows: { id: string }[] = await manager.query(
      `UPDATE documents.document_objects
          SET upload_status = $3, detected_mime_type = COALESCE($4, detected_mime_type),
              scanner_code = $5, scanned_at = $6, version = version + 1, updated_at = $6
        WHERE id = $1 AND version = $2 AND upload_status = 'SCANNING'
        RETURNING id`,
      [
        input.documentObjectId,
        input.expectedVersion,
        input.outcome,
        input.detectedMimeType ?? null,
        input.safeScannerCode,
        input.now,
      ],
    );
    if (rows[0] === undefined) return undefined;
    if (input.outcome === 'READY') {
      await changeReviewStatus(manager, current, 'PENDING', input.now);
    }
    return this.findDocument(transaction, rows[0].id);
  }

  async recordReview(
    transaction: TransactionContext,
    input: DocumentReviewRecord & { readonly expectedVersion: number },
  ): Promise<DocumentRecord | undefined> {
    const manager = entityManagerFor(transaction);
    const current = await findDocument(manager, input.documentObjectId);
    if (current === undefined || current.linkId !== input.documentLinkId) return undefined;
    const versionRows: { id: string }[] = await manager.query(
      `UPDATE documents.document_objects
          SET version = version + 1, updated_at = $3
        WHERE id = $1 AND version = $2 AND upload_status = 'READY'
        RETURNING id`,
      [input.documentObjectId, input.expectedVersion, input.createdAt],
    );
    if (versionRows[0] === undefined) return undefined;
    const changed = await changeReviewStatus(
      manager,
      current,
      input.decision,
      input.createdAt,
      "AND review_status NOT IN ('REVOKED','EXPIRED')",
    );
    if (!changed) return undefined;
    const link = subjectLink(current.subject);
    await manager.query(
      `INSERT INTO documents.document_reviews (
         id, document_object_id, ${link.reviewColumn}, reviewer_user_id,
         authority_grant_id, decision, reason, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.id,
        input.documentObjectId,
        input.documentLinkId,
        input.reviewerUserId,
        input.authorityGrantId ?? null,
        input.decision,
        input.reason,
        input.createdAt,
      ],
    );
    return this.findDocument(transaction, input.documentObjectId);
  }

  async expireIfDue(
    transaction: TransactionContext,
    input: Parameters<DocumentRepository['expireIfDue']>[1],
  ): Promise<DocumentRecord | undefined> {
    const manager = entityManagerFor(transaction);
    const current = await findDocument(manager, input.documentObjectId);
    if (
      current === undefined ||
      current.reviewStatus !== 'APPROVED' ||
      current.expiresOn === undefined ||
      current.expiresOn >= input.evaluatedOn
    ) {
      return current;
    }
    const versionRows: { id: string }[] = await manager.query(
      `UPDATE documents.document_objects
          SET version = version + 1, updated_at = $3
        WHERE id = $1 AND version = $2 AND upload_status = 'READY'
        RETURNING id`,
      [input.documentObjectId, input.expectedVersion, input.now],
    );
    if (versionRows[0] === undefined) return undefined;
    const changed = await changeReviewStatus(
      manager,
      current,
      'EXPIRED',
      input.now,
      "AND review_status = 'APPROVED' AND expires_on < $4::date",
      [input.evaluatedOn],
    );
    if (!changed) return undefined;
    return this.findDocument(transaction, input.documentObjectId);
  }
}
