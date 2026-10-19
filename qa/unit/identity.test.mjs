// Identity document + application-status unit tests.
//
// These cover pure validation, masking and presentation logic. The database
// RLS, ownership, constraints and submission RPC are exercised separately by
// qa/sql/verify_identity_registration.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationStatusPresentation,
  base64ToBytes,
  buildIdentityStoragePath,
  createObjectId,
  detectImageType,
  documentUploadLabel,
  estimateBase64Bytes,
  formatDocumentSize,
  formatIdentityDate,
  maskIdentifier,
  normalizeMimeType,
  pickCurrentDocument,
  sanitizeOriginalFilename,
  validateDocumentAsset,
} from '../../src/utils/identity.ts';
import { MAX_IDENTITY_DOCUMENT_BYTES } from '../../src/constants/identity.ts';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const HEIC = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
]);

test('detectImageType trusts file signatures, not file names or declared MIME', () => {
  assert.deepEqual(detectImageType(JPEG), { mimeType: 'image/jpeg', extension: 'jpg' });
  assert.deepEqual(detectImageType(PNG), { mimeType: 'image/png', extension: 'png' });
  assert.deepEqual(detectImageType(HEIC), { mimeType: 'image/heic', extension: 'heic' });
  assert.equal(detectImageType(Buffer.from('%PDF-1.7\n')), null);
  assert.equal(detectImageType(Buffer.from('GIF89a')), null);
  assert.equal(detectImageType(new Uint8Array()), null);
});

test('validateDocumentAsset accepts JPG/PNG/HEIC photos', () => {
  for (const [bytes, mimeType, extension] of [
    [JPEG, 'image/jpeg', 'jpg'],
    [PNG, 'image/png', 'png'],
    [HEIC, 'image/heic', 'heic'],
  ]) {
    const result = validateDocumentAsset({
      base64: bytes.toString('base64'),
      fileName: `citizenship.${extension}`,
      mimeType,
    });
    assert.equal(result.ok, true, `${mimeType} should be accepted`);
    assert.equal(result.mimeType, mimeType);
    assert.equal(result.extension, extension);
  }
});

test('validateDocumentAsset uses the detected type when the picker mislabels a photo', () => {
  // expo-image-picker can retain image/heic while quality conversion produces JPEG.
  const result = validateDocumentAsset({
    base64: JPEG.toString('base64'),
    fileName: 'IMG_0001.HEIC',
    mimeType: 'image/heic',
  });
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.extension, 'jpg');
});

test('validateDocumentAsset rejects missing, empty, non-image, oversized and disallowed files', () => {
  assert.equal(validateDocumentAsset({ base64: null }).ok, false);
  assert.equal(validateDocumentAsset({ base64: '   ' }).ok, false);

  const empty = validateDocumentAsset({ base64: '====', fileSize: 0 });
  assert.equal(empty.ok, false);

  const pdf = validateDocumentAsset({
    base64: Buffer.from('%PDF-1.7').toString('base64'),
    fileName: 'citizenship.pdf',
    mimeType: 'application/pdf',
  });
  assert.equal(pdf.ok, false);

  const gif = validateDocumentAsset({
    base64: Buffer.from('GIF89a').toString('base64'),
    fileName: 'citizenship.gif',
    mimeType: 'image/gif',
  });
  assert.equal(gif.ok, false);

  const huge = Buffer.alloc(MAX_IDENTITY_DOCUMENT_BYTES + 1);
  huge.set(JPEG);
  const oversized = validateDocumentAsset({
    base64: huge.toString('base64'),
    fileName: 'huge.jpg',
    mimeType: 'image/jpeg',
  });
  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /8 MB/);
});

test('base64 helpers decode standard base64 and data URLs', () => {
  assert.deepEqual(Array.from(base64ToBytes('AQIDBA==')), [1, 2, 3, 4]);
  assert.deepEqual(
    Array.from(base64ToBytes('data:image/png;base64,AQIDBA==')),
    [1, 2, 3, 4],
  );
  assert.equal(estimateBase64Bytes('AQIDBA=='), 4);
  assert.equal(estimateBase64Bytes('data:image/png;base64,AQIDBA=='), 4);
});

test('normalizeMimeType canonicalises aliases and sanitizeOriginalFilename removes paths', () => {
  assert.equal(normalizeMimeType(' IMAGE/JPG '), 'image/jpeg');
  assert.equal(normalizeMimeType('image/pjpeg'), 'image/jpeg');
  assert.equal(normalizeMimeType('image/x-png'), 'image/png');
  assert.equal(normalizeMimeType(undefined), '');

  assert.equal(sanitizeOriginalFilename('../../etc/passwd.jpg'), 'passwd.jpg');
  assert.equal(sanitizeOriginalFilename('C:\\Photos\\my licence.jpg'), 'my licence.jpg');
  assert.equal(sanitizeOriginalFilename(''), 'document.jpg');
  assert.ok(sanitizeOriginalFilename('a'.repeat(500)).length <= 120);
});

