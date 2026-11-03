import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { RequireAuthorization } from '../../../identity-access/presentation/http/route-authorization.decorator.js';
import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { successResponse } from '../../../shared/presentation/http/success-response.js';
import type {
  DocumentRecord,
  DocumentSubject,
} from '../../application/ports/document.repository.js';
import { DOCUMENT_SERVICE, type DocumentServiceToken } from '../../provider-operations.tokens.js';
import { expectedVersion, idempotencyKey, idempotentResponse } from './command-http.js';
import { DocumentReviewDto, DocumentUploadCreationDto } from './provider-operations.dto.js';

function subject(type: DocumentUploadCreationDto['subjectType'], id: string): DocumentSubject {
  switch (type) {
    case 'USER_IDENTITY':
      return { type, userId: id };
    case 'PROVIDER_APPLICATION':
      return { type, applicationId: id };
    case 'DRIVER_APPLICATION':
      return { type, applicationId: id };
    case 'DRIVER':
      return { type, driverId: id };
    case 'AMBULANCE':
      return { type, ambulanceId: id };
    case 'FACILITY':
      return { type, facilityId: id };
  }
}

function documentJson(record: DocumentRecord): Readonly<Record<string, unknown>> {
  return {
    id: record.id,
    subject: { ...record.subject },
    documentType: record.documentType,
    sizeBytes: record.sizeBytes,
    declaredMimeType: record.declaredMimeType,
    detectedMimeType: record.detectedMimeType ?? null,
    uploadStatus: record.uploadStatus,
    reviewStatus: record.reviewStatus,
    expiresOn: record.expiresOn ?? null,
    version: record.version,
  };
}

function uploadInput(
  body: DocumentUploadCreationDto,
): Parameters<DocumentServiceToken['createUpload']>[2] {
  return {
    subject: subject(body.subjectType, body.subjectId),
    documentType: body.documentType,
    sha256: body.sha256,
    sizeBytes: body.sizeBytes,
    mimeType: body.mimeType,
    ...(body.expiresOn === undefined ? {} : { expiresOn: body.expiresOn }),
  };
}

abstract class DocumentHttpController {
  protected constructor(
    protected readonly documents: DocumentServiceToken,
    protected readonly contexts: RequestContextStorage,
  ) {}

  protected async create(
    body: DocumentUploadCreationDto,
    key: string | undefined,
    response: Response,
  ): Promise<unknown> {
    const result = await this.documents.createUpload(
      this.contexts.require(),
      idempotencyKey(key),
      uploadInput(body),
    );
    return idempotentResponse(this.contexts, result, response);
  }

  protected async finalize(
    documentId: string,
    ifMatch: string | undefined,
    key: string | undefined,
    response: Response,
  ): Promise<unknown> {
    const result = await this.documents.finalizeUpload(
      this.contexts.require(),
      idempotencyKey(key),
      documentId,
      expectedVersion(ifMatch),
    );
    return idempotentResponse(this.contexts, result, response);
  }

  protected async one(documentId: string, response: Response): Promise<unknown> {
    const record = await this.documents.document(this.contexts.require(), documentId);
    response.setHeader('ETag', `"${String(record.version)}"`);
    return successResponse(this.contexts, documentJson(record));
  }

  protected async list(): Promise<unknown> {
    const records = await this.documents.list(this.contexts.require());
    return successResponse(this.contexts, {
      items: records.map(documentJson),
      nextCursor: null,
    });
  }

  protected async download(documentId: string): Promise<unknown> {
    const grant = await this.documents.createDownloadGrant(this.contexts.require(), documentId);
    return successResponse(this.contexts, {
      url: grant.url,
      expiresAt: grant.expiresAt.toISOString(),
    });
  }

  protected async review(
    documentId: string,
    body: DocumentReviewDto,
    ifMatch: string | undefined,
    key: string | undefined,
    response: Response,
  ): Promise<unknown> {
    const result = await this.documents.review(
      this.contexts.require(),
      idempotencyKey(key),
      documentId,
      expectedVersion(ifMatch),
      body.decision,
      body.reason,
    );
    return idempotentResponse(this.contexts, result, response);
  }
}

