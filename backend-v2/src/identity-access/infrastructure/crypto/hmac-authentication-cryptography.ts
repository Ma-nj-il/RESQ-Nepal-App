import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticationCryptography } from '../../application/ports/authentication-cryptography.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../../shared/infrastructure/config/application-config.js';

function digest(secret: string, purpose: string, values: readonly string[]): Uint8Array {
  const hmac = createHmac('sha256', secret);
  hmac.update(purpose, 'utf8');
  for (const value of values) {
    hmac.update('\0', 'utf8');
    hmac.update(value, 'utf8');
  }
  return hmac.digest();
}

@Injectable()
export class HmacAuthenticationCryptography implements AuthenticationCryptography {
  constructor(@Inject(APP_CONFIG) private readonly config: ApplicationConfig) {}

  generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  digestOtp(challengeId: string, normalizedPhone: string, otp: string): Uint8Array {
    return digest(this.config.authentication.otpHmacSecret, 'otp-v1', [
      challengeId,
      normalizedPhone,
      otp,
    ]);
  }

  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  digestRefreshToken(token: string): Uint8Array {
    return digest(this.config.authentication.refreshTokenHmacSecret, 'refresh-v1', [token]);
  }

  equals(left: Uint8Array, right: Uint8Array): boolean {
    return left.byteLength === right.byteLength && timingSafeEqual(left, right);
  }
}
