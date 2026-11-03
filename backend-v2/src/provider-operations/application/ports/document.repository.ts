import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import type {
  DocumentReviewStatus,
  DocumentUploadStatus,
} from '../../domain/provider-operations.js';

export type DocumentSubject =
  | { readonly type: 'USER_IDENTITY'; readonly userId: string }
  | { readonly type: 'PROVIDER_APPLICATION'; readonly applicationId: string }
  | { readonly type: 'DRIVER_APPLICATION'; readonly applicationId: string }
  | { readonly type: 'DRIVER'; readonly driverId: string }
  | { readonly type: 'AMBULANCE'; readonly ambulanceId: string }
  | { readonly type: 'FACILITY'; readonly facilityId: string };

export interface DocumentRecord {
  readonly id: string;
  readonly linkId: string;
  readonly uploadedByUserId: string;
  readonly ownerUserId?: string;
  readonly tenantId?: string;
  readonly facilityId?: string;
  readonly subject: DocumentSubject;
  readonly documentType: string;
  readonly objectKey: string;
  readonly expectedSha256: string;
  readonly sizeBytes: number;
  readonly declaredMimeType: string;
  readonly detectedMimeType?: string;
  readonly uploadStatus: DocumentUploadStatus;
  readonly reviewStatus: DocumentReviewStatus;
  readonly expiresOn?: string;
  readonly version: number;
}

export interface DocumentReviewRecord {
  readonly id: string;
  readonly documentObjectId: string;
  readonly documentLinkId: string;
  readonly reviewerUserId: string;
  readonly authorityGrantId?: string;
  readonly decision: 'APPROVED' | 'NEEDS_INFORMATION' | 'REJECTED' | 'REVOKED';
  readonly reason: string;
  readonly createdAt: Date;
}

export interface DocumentRepository {
  createPendingDocument(
    transaction: TransactionContext,
    input: DocumentRecord & { readonly now: Date },
  ): Promise<DocumentRecord>;
  findDocument(
    transaction: TransactionContext,
    documentObjectId: string,
  ): Promise<DocumentRecord | undefined>;
  listDocuments(transaction: TransactionContext): Promise<readonly DocumentRecord[]>;
  markUploadedForScan(
    transaction: TransactionContext,
    input: {
      readonly documentObjectId: string;
      readonly expectedVersion: number;
      readonly detectedMimeType: string;
      readonly now: Date;
    },
  ): Promise<DocumentRecord | undefined>;
  recordScanOutcome(
    transaction: TransactionContext,
    input: {
      readonly documentObjectId: string;
      readonly expectedVersion: number;
      readonly outcome: 'READY' | 'QUARANTINED' | 'FAILED';
      readonly detectedMimeType?: string;
      readonly safeScannerCode: string;
      readonly now: Date;
    },
  ): Promise<DocumentRecord | undefined>;
  recordReview(
    transaction: TransactionContext,
    input: DocumentReviewRecord & { readonly expectedVersion: number },
  ): Promise<DocumentRecord | undefined>;
  expireIfDue(
    transaction: TransactionContext,
    input: {
      readonly documentObjectId: string;
      readonly expectedVersion: number;
      readonly evaluatedOn: string;
      readonly now: Date;
    },
  ): Promise<DocumentRecord | undefined>;
}

export const DOCUMENT_REPOSITORY = Symbol('DOCUMENT_REPOSITORY');
