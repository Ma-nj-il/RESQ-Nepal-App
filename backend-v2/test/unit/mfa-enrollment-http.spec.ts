import { Server } from 'node:net';
import { jest } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuthenticationController } from '../../src/identity-access/presentation/http/authentication.controller.js';
import {
  AUTHENTICATION_SERVICE,
  AUTHORIZATION_SERVICE,
  MULTI_FACTOR_AUTHENTICATION_SERVICE,
} from '../../src/identity-access/identity-access.tokens.js';
import { AUTHENTICATION_RATE_LIMITER } from '../../src/identity-access/application/ports/authentication-rate-limiter.js';
import { ACCESS_TOKEN_ISSUER } from '../../src/identity-access/application/ports/authentication-cryptography.js';
import {
  APP_CONFIG,
  loadApplicationConfig,
} from '../../src/shared/infrastructure/config/application-config.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import { RequestContextStorage } from '../../src/shared/infrastructure/context/request-context.storage.js';

const id = '00000000-0000-4000-8000-000000000001';
const expiry = new Date('2026-11-04T10:10:00Z');

describe('MFA enrollment HTTP response contract', () => {
  let application: INestApplication, server: Server;
  const contexts = new RequestContextStorage();
  const verify = jest.fn(() =>
    Promise.resolve({
      userId: id,
      sessionId: id,
      assurance: 'AAL2',
      accessToken: 'synthetic.access',
      accessTokenExpiresAt: expiry,
    }),
  );
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthenticationController],
      providers: [
        { provide: RequestContextStorage, useValue: contexts },
        { provide: APP_CONFIG, useValue: loadApplicationConfig({ NODE_ENV: 'test' }, 'api') },
        { provide: AUTHENTICATION_SERVICE, useValue: {} },
        { provide: AUTHORIZATION_SERVICE, useValue: {} },
        { provide: ACCESS_TOKEN_ISSUER, useValue: {} },
        { provide: AUTHENTICATION_RATE_LIMITER, useValue: { consume: () => Promise.resolve() } },
        {
          provide: MULTI_FACTOR_AUTHENTICATION_SERVICE,
          useValue: {
            createTotpEnrollment: () =>
              Promise.resolve({
                factorId: id,
                sharedSecret: 'SYNTHETIC',
                provisioningUri: 'otpauth://totp/synthetic',
                expiresAt: expiry,
              }),
            verifyTotpEnrollment: verify,
          },
        },
      ],
    }).compile();
    application = module.createNestApplication();
    application.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    application.use((_req: Request, _res: Response, next: NextFunction) =>
      contexts.run(
        new RequestContext({
          requestId: id,
          correlationId: id,
          source: 'HTTP',
          actor: { type: 'USER', id },
          sessionId: id,
        }),
        next,
      ),
    );
    await application.init();
    const httpServer: unknown = application.getHttpServer();
    if (!(httpServer instanceof Server)) throw new Error('Expected HTTP server');
    server = httpServer;
  });
  afterAll(async () => {
    await application.close();
  });
  beforeEach(() => {
    verify.mockClear();
  });

  it('marks setup secrets private/no-store and serializes the stored expiry', async () => {
    const response = await request(server)
      .post('/api/v1/me/mfa/totp-enrollments')
      .send({ label: 'Primary' })
      .expect(201)
      .expect('Cache-Control', 'private, no-store');
    expect(response.body).toEqual({
      data: {
        factorId: id,
        sharedSecret: 'SYNTHETIC',
        provisioningUri: 'otpauth://totp/synthetic',
        expiresAt: expiry.toISOString(),
      },
      meta: { requestId: id },
    });
  });

  it('returns only identity-bound access credentials and marks them private/no-store', async () => {
    const response = await request(server)
      .post(`/api/v1/me/mfa/totp-enrollments/${id}/verification`)
      .send({ code: '123456' })
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(response.body).toEqual({
      data: {
        userId: id,
        sessionId: id,
        assurance: 'AAL2',
        accessToken: 'synthetic.access',
        accessTokenExpiresAt: expiry.toISOString(),
      },
      meta: { requestId: id },
    });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rejects invalid factor identifiers and codes before verification', async () => {
    await request(server)
      .post('/api/v1/me/mfa/totp-enrollments/not-an-id/verification')
      .send({ code: '123456' })
      .expect(400);
    await request(server)
      .post(`/api/v1/me/mfa/totp-enrollments/${id}/verification`)
      .send({ code: 'wrong' })
      .expect(400);
    expect(verify.mock.calls).toHaveLength(0);
  });
});
