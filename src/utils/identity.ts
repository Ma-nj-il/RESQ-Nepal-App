import type {
  IdentityApplicationStatus,
  IdentityDocumentUploadStatus,
  IdentityDocumentType,
} from '../types';
import {
  ALLOWED_IDENTITY_MIME_TYPES,
  IDENTITY_DOCUMENT_META,
  MAX_IDENTITY_DOCUMENT_BYTES,
} from '../constants/identity';

export interface DocumentAssetInput {
  uri?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  base64?: string | null;
}

export interface ValidatedDocumentAsset {
  ok: true;
  mimeType: (typeof ALLOWED_IDENTITY_MIME_TYPES)[number];
  extension: 'jpg' | 'png' | 'heic';
  fileSize: number;
  originalFilename: string;
  base64: string;
}

export interface InvalidDocumentAsset {
  ok: false;
  error: string;
}

export type DocumentValidationResult = ValidatedDocumentAsset | InvalidDocumentAsset;

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
  BASE64_LOOKUP[BASE64_ALPHABET[i]] = i;
}

/**
 * Decodes standard base64 to bytes. Pure JS so it works in Hermes and Node
 * tests without Buffer or atob. A data-URL prefix is ignored.
 */
export function base64ToBytes(input: string): Uint8Array {
  const withoutPrefix = input.includes(',') ? input.slice(input.indexOf(',') + 1) : input;
  const normalized = withoutPrefix.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const byteLength = Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  const bytes = new Uint8Array(byteLength);
  let byteIndex = 0;

  for (let i = 0; i < normalized.length; i += 4) {
    const first = BASE64_LOOKUP[normalized[i]];
    const second = BASE64_LOOKUP[normalized[i + 1]];
    if (first === undefined || second === undefined) break;
    if (byteIndex < bytes.length) {
      bytes[byteIndex++] = (first << 2) | (second >> 4);
    }
    const thirdChar = normalized[i + 2];
    const third = thirdChar === '=' ? undefined : BASE64_LOOKUP[thirdChar];
    if (third !== undefined) {
      if (byteIndex < bytes.length) {
        bytes[byteIndex++] = ((second & 0x0f) << 4) | (third >> 2);
      }
      const fourthChar = normalized[i + 3];
      const fourth = fourthChar === '=' ? undefined : BASE64_LOOKUP[fourthChar];
      if (fourth !== undefined && byteIndex < bytes.length) {
        bytes[byteIndex++] = ((third & 0x03) << 6) | fourth;
      }
    }
  }

  return bytes.subarray(0, byteIndex);
}

export function estimateBase64Bytes(base64: string): number {
  const withoutPrefix = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const normalized = withoutPrefix.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let value = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    value += String.fromCharCode(bytes[i]);
  }
  return value;
}

type DetectedImage = {
  mimeType: (typeof ALLOWED_IDENTITY_MIME_TYPES)[number];
  extension: 'jpg' | 'png' | 'heic';
};

/** Sniffs the first bytes; a declared MIME type is never trusted on its own. */
export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'].includes(brand)) {
      return { mimeType: brand === 'heif' ? 'image/heif' : 'image/heic', extension: 'heic' };
    }
  }

  return null;
}

export function normalizeMimeType(value?: string | null): string {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'image/jpg' || normalized === 'image/pjpeg') return 'image/jpeg';
  if (normalized === 'image/x-png') return 'image/png';
  return normalized;
}

export function sanitizeOriginalFilename(value?: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return 'document.jpg';
  const base = raw.split(/[\\/]/).pop() ?? 'document.jpg';
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, '').trim();
  return (cleaned || 'document.jpg').slice(0, 120);
}

/**
 * Validates a locally selected document before anything is uploaded.
 * Checks size, MIME allow-list and the image signature. The backend repeats
 * the size/MIME checks at the bucket and database layers.
 */
