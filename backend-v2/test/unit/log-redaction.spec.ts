import { Writable } from 'node:stream';

import pino from 'pino';

import { loadApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';
import { RequestContextStorage } from '../../src/shared/infrastructure/context/request-context.storage.js';
import { createPinoHttpOptions } from '../../src/shared/infrastructure/logging/pino-options.js';

describe('structured log redaction', () => {
  it('redacts credential, identity, and location fields', () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString('utf8'));
        callback();
      },
    });
    const options = createPinoHttpOptions(
      loadApplicationConfig({ NODE_ENV: 'test' }, 'api'),
      new RequestContextStorage(),
    );
    const redact = options.redact;
    if (redact === undefined) throw new Error('Log redaction must be configured');
    const logger = pino({ redact, timestamp: false, base: null }, destination);

    logger.info({
      password: 'not-for-logs',
      accessToken: 'token-value',
      phone: '+9779800000000',
      latitude: 27.7,
      safeCode: 'BOOKING.CREATED',
    });

    const record = JSON.parse(chunks.join('')) as Record<string, unknown>;
    expect(record['password']).toBe('[REDACTED]');
    expect(record['accessToken']).toBe('[REDACTED]');
    expect(record['phone']).toBe('[REDACTED]');
    expect(record['latitude']).toBe('[REDACTED]');
    expect(record['safeCode']).toBe('BOOKING.CREATED');
    expect(chunks.join('')).not.toContain('not-for-logs');
  });
});
