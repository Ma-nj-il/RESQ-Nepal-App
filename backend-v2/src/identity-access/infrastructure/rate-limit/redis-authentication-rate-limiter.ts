import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../../shared/infrastructure/config/application-config.js';
import { RedisService } from '../../../shared/infrastructure/dependencies/redis.service.js';
import type { AuthenticationRateLimiter } from '../../application/ports/authentication-rate-limiter.js';

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

@Injectable()
export class RedisAuthenticationRateLimiter implements AuthenticationRateLimiter {
  private readonly keySecret: string;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(APP_CONFIG) config: ApplicationConfig,
  ) {
    this.keySecret = config.authentication.otpHmacSecret;
  }

  async consume(input: {
    readonly bucket: string;
    readonly discriminator: string;
    readonly maximumAttempts: number;
    readonly windowSeconds: number;
  }): Promise<void> {
    const digest = createHmac('sha256', this.keySecret)
      .update(input.discriminator, 'utf8')
      .digest('base64url');
    const key = `resq:auth-rate:v1:${input.bucket}:${digest}`;
    try {
      const client = this.redis.client('cache');
      if (client.status === 'wait') await client.connect();
      if (client.status !== 'ready') throw new Error('Redis is not ready');
      const result = await client.eval(CONSUME_SCRIPT, 1, key, String(input.windowSeconds));
      if (!Array.isArray(result)) throw new Error('Redis returned an invalid rate-limit result');
      const count = Number(result[0]);
      const ttl = Math.max(1, Number(result[1]));
      if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
        throw new Error('Redis returned an invalid rate-limit counter');
      }
      if (count > input.maximumAttempts) {
        throw new ApplicationError({
          code: 'RATE_LIMIT.EXCEEDED',
          message: 'Too many requests.',
          status: 429,
          retryable: true,
          retryAfterSeconds: ttl,
        });
      }
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError({
        code: 'AUTH.RATE_LIMIT_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
        status: 503,
        retryable: true,
        retryAfterSeconds: 5,
        cause: error,
      });
    }
  }
}
