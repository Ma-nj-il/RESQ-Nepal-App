import type {
  IdentityApplicationType,
  IdentityDocumentType,
} from '../types';

/** Private Supabase Storage bucket created by the identity storage migration. */
export const IDENTITY_DOCUMENTS_BUCKET = 'identity-documents';

/** Mirrors the bucket limit and the database size check. */
export const MAX_IDENTITY_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** Image-only capture is deliberate: the app can only verify image signatures. */
export const ALLOWED_IDENTITY_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
] as const;

export interface IdentityDocumentMeta {
  type: IdentityDocumentType;
  title: string;
  description: string;
  /** Folder segment inside the account folder. */
  folder: string;
  icon: string;
}

export const IDENTITY_DOCUMENT_META: Record<IdentityDocumentType, IdentityDocumentMeta> = {
  CITIZENSHIP: {
    type: 'CITIZENSHIP',
    title: 'Citizenship document',
    description:
      'Photograph the page showing your name, photograph and citizenship number. This is stored privately and is not shown on your public profile.',
    folder: 'citizenship',
    icon: '🪪',
  },
  DRIVING_LICENSE: {
    type: 'DRIVING_LICENSE',
    title: 'Driving licence document',
    description:
      'Photograph the front of your driving licence. The number and expiry must match the details you enter.',
    folder: 'driving-licence',
    icon: '🚗',
  },
  VEHICLE_BLUE_BOOK: {
    type: 'VEHICLE_BLUE_BOOK',
    title: 'Blue Book / vehicle registration',
    description:
      'Photograph the Blue Book page that shows the registered plate number and vehicle details.',
    folder: 'vehicle-blue-book',
    icon: '📘',
  },
};

export const REQUIRED_IDENTITY_DOCUMENTS: Record<
  IdentityApplicationType,
  IdentityDocumentType[]
> = {
  USER: ['CITIZENSHIP'],
  DRIVER: ['CITIZENSHIP', 'DRIVING_LICENSE', 'VEHICLE_BLUE_BOOK'],
};

/** User-facing labels for upload state only — never identity verification. */
export const UPLOAD_STATUS_LABELS: Record<string, string> = {
  PENDING_UPLOAD: 'Not uploaded',
  UPLOADING: 'Uploading…',
  UPLOADED: 'Uploaded',
  UPLOAD_FAILED: 'Upload failed',
  REMOVED: 'Removed',
};

export const IDENTITY_APPLICATION_TITLES: Record<IdentityApplicationType, string> = {
  USER: 'Patient application',
  DRIVER: 'Driver application',
};
