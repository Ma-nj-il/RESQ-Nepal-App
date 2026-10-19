import { supabase, isSupabaseConfigured } from './client';
import { profilesService } from './profiles';
import { driversService } from './drivers';
import type {
  Driver,
  IdentityApplicationStatus,
  IdentityApplicationType,
  IdentityDocument,
  IdentityDocumentType,
  RegistrationApplication,
} from '../../types';
import { IDENTITY_DOCUMENTS_BUCKET, REQUIRED_IDENTITY_DOCUMENTS } from '../../constants/identity';
import {
  base64ToBytes,
  buildIdentityStoragePath,
  createObjectId,
  validateDocumentAsset,
  type DocumentAssetInput,
  type ValidatedDocumentAsset,
} from '../../utils/identity';
import { isDemoMode } from '../../utils/demoMode';

const DOCUMENT_COLUMNS = [
  'id',
  'account_id',
  'driver_id',
  'vehicle_id',
  'document_type',
  'original_filename',
  'mime_type',
  'file_size',
  'upload_status',
  'created_at',
  'updated_at',
].join(', ');

const APPLICATION_COLUMNS = [
  'id',
  'reference_id',
  'account_id',
  'application_type',
  'status',
  'status_reason',
  'submitted_at',
  'last_status_update',
  'created_at',
  'updated_at',
].join(', ');

interface PrivateDocument extends IdentityDocument {
  storage_bucket: string;
  storage_path: string;
}

export class IdentityServiceError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, technicalMessage?: string) {
    super(technicalMessage || userMessage);
    this.name = 'IdentityServiceError';
    this.userMessage = userMessage;
  }
}

function friendlyErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function friendlyDatabaseError(error: unknown, fallback: string): IdentityServiceError {
  const code = friendlyErrorCode(error);
  if (code === '23505') {
    return new IdentityServiceError(
      'That citizenship number, licence number or vehicle plate is already registered.',
    );
  }
  if (code === '42501') {
    return new IdentityServiceError(
      'You do not have permission to change this record.',
    );
  }
  return new IdentityServiceError(fallback);
}

async function requireAccountId(): Promise<string> {
  if (isDemoMode()) {
    throw new IdentityServiceError(
      'Demo mode — identity documents are not uploaded and no application is created.',
    );
  }
  if (!isSupabaseConfigured) {
    throw new IdentityServiceError(
      'The database is not configured, so nothing was uploaded or submitted.',
    );
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) {
    throw new IdentityServiceError('Your session has expired. Please sign in again.');
  }
  return data.user.id;
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function isMissingRelation(error: unknown): boolean {
  return friendlyErrorCode(error) === '42P01';
}

function isMissingBucket(error: unknown): boolean {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '').toLowerCase()
      : '';
  return message.includes('bucket') && (message.includes('not found') || message.includes('does not exist'));
}

async function getPrivateDocuments(accountId: string): Promise<PrivateDocument[]> {
  const { data, error } = await supabase
    .from('identity_documents')
    .select(`${DOCUMENT_COLUMNS}, storage_bucket, storage_path`)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingRelation(error)) {
      throw new IdentityServiceError(
        'Identity registration is not enabled on this server yet. The database migration has not been applied.',
      );
    }
    throw friendlyDatabaseError(
      error,
      'Could not load your identity documents. Check your connection and try again.',
    );
  }
  return (data || []) as unknown as PrivateDocument[];
}

function toPublicDocument(document: PrivateDocument): IdentityDocument {
  return {
    id: document.id,
    account_id: document.account_id,
    driver_id: document.driver_id,
    vehicle_id: document.vehicle_id,
    document_type: document.document_type,
    original_filename: document.original_filename,
    mime_type: document.mime_type,
    file_size: Number(document.file_size),
    upload_status: document.upload_status,
    created_at: document.created_at,
    updated_at: document.updated_at,
  };
}

