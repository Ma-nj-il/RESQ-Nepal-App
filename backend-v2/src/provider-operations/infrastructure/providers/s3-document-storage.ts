import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import type { ApplicationConfig } from '../../../shared/infrastructure/config/application-config.js';
import type {
  ObjectStorage,
  PrivateObjectMetadata,
} from '../../application/ports/object-storage.js';

export interface VerifiedDocumentReader {
  readVerifiedObject(
    input: {
      readonly objectKey: string;
      readonly expectedSha256: string;
      readonly maximumBytes: number;
    },
    signal: AbortSignal,
  ): Promise<Buffer>;
}

const MAX_BYTES = 15 * 1024 * 1024;
const MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function unavailable(): ApplicationError {
  return new ApplicationError({
    code: 'DOCUMENT.STORAGE_UNAVAILABLE',
    message: 'Document storage is temporarily unavailable.',
    status: 503,
    retryable: true,
  });
}
function invalidObject(): ApplicationError {
  return new ApplicationError({
    code: 'DOCUMENT.OBJECT_INTEGRITY_FAILED',
    message: 'The document object failed integrity verification.',
    status: 422,
  });
}
function assertKey(key: string): void {
  if (!/^restricted\/documents\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key))
    throw invalidObject();
}

export class S3DocumentStorage implements ObjectStorage, VerifiedDocumentReader {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly kmsKeyId: string | undefined;
  private readonly timeoutMs: number;

  constructor(config: ApplicationConfig) {
    const storage = config.documents.storage;
    if (storage === undefined) throw new Error('Document storage configuration is required');
    this.bucket = storage.bucket;
    this.kmsKeyId = storage.kmsKeyId;
    this.timeoutMs = config.documents.timeoutMs;
    this.client = new S3Client({
      endpoint: config.dependencies.objectStorageEndpoint,
      region: storage.region,
      forcePathStyle: true,
      maxAttempts: 1,
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        ...(storage.sessionToken === undefined ? {} : { sessionToken: storage.sessionToken }),
      },
    });
  }

  async createUploadGrant(
    input: Parameters<ObjectStorage['createUploadGrant']>[0],
  ): ReturnType<ObjectStorage['createUploadGrant']> {
    assertKey(input.objectKey);
    if (
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > MAX_BYTES ||
      !/^[a-f0-9]{64}$/i.test(input.sha256) ||
      !MIME_TYPES.has(input.mimeType)
    )
      throw invalidObject();
    const requiredHeaders: Record<string, string> = {
      'content-length': String(input.sizeBytes),
      'content-type': input.mimeType,
      'if-none-match': '*',
      'x-amz-checksum-sha256': Buffer.from(input.sha256, 'hex').toString('base64'),
      'x-amz-server-side-encryption': this.kmsKeyId === undefined ? 'AES256' : 'aws:kms',
      ...(this.kmsKeyId === undefined
        ? {}
        : { 'x-amz-server-side-encryption-aws-kms-key-id': this.kmsKeyId }),
    };
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        ContentLength: input.sizeBytes,
        ContentType: input.mimeType,
        ChecksumSHA256: requiredHeaders['x-amz-checksum-sha256'],
        IfNoneMatch: '*',
        ServerSideEncryption: this.kmsKeyId === undefined ? 'AES256' : 'aws:kms',
        ...(this.kmsKeyId === undefined ? {} : { SSEKMSKeyId: this.kmsKeyId }),
      }),
      {
        expiresIn: this.expiresIn(input.expiresAt, 600),
        signableHeaders: new Set(Object.keys(requiredHeaders)),
        unhoistableHeaders: new Set(
          Object.keys(requiredHeaders).filter((header) => header.startsWith('x-amz-')),
        ),
      },
    );
    return { url, expiresAt: input.expiresAt, requiredHeaders };
  }

  async readMetadata(objectKey: string): Promise<PrivateObjectMetadata | undefined> {
    assertKey(objectKey);
    try {
      const object = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey, ChecksumMode: 'ENABLED' }),
        { abortSignal: AbortSignal.timeout(this.timeoutMs) },
      );
      const checksum = object.ChecksumSHA256;
      if (
        checksum === undefined ||
        !/^[A-Za-z0-9+/]{43}=$/.test(checksum) ||
        Buffer.from(checksum, 'base64').length !== 32 ||
        object.ContentLength === undefined ||
        object.ContentType === undefined
      )
        throw invalidObject();
      return {
        objectKey,
        sha256: Buffer.from(checksum, 'base64').toString('hex'),
        sizeBytes: object.ContentLength,
        mimeType: object.ContentType,
      };
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
        return undefined;
      if (error instanceof ApplicationError) throw error;
      throw unavailable();
    }
  }

  async createDownloadGrant(
    input: Parameters<ObjectStorage['createDownloadGrant']>[0],
  ): ReturnType<ObjectStorage['createDownloadGrant']> {
    assertKey(input.objectKey);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        ResponseContentDisposition: 'attachment',
        ResponseContentType: 'application/octet-stream',
      }),
      { expiresIn: this.expiresIn(input.expiresAt, 300) },
    );
    return { url, expiresAt: input.expiresAt };
  }

  async readVerifiedObject(
    input: Parameters<VerifiedDocumentReader['readVerifiedObject']>[0],
    signal: AbortSignal,
  ): Promise<Buffer> {
    assertKey(input.objectKey);
    if (
      !Number.isSafeInteger(input.maximumBytes) ||
      input.maximumBytes < 1 ||
      input.maximumBytes > MAX_BYTES ||
      !/^[a-f0-9]{64}$/i.test(input.expectedSha256)
    )
      throw invalidObject();
    const controller = new AbortController();
    const boundedSignal = AbortSignal.any([
      signal,
      controller.signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);
    let bytes: Buffer | undefined;
    let body: Readable | undefined;
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }),
        { abortSignal: boundedSignal },
      );
      if (!(response.Body instanceof Readable)) throw invalidObject();
      body = response.Body;
      // Abort can emit a stream error before iteration begins (for example, a rejected length).
      // Iteration still rejects normally; this listener also covers that teardown-only path.
      body.on('error', () => {});
      if (response.ContentLength !== input.maximumBytes) throw invalidObject();
      bytes = Buffer.alloc(input.maximumBytes);
      let offset = 0;
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        boundedSignal.throwIfAborted();
        if (!(chunk instanceof Uint8Array) || offset + chunk.byteLength > bytes.length)
          throw invalidObject();
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (
        offset !== bytes.length ||
        createHash('sha256').update(bytes).digest('hex') !== input.expectedSha256.toLowerCase()
      )
        throw invalidObject();
      return bytes;
    } catch (error) {
      bytes?.fill(0);
      if (error instanceof ApplicationError) throw error;
      throw unavailable();
    } finally {
      controller.abort();
      body?.destroy();
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  private expiresIn(expiresAt: Date, maximum: number): number {
    const seconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > maximum)
      throw new Error('Invalid document grant expiry');
    return seconds;
  }
}