@Controller('/api/v1/uploads')
@RequireAuthorization({ context: 'SELF' })
export class UploadsController extends DocumentHttpController {
  constructor(
    @Inject(DOCUMENT_SERVICE) documents: DocumentServiceToken,
    @Inject(RequestContextStorage) contexts: RequestContextStorage,
  ) {
    super(documents, contexts);
  }

  @Post()
  @HttpCode(201)
  createUpload(
    @Body() body: DocumentUploadCreationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.create(body, key, response);
  }

  @Get('/:documentId')
  upload(
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.one(documentId, response);
  }

  @Post('/:documentId/finalization')
  @HttpCode(202)
  finalizeUpload(
    @Param('documentId') documentId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.finalize(documentId, ifMatch, key, response);
  }

  @Get('/:documentId/content-grant')
  content(@Param('documentId') documentId: string): Promise<unknown> {
    return this.download(documentId);
  }
}

@Controller('/api/v1/tenant')
export class TenantDocumentsController extends DocumentHttpController {
  constructor(
    @Inject(DOCUMENT_SERVICE) documents: DocumentServiceToken,
    @Inject(RequestContextStorage) contexts: RequestContextStorage,
  ) {
    super(documents, contexts);
  }

  @Post('/uploads')
  @RequireAuthorization({ context: 'TENANT', permission: 'document.upload' })
  @HttpCode(201)
  createUpload(
    @Body() body: DocumentUploadCreationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.create(body, key, response);
  }

  @Post('/uploads/:documentId/finalization')
  @RequireAuthorization({ context: 'TENANT', permission: 'document.upload' })
  @HttpCode(202)
  finalizeUpload(
    @Param('documentId') documentId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.finalize(documentId, ifMatch, key, response);
  }

  @Get('/documents')
  @RequireAuthorization({ context: 'TENANT', permission: 'document.metadata.read' })
  documentsList(): Promise<unknown> {
    return this.list();
  }

  @Get('/documents/:documentId')
  @RequireAuthorization({ context: 'TENANT', permission: 'document.metadata.read' })
  document(
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.one(documentId, response);
  }

  @Get('/documents/:documentId/content-grant')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'document.content.read',
    minimumAssurance: 'AAL2',
  })
  content(@Param('documentId') documentId: string): Promise<unknown> {
    return this.download(documentId);
  }

  @Post('/documents/:documentId/reviews')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'document.review',
    minimumAssurance: 'AAL2',
  })
  reviewDocument(
    @Param('documentId') documentId: string,
    @Body() body: DocumentReviewDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.review(documentId, body, ifMatch, key, response);
  }
}

@Controller('/api/v1/authority/documents')
export class AuthorityDocumentsController extends DocumentHttpController {
  constructor(
    @Inject(DOCUMENT_SERVICE) documents: DocumentServiceToken,
    @Inject(RequestContextStorage) contexts: RequestContextStorage,
  ) {
    super(documents, contexts);
  }

  @Get()
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'document.metadata.read',
    resourceClass: 'document',
  })
  documentsList(): Promise<unknown> {
    return this.list();
  }

  @Get('/:documentId')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'document.metadata.read',
    resourceClass: 'document',
  })
  document(
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.one(documentId, response);
  }

  @Get('/:documentId/content-grant')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'document.content.read',
    resourceClass: 'document',
    minimumAssurance: 'AAL2',
    requiresDocumentContent: true,
  })
  content(@Param('documentId') documentId: string): Promise<unknown> {
    return this.download(documentId);
  }

  @Post('/:documentId/reviews')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'document.review',
    resourceClass: 'document',
    minimumAssurance: 'AAL2',
  })
  reviewDocument(
    @Param('documentId') documentId: string,
    @Body() body: DocumentReviewDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.review(documentId, body, ifMatch, key, response);
  }
}
