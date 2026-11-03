import { Server } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PlatformModule } from '../../src/platform/platform.module.js';

describe('HTTP foundation', () => {
  let application: INestApplication;
  let server: Server;
  const previousEnvironment = { ...process.env };

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      RESQ_RELEASE: 'unit-test',
      RESQ_LOG_LEVEL: 'fatal',
      RESQ_LOG_PRETTY: 'false',
      RESQ_DEPENDENCY_TIMEOUT_MS: '100',
      RESQ_DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/unavailable',
      RESQ_REDIS_CACHE_URL: 'redis://127.0.0.1:1/0',
      RESQ_REDIS_QUEUE_URL: 'redis://127.0.0.1:1/0',
      RESQ_KAFKA_BROKERS: '127.0.0.1:1',
      RESQ_OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:1',
      RESQ_CORS_ORIGINS: 'http://localhost:8081',
      RESQ_OTEL_ENABLED: 'false',
    });
    const module = await Test.createTestingModule({
      imports: [PlatformModule.forRole('api')],
    }).compile();
    application = module.createNestApplication();
    await application.init();
    const httpServer: unknown = application.getHttpServer();
    if (!(httpServer instanceof Server)) throw new Error('Nest did not create an HTTP server');
    server = httpServer;
  });

  afterAll(async () => {
    await application.close();
    process.env = previousEnvironment;
  });

  it('keeps liveness independent of network dependencies', async () => {
    const response = await request(server).get('/health/live').expect(200);
    const body: unknown = response.body;
    expect(body).toMatchObject({ status: 'ok', role: 'api' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fails readiness safely without exposing dependency locations', async () => {
    const response = await request(server).get('/health/ready').expect(503);
    const body: unknown = response.body;
    expect(body).toMatchObject({ status: 'unavailable' });
    if (typeof body !== 'object' || body === null || !('checks' in body)) {
      throw new Error('Readiness response did not include checks');
    }
    expect(body.checks).toEqual(
      expect.arrayContaining([
        { name: 'postgresql', status: 'down' },
        { name: 'redis-cache', status: 'down' },
      ]),
    );
    expect(JSON.stringify(body)).not.toContain('127.0.0.1');
    expect(JSON.stringify(body)).not.toContain('invalid');
  });

  it('returns the stable error envelope and preserves a valid request ID', async () => {
    const requestId = 'test-request-id-0000000000000001';
    const response = await request(server)
      .get('/does-not-exist')
      .set('X-Request-Id', requestId)
      .expect(404);
    const body: unknown = response.body;
    expect(body).toEqual({
      error: {
        code: 'RESOURCE.NOT_FOUND',
        message: 'The requested resource was not found.',
        retryable: false,
      },
      meta: { requestId },
    });
    expect(response.headers['x-request-id']).toBe(requestId);
  });
});