export const identityDocumentsService = {
  async listDocuments(): Promise<IdentityDocument[]> {
    const accountId = await requireAccountId();
    const documents = await getPrivateDocuments(accountId);
    return documents.map(toPublicDocument);
  },

  /**
   * Validates, uploads to the private bucket, then persists metadata. The
   * document is never marked UPLOADED until Storage confirms the object and
   * the metadata insert succeeds. If metadata fails, the object is removed.
   */
  async uploadDocument(input: {
    documentType: IdentityDocumentType;
    asset: DocumentAssetInput;
    driverId?: string | null;
    vehicleId?: string | null;
  }): Promise<IdentityDocument> {
    const accountId = await requireAccountId();
    const validation: ReturnType<typeof validateDocumentAsset> = validateDocumentAsset(input.asset);
    if (!validation.ok) {
      throw new IdentityServiceError(validation.error);
    }
    const valid: ValidatedDocumentAsset = validation;
    const bytes = base64ToBytes(valid.base64);
    const objectId = createObjectId();
    const storagePath = buildIdentityStoragePath(
      accountId,
      input.documentType,
      valid.extension,
      objectId,
    );

    const previous = (await getPrivateDocuments(accountId)).find(
      (document) =>
        document.document_type === input.documentType &&
        document.upload_status === 'UPLOADED' &&
        (!input.vehicleId || !document.vehicle_id || document.vehicle_id === input.vehicleId),
    );

    const { error: uploadError } = await supabase.storage
      .from(IDENTITY_DOCUMENTS_BUCKET)
      .upload(storagePath, arrayBufferFor(bytes), {
        contentType: valid.mimeType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      if (isMissingBucket(uploadError)) {
        throw new IdentityServiceError(
          'Private document storage is not enabled on this server yet. The storage migration has not been applied.',
        );
      }
      throw new IdentityServiceError(
        'The document could not be uploaded. Check your connection and try again.',
      );
    }

    const { data, error } = await supabase
      .from('identity_documents')
      .insert({
        account_id: accountId,
        driver_id: input.driverId ?? null,
        vehicle_id: input.vehicleId ?? null,
        document_type: input.documentType,
        storage_bucket: IDENTITY_DOCUMENTS_BUCKET,
        storage_path: storagePath,
        original_filename: valid.originalFilename,
        mime_type: valid.mimeType,
        file_size: valid.fileSize,
        upload_status: 'UPLOADED',
      })
      .select(DOCUMENT_COLUMNS)
      .single();

    if (error || !data) {
      // Best-effort cleanup so a failed metadata write does not leave an
      // unreferenced private object behind.
      try {
        await supabase.storage.from(IDENTITY_DOCUMENTS_BUCKET).remove([storagePath]);
      } catch {
        // The object remains private; the service role can clean it later.
      }
      if (isMissingRelation(error)) {
        throw new IdentityServiceError(
          'Identity registration is not enabled on this server yet. The database migration has not been applied.',
        );
      }
      throw friendlyDatabaseError(
        error,
        'The document uploaded but its record could not be saved. Please try again.',
      );
    }

    if (previous?.storage_path) {
      try {
        await supabase.storage
          .from(IDENTITY_DOCUMENTS_BUCKET)
          .remove([previous.storage_path]);
      } catch {
        // Metadata now points at the replacement; the old object is private
        // and is not reachable by other accounts. A follow-up cleanup can remove it.
      }
    }

    return data as unknown as IdentityDocument;
  },

  async removeDocument(documentId: string): Promise<void> {
    const accountId = await requireAccountId();
    const documents = await getPrivateDocuments(accountId);
    const document = documents.find((entry) => entry.id === documentId);
    if (!document) {
      throw new IdentityServiceError('That document could not be found.');
    }

    const { error } = await supabase
      .from('identity_documents')
      .update({ upload_status: 'REMOVED' })
      .eq('id', documentId)
      .eq('account_id', accountId);
    if (error) {
      throw friendlyDatabaseError(
        error,
        'The document could not be removed. Please try again.',
      );
    }

    try {
      await supabase.storage
        .from(IDENTITY_DOCUMENTS_BUCKET)
        .remove([document.storage_path]);
    } catch {
      // Metadata no longer references it; storage cleanup is best-effort.
    }
  },

  /**
   * Driver documents may be uploaded before the driver/vehicle records exist.
   * This attaches the newest uploaded rows once the records are created.
   */
  async associatePendingDocuments(input: {
    driverId: string;
    vehicleId: string;
  }): Promise<void> {
    const accountId = await requireAccountId();

    const { error: licenceError } = await supabase
      .from('identity_documents')
      .update({ driver_id: input.driverId })
      .eq('account_id', accountId)
      .eq('document_type', 'DRIVING_LICENSE')
      .eq('upload_status', 'UPLOADED')
      .is('driver_id', null);
    if (licenceError) {
      throw friendlyDatabaseError(
        licenceError,
        'Your licence document could not be attached to the driver profile. Please try again.',
      );
    }

    const { error: blueBookError } = await supabase
      .from('identity_documents')
      .update({ driver_id: input.driverId, vehicle_id: input.vehicleId })
      .eq('account_id', accountId)
      .eq('document_type', 'VEHICLE_BLUE_BOOK')
      .eq('upload_status', 'UPLOADED')
      .is('vehicle_id', null);
    if (blueBookError) {
      throw friendlyDatabaseError(
        blueBookError,
        'Your Blue Book could not be attached to the vehicle. Please try again.',
      );
    }
  },
};

export const identityApplicationsService = {
  async getApplication(
    applicationType: IdentityApplicationType,
  ): Promise<RegistrationApplication | null> {
    const accountId = await requireAccountId();
    const { data, error } = await supabase
      .from('registration_applications')
      .select(APPLICATION_COLUMNS)
      .eq('account_id', accountId)
      .eq('application_type', applicationType)
      .maybeSingle();
    if (error) {
      if (isMissingRelation(error)) {
        throw new IdentityServiceError(
          'Identity registration is not enabled on this server yet. The database migration has not been applied.',
        );
      }
      throw friendlyDatabaseError(
        error,
        'Could not load your application status. Check your connection and try again.',
      );
    }
    return (data as RegistrationApplication | null) ?? null;
  },

  async submitApplication(
    applicationType: IdentityApplicationType,
  ): Promise<RegistrationApplication> {
    await requireAccountId();
    const { data, error } = await supabase.rpc('submit_identity_application', {
      p_application_type: applicationType,
    });

    if (error) {
      const message = String(error.message ?? '').toLowerCase();
      if (message.includes('identity application incomplete')) {
        const required = REQUIRED_IDENTITY_DOCUMENTS[applicationType].length;
        throw new IdentityServiceError(
          applicationType === 'USER'
            ? 'Add your citizenship number and upload a citizenship document before submitting.'
            : `Complete the driver details and upload all ${required} required documents before submitting.`,
        );
      }
      if (message.includes('not authenticated')) {
        throw new IdentityServiceError('Your session has expired. Please sign in again.');
      }
      if (message.includes('does not exist') || message.includes('could not find the function')) {
        throw new IdentityServiceError(
          'Identity registration is not enabled on this server yet. The database migration has not been applied.',
        );
      }
      throw new IdentityServiceError(
        'Your application could not be submitted. Check your connection and try again.',
      );
    }

    const application = Array.isArray(data) ? data[0] : data;
    if (!application) {
      throw new IdentityServiceError(
        'The server did not return an application. Nothing is marked as submitted.',
      );
    }
    return application as RegistrationApplication;
  },
};

export interface IdentityStatusBundle {
  profileCitizenshipNumber: string | null;
  application: RegistrationApplication | null;
  documents: IdentityDocument[];
  driver: Driver | null;
  vehicles: Awaited<ReturnType<typeof driversService.getAmbulances>>;
}

/** One read used by the status screen; never includes private object keys. */
export async function loadIdentityStatus(
  applicationType: IdentityApplicationType,
  accountId: string,
): Promise<IdentityStatusBundle> {
  // Check the session and migration state first so a missing/expired session
  // is reported as an identity error rather than a raw profile fetch failure.
  const application = await identityApplicationsService.getApplication(applicationType);
  const [profile, documents] = await Promise.all([
    profilesService.getById(accountId),
    identityDocumentsService.listDocuments(),
  ]);

  let driver: Driver | null = null;
  let vehicles: Awaited<ReturnType<typeof driversService.getAmbulances>> = [];
  if (applicationType === 'DRIVER') {
    driver = await driversService.getByUserId(accountId);
    if (driver) {
      vehicles = await driversService.getAmbulances(driver.id);
    }
  }

  return {
    profileCitizenshipNumber: profile?.citizenship_number ?? null,
    application,
    documents,
    driver,
    vehicles,
  };
}

/** Used by tests and callers that need to clear a local error state. */
export function isIdentityStatus(value: string): value is IdentityApplicationStatus {
  return [
    'DRAFT',
    'SUBMITTED',
    'PENDING_VERIFICATION',
    'APPROVED',
    'REJECTED',
    'ADDITIONAL_INFORMATION_REQUIRED',
  ].includes(value);
}
