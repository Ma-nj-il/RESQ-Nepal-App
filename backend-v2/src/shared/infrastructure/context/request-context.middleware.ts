import { context as otelContext, trace } from '@opentelemetry/api';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { RequestContext } from '../../application/context/request-context.js';
import { ID_GENERATOR, type IdGenerator } from '../../domain/id-generator.js';
import { RequestContextStorage } from './request-context.storage.js';

const acceptedRequestId = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

function selectedRequestId(request: Request, idGenerator: IdGenerator): string {
  const supplied = request.header('x-request-id');
  return supplied !== undefined && acceptedRequestId.test(supplied)
    ? supplied
    : idGenerator.generate();
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(RequestContextStorage) private readonly storage: RequestContextStorage,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = selectedRequestId(request, this.idGenerator);
    const activeSpan = trace.getSpan(otelContext.active())?.spanContext();
    const context = new RequestContext({
      requestId,
      correlationId: requestId,
      source: 'HTTP',
      ...(activeSpan === undefined
        ? {}
        : { traceId: activeSpan.traceId, spanId: activeSpan.spanId }),
    });

    response.setHeader('X-Request-Id', requestId);
    this.storage.run(context, next);
  }
}
