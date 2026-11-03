import { Server } from 'node:net';

import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { DispatchRecoveryService } from '../../src/core-dispatch/application/dispatch-recovery.service.js';

import {
  BOOKING_DISPATCH_SERVICE,
  SAFETY_SERVICE,
  TRIP_TRACKING_SERVICE,
} from '../../src/core-dispatch/core-dispatch.tokens.js';
import { RequesterDispatchController } from '../../src/core-dispatch/presentation/http/requester-dispatch.controller.js';
import { ACCESS_ADMINISTRATION_SERVICE } from '../../src/identity-access/identity-access.tokens.js';
import {
  AccessAdministrationController,
  AuthorityGrantAdministrationController,
} from '../../src/identity-access/presentation/http/access-administration.controller.js';
import { ProviderApplicationsController } from '../../src/provider-operations/presentation/http/provider-registry.controller.js';
import { PROVIDER_REGISTRY_SERVICE } from '../../src/provider-operations/provider-operations.tokens.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import type {
  IdempotentResult,
  JsonValue,
} from '../../src/shared/application/idempotency/idempotency.js';
import { RequestContextStorage } from '../../src/shared/infrastructure/context/request-context.storage.js';

describe('command status through the installed Nest HTTP adapter', () => {
  let application: INestApplication;
  let server: Server;
  const command = jest.fn<() => Promise<IdempotentResult<JsonValue>>>();
  const contexts = new RequestContextStorage();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        ProviderApplicationsController,
        RequesterDispatchController,
        AccessAdministrationController,
        AuthorityGrantAdministrationController,
      ],
      providers: [
        { provide: RequestContextStorage, useValue: contexts },
        {
          provide: PROVIDER_REGISTRY_SERVICE,
          useValue: { createApplication: command, submit: command },
        },
        { provide: BOOKING_DISPATCH_SERVICE, useValue: { cancelBooking: command } },
        { provide: TRIP_TRACKING_SERVICE, useValue: {} },
        { provide: SAFETY_SERVICE, useValue: {} },
        { provide: DispatchRecoveryService, useValue: {} },
        {
          provide: ACCESS_ADMINISTRATION_SERVICE,
          useValue: {
            retireRole: command,
            createAuthorityGrant: command,
            approveAuthorityGrant: command,
            revokeAuthorityGrant: command,
          },
        },
      ],
    }).compile();
    application = module.createNestApplication();
    application.use((_req: Request, _res: Response, next: NextFunction) => {
      contexts.run(
        new RequestContext({
          requestId: 'http-status-regression',
          correlationId: 'http-status-regression',
          source: 'HTTP',
        }),
        next,
      );
    });
    await application.init();
    const httpServer: unknown = application.getHttpServer();
    if (!(httpServer instanceof Server)) throw new Error('Nest did not create an HTTP server');
    server = httpServer;
  });

  afterAll(async () => {
    await application.close();
  });

  it.each([
    ['/api/v1/provider-applications', 201],
    ['/api/v1/provider-applications/application-id/submission', 200],
    ['/api/v1/bookings/booking-id/cancellation', 200],
    ['/api/v1/tenant/access/roles/role-id/retirement', 200],
    ['/api/v1/authority/grants', 201],
    ['/api/v1/authority/grants/grant-id/approval', 200],
    ['/api/v1/authority/grants/grant-id/revocation', 200],
  ] as const)('preserves initial and replay status for POST %s', async (path, status) => {
    const value = { id: 'durable-result-id', version: 2 };
    for (const replayed of [false, true]) {
      command.mockResolvedValueOnce({ status, replayed, value });
      const response = await request(server)
        .post(path)
        .set('Idempotency-Key', 'http-status-regression-key')
        .set('If-Match', '"1"')
        .send({ reason: 'Synthetic command' })
        .expect(status)
        .expect('Idempotency-Replayed', String(replayed));
      expect(response.body).toEqual({ data: value, meta: { requestId: 'http-status-regression' } });
    }
  });

  beforeEach(() => {
    command.mockReset();
  });
});