test('storage paths are private, account-scoped and unguessable', () => {
  const accountId = '11111111-1111-1111-1111-111111111111';
  const objectId = '0123456789abcdef0123456789abcdef';
  assert.equal(
    buildIdentityStoragePath(accountId, 'CITIZENSHIP', 'jpg', objectId),
    `${accountId}/citizenship/${objectId}.jpg`,
  );
  assert.equal(
    buildIdentityStoragePath(accountId, 'VEHICLE_BLUE_BOOK', 'PNG', objectId),
    `${accountId}/vehicle-blue-book/${objectId}.png`,
  );
  // Unsupported extensions fall back to jpg rather than being interpolated.
  assert.equal(
    buildIdentityStoragePath(accountId, 'DRIVING_LICENSE', '../secret', objectId),
    `${accountId}/driving-licence/${objectId}.jpg`,
  );

  const first = createObjectId();
  const second = createObjectId();
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.match(second, /^[a-f0-9]{32}$/);
  assert.notEqual(first, second);
});

test('identity identifiers are masked and never shown in full', () => {
  assert.equal(maskIdentifier('12-34-5678-9012'), '•••• 9012');
  assert.equal(maskIdentifier('1234'), '••••');
  assert.equal(maskIdentifier(''), 'Not provided');
  assert.equal(maskIdentifier(null), 'Not provided');
});

test('application status copy never invents approval', () => {
  assert.equal(applicationStatusPresentation(undefined).label, 'Not submitted');
  assert.equal(applicationStatusPresentation(null).label, 'Not submitted');
  assert.equal(applicationStatusPresentation('DRAFT').label, 'Draft');

  for (const status of ['SUBMITTED', 'PENDING_VERIFICATION']) {
    const presentation = applicationStatusPresentation(status);
    assert.equal(presentation.label, 'Pending verification');
    assert.notEqual(presentation.variant, 'success');
  }

  assert.equal(applicationStatusPresentation('APPROVED').label, 'Approved');
  assert.equal(applicationStatusPresentation('REJECTED').label, 'Rejected');
  assert.equal(
    applicationStatusPresentation('ADDITIONAL_INFORMATION_REQUIRED').label,
    'Additional information required',
  );
});

test('upload labels distinguish every local state', () => {
  assert.equal(documentUploadLabel('PENDING_UPLOAD'), 'Not uploaded');
  assert.equal(documentUploadLabel('UPLOADED'), 'Uploaded');
  assert.equal(documentUploadLabel('UPLOAD_FAILED'), 'Upload failed');
  assert.equal(documentUploadLabel('UPLOADING'), 'Uploading…');
  assert.equal(documentUploadLabel('REMOVED'), 'Replaced');
  assert.equal(documentUploadLabel(undefined), 'Not uploaded');
});

test('pickCurrentDocument only returns uploaded documents, newest first, for the vehicle', () => {
  const documents = [
    {
      document_type: 'CITIZENSHIP',
      upload_status: 'UPLOADED',
      vehicle_id: null,
      created_at: '2026-10-01T10:00:00.000Z',
      id: 'old',
    },
    {
      document_type: 'CITIZENSHIP',
      upload_status: 'UPLOADED',
      vehicle_id: null,
      created_at: '2026-10-02T10:00:00.000Z',
      id: 'new',
    },
    {
      document_type: 'CITIZENSHIP',
      upload_status: 'REMOVED',
      vehicle_id: null,
      created_at: '2026-10-03T10:00:00.000Z',
      id: 'removed',
    },
    {
      document_type: 'VEHICLE_BLUE_BOOK',
      upload_status: 'UPLOADED',
      vehicle_id: 'vehicle-a',
      created_at: '2026-10-01T10:00:00.000Z',
      id: 'bluebook-a',
    },
    {
      document_type: 'VEHICLE_BLUE_BOOK',
      upload_status: 'UPLOADED',
      vehicle_id: 'vehicle-b',
      created_at: '2026-10-02T10:00:00.000Z',
      id: 'bluebook-b',
    },
  ];

  assert.equal(pickCurrentDocument(documents, 'CITIZENSHIP')?.id, 'new');
  assert.equal(pickCurrentDocument(documents, 'VEHICLE_BLUE_BOOK', 'vehicle-a')?.id, 'bluebook-a');
  assert.equal(pickCurrentDocument(documents, 'VEHICLE_BLUE_BOOK', 'vehicle-b')?.id, 'bluebook-b');
  assert.equal(pickCurrentDocument(documents, 'DRIVING_LICENSE'), null);
});

test('date and size formatting are conservative for missing data', () => {
  assert.equal(formatIdentityDate(null), '—');
  assert.equal(formatIdentityDate('not-a-date'), 'Recorded');
  assert.match(formatIdentityDate('2026-10-19T10:30:00.000Z'), /2026/);

  assert.equal(formatDocumentSize(0), '');
  assert.equal(formatDocumentSize(undefined), '');
  assert.equal(formatDocumentSize(1024), '1 KB');
  assert.equal(formatDocumentSize(2.5 * 1024 * 1024), '2.5 MB');
});