export function validateDocumentAsset(asset: DocumentAssetInput): DocumentValidationResult {
  const base64 = asset.base64?.trim();
  if (!base64) {
    return { ok: false, error: 'The selected file could not be read. Please choose it again.' };
  }

  const computedSize = estimateBase64Bytes(base64);
  const fileSize = computedSize > 0 ? computedSize : asset.fileSize ?? 0;

  if (fileSize <= 0) {
    return { ok: false, error: 'The selected file is empty. Please choose a photo of the document.' };
  }
  if (fileSize > MAX_IDENTITY_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: 'That photo is larger than 8 MB. Choose a smaller photo or take a new one.',
    };
  }

  const prefix = base64ToBytes(base64.slice(0, 64));
  const detected = detectImageType(prefix);
  if (!detected) {
    return {
      ok: false,
      error: 'That file does not look like a JPG, PNG or HEIC photo. Please choose an image of the document.',
    };
  }

  const declared = normalizeMimeType(asset.mimeType);
  if (declared && !(ALLOWED_IDENTITY_MIME_TYPES as readonly string[]).includes(declared)) {
    return {
      ok: false,
      error: 'Only JPG, PNG or HEIC photos are accepted for identity documents.',
    };
  }
  // ImagePicker may re-encode a HEIC capture as JPEG while retaining a HEIC
  // MIME label. The detected signature is authoritative; the upload and the
  // database record use the detected type so the backend never receives a
  // mislabelled object.
  return {
    ok: true,
    mimeType: detected.mimeType,
    extension: detected.extension,
    fileSize,
    originalFilename: sanitizeOriginalFilename(asset.fileName),
    base64,
  };
}

/**
 * Generates a high-entropy object id. Uses Web Crypto when the runtime exposes
 * it; the fallback combines independent random sources and is only a
 * defence-in-depth path because Storage RLS already enforces the account
 * folder.
 */
export function createObjectId(): string {
  const cryptoObject = (globalThis as unknown as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: (array: Uint8Array) => Uint8Array;
    };
  }).crypto;

  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID().replace(/-/g, '').toLowerCase();
  }

  if (cryptoObject?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObject.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  const randomPart = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return `${Date.now().toString(16)}${randomPart}`.slice(0, 32);
}

/** Private Storage path; never rendered in the UI. */
export function buildIdentityStoragePath(
  accountId: string,
  documentType: IdentityDocumentType,
  extension: string,
  objectId: string,
): string {
  const safeExtension = /^[a-z0-9]+$/i.test(extension) ? extension.toLowerCase() : 'jpg';
  return `${accountId}/${IDENTITY_DOCUMENT_META[documentType].folder}/${objectId}.${safeExtension}`;
}

/** Masks all but the last four characters. */
export function maskIdentifier(value?: string | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Not provided';
  if (trimmed.length <= 4) return '••••';
  return `•••• ${trimmed.slice(-4)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatIdentityDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recorded';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`;
}

export function formatDocumentSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface StatusPresentation {
  label: string;
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';
  note: string;
}

/** Maps backend status to user-facing copy. Never invents progress. */
export function applicationStatusPresentation(
  status?: IdentityApplicationStatus | null,
): StatusPresentation {
  switch (status) {
    case 'APPROVED':
      return {
        label: 'Approved',
        variant: 'success',
        note: 'The backend has approved this application.',
      };
    case 'REJECTED':
      return {
        label: 'Rejected',
        variant: 'error',
        note: 'The backend has rejected this application. Contact support for the reason.',
      };
    case 'ADDITIONAL_INFORMATION_REQUIRED':
      return {
        label: 'Additional information required',
        variant: 'warning',
        note: 'The review team needs more information before this application can continue.',
      };
    case 'SUBMITTED':
    case 'PENDING_VERIFICATION':
      return {
        label: 'Pending verification',
        variant: 'warning',
        note: 'Your documents were submitted. A review team still needs to verify them.',
      };
    case 'DRAFT':
      return {
        label: 'Draft',
        variant: 'neutral',
        note: 'This application has not been submitted yet.',
      };
    default:
      return {
        label: 'Not submitted',
        variant: 'neutral',
        note: 'No application is stored on the server yet.',
      };
  }
}

export function documentUploadLabel(status?: IdentityDocumentUploadStatus | null): string {
  switch (status) {
    case 'UPLOADED':
      return 'Uploaded';
    case 'UPLOAD_FAILED':
      return 'Upload failed';
    case 'UPLOADING':
      return 'Uploading…';
    case 'PENDING_UPLOAD':
      return 'Not uploaded';
    case 'REMOVED':
      return 'Replaced';
    default:
      return 'Not uploaded';
  }
}

/** Lowest / newest current document of a type; removed rows are ignored. */
export function pickCurrentDocument<
  T extends {
    document_type: IdentityDocumentType;
    upload_status: IdentityDocumentUploadStatus;
    vehicle_id?: string | null;
    created_at: string;
  },
>(documents: T[], type: IdentityDocumentType, vehicleId?: string | null): T | null {
  return (
    documents
      .filter(
        (document) =>
          document.document_type === type &&
          document.upload_status === 'UPLOADED' &&
          (!vehicleId || !document.vehicle_id || document.vehicle_id === vehicleId),
      )
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
  );
}
