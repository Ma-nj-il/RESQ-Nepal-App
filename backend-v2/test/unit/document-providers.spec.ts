import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createSocketServer, type Server as SocketServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClamAvMalwareScanner } from '../../src/provider-operations/infrastructure/providers/clamav-malware-scanner.js';
import { S3DocumentStorage } from '../../src/provider-operations/infrastructure/providers/s3-document-storage.js';
import { ApplicationError } from '../../src/shared/application/errors/application-error.js';
import { loadApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';

const payload = Buffer.from('%PDF-1.7\nSynthetic fixture, not a real document.\n');
const sha256 = createHash('sha256').update(payload).digest('hex');
const objectKey = `restricted/documents/${randomUUID()}`;

describe('private S3 adapter wire boundaries', () => {
  let server: HttpServer, storage: S3DocumentStorage;
  let responseBody = payload,
    status = 200,
    checksum = true;

  beforeAll(async () => {
    server = createHttpServer((_request, response) => {
      response.writeHead(status, {
        'content-type': 'application/pdf',
        'content-length': responseBody.length,
        ...(checksum
          ? { 'x-amz-checksum-sha256': createHash('sha256').update(responseBody).digest('base64') }
          : {}),
      });
      response.end(responseBody);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing HTTP test address');
    storage = new S3DocumentStorage(
      loadApplicationConfig(
        {
          RESQ_OBJECT_STORAGE_ENDPOINT: `http://127.0.0.1:${String(address.port)}`,
          RESQ_DOCUMENT_BUCKET: 'synthetic-documents',
          RESQ_DOCUMENT_ACCESS_KEY_ID: 'synthetic-access',
          RESQ_DOCUMENT_SECRET_ACCESS_KEY: 'synthetic-secret',
        },
        'worker',
      ),
    );
  });
  beforeEach(() => {
    responseBody = payload;
    status = 200;
    checksum = true;
  });
  afterAll(async () => {
    storage.onModuleDestroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });

  it('signs immutable, size-bound, checksum-bound uploads with every required header', async () => {
    const grant = await storage.createUploadGrant({
      objectKey,
      sizeBytes: payload.length,
      sha256,
      mimeType: 'application/pdf',
      expiresAt: new Date(Date.now() + 600000),
    });
    const signed = new URL(grant.url).searchParams.get('X-Amz-SignedHeaders')?.split(';');
    for (const header of Object.keys(grant.requiredHeaders)) expect(signed).toContain(header);
    expect(grant.requiredHeaders['if-none-match']).toBe('*');
    expect(grant.requiredHeaders['x-amz-checksum-sha256']).toBe(
      Buffer.from(sha256, 'hex').toString('base64'),
    );
    expect(new URL(grant.url).searchParams.get('X-Amz-Expires')).toMatch(/^59[0-9]$|^600$/);
    expect(grant.url).not.toContain('synthetic-secret');
  });

  it('uses provider checksums for metadata and recomputes the checksum over bounded downloaded bytes', async () => {
    await expect(storage.readMetadata(objectKey)).resolves.toEqual({
      objectKey,
      sizeBytes: payload.length,
      sha256,
      mimeType: 'application/pdf',
    });
    await expect(
      storage.readVerifiedObject(
        { objectKey, maximumBytes: payload.length, expectedSha256: sha256 },
        AbortSignal.timeout(5000),
      ),
    ).resolves.toEqual(payload);
  });

  it('rejects wrong sizes, changed bytes and absent metadata checksums', async () => {
    await expect(
      storage.readVerifiedObject(
        { objectKey, maximumBytes: payload.length - 1, expectedSha256: sha256 },
        AbortSignal.timeout(5000),
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT.OBJECT_INTEGRITY_FAILED' });
    responseBody = Buffer.alloc(payload.length, 1);
    await expect(
      storage.readVerifiedObject(
        { objectKey, maximumBytes: payload.length, expectedSha256: sha256 },
        AbortSignal.timeout(5000),
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT.OBJECT_INTEGRITY_FAILED' });
    checksum = false;
    await expect(storage.readMetadata(objectKey)).rejects.toMatchObject({
      code: 'DOCUMENT.OBJECT_INTEGRITY_FAILED',
    });
  });

  it('distinguishes missing objects from provider outages and rejects unexpected object paths', async () => {
    status = 404;
    await expect(storage.readMetadata(objectKey)).resolves.toBeUndefined();
    status = 503;
    await expect(storage.readMetadata(objectKey)).rejects.toMatchObject({
      code: 'DOCUMENT.STORAGE_UNAVAILABLE',
      retryable: true,
    });
    await expect(storage.readMetadata('restricted/documents/../../secret')).rejects.toMatchObject({
      code: 'DOCUMENT.OBJECT_INTEGRITY_FAILED',
    });
  });

  it('creates short-lived attachment downloads and rejects expired grants', async () => {
    const grant = await storage.createDownloadGrant({
      objectKey,
      expiresAt: new Date(Date.now() + 300000),
    });
    const url = new URL(grant.url);
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment');
    expect(url.searchParams.get('response-content-type')).toBe('application/octet-stream');
    await expect(
      storage.createDownloadGrant({ objectKey, expiresAt: new Date(Date.now() - 1) }),
    ).rejects.toThrow('expiry');
  });
});

describe('ClamAV Unix INSTREAM adapter', () => {
  let directory: string, socketPath: string, server: SocketServer;
  let reply: string, received: Buffer;
  const input = { objectKey, maximumBytes: payload.length, expectedSha256: sha256 };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'resq-clam-'));
    socketPath = join(directory, 'c');
    server = createSocketServer((socket) => {
      let pending = Buffer.alloc(0),
        commandRead = false;
      socket.on('error', () => {});
      socket.on('data', (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        if (!commandRead) {
          if (pending.length < 10) return;
          expect(pending.subarray(0, 10).toString()).toBe('zINSTREAM\0');
          pending = pending.subarray(10);
          commandRead = true;
        }
        while (pending.length >= 4) {
          const length = pending.readUInt32BE();
          if (pending.length < length + 4) return;
          received = Buffer.concat([received, pending.subarray(4, 4 + length)]);
          pending = pending.subarray(length + 4);
          if (length === 0) {
            if (reply !== 'STALL') socket.end(reply);
            return;
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
  });
  beforeEach(() => {
    reply = 'stream: OK\0';
    received = Buffer.alloc(0);
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
    await rm(directory, { recursive: true, force: true });
  });

  it('streams exact verified bytes and detects MIME from content, then clears the buffer', async () => {
    const bytes = Buffer.from(payload);
    const scanner = new ClamAvMalwareScanner(
      { readVerifiedObject: () => Promise.resolve(bytes) },
      socketPath,
      5000,
    );
    await expect(scanner.scanImmutableObject(input)).resolves.toEqual({
      outcome: 'CLEAN',
      detectedMimeType: 'application/pdf',
      scannerCode: 'CLAMAV.CLEAN',
    });
    expect(received).toEqual(payload);
    expect(bytes).toEqual(Buffer.alloc(payload.length));
  });

  it.each([
    ['stream: Eicar-Signature FOUND\0', 'INFECTED'],
    ['stream: OK\0stream: Eicar-Signature FOUND\0', 'FAILED'],
    ['stream: OK', 'FAILED'],
    ['stream: engine limit exceeded ERROR\0', 'FAILED'],
    ['x'.repeat(4097), 'FAILED'],
  ])('handles daemon reply %j as %s', async (response, outcome) => {
    reply = response;
    const scanner = new ClamAvMalwareScanner(
      { readVerifiedObject: () => Promise.resolve(Buffer.from(payload)) },
      socketPath,
      5000,
    );
    const result = await scanner.scanImmutableObject(input);
    expect(result.outcome).toBe(outcome);
    expect(JSON.stringify(result)).not.toContain('Eicar-Signature');
  });

  it('rejects integrity failures before sending bytes to the daemon', async () => {
    const scanner = new ClamAvMalwareScanner(
      {
        readVerifiedObject: () =>
          Promise.reject(
            new ApplicationError({
              code: 'DOCUMENT.OBJECT_INTEGRITY_FAILED',
              message: 'synthetic',
              status: 422,
            }),
          ),
      },
      socketPath,
      5000,
    );
    await expect(scanner.scanImmutableObject(input)).resolves.toMatchObject({
      outcome: 'FAILED',
      retryable: false,
    });
    expect(received.length).toBe(0);
  });

  it('bounds a daemon that accepts the stream but never replies', async () => {
    reply = 'STALL';
    const scanner = new ClamAvMalwareScanner(
      { readVerifiedObject: () => Promise.resolve(Buffer.from(payload)) },
      socketPath,
      100,
    );
    await expect(scanner.scanImmutableObject(input)).resolves.toMatchObject({
      outcome: 'FAILED',
      retryable: true,
    });
  });
});
