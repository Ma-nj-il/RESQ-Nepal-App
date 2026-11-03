import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  MultiFactorCryptography,
  TotpEnrollmentSecret,
} from '../../application/ports/multi-factor-cryptography.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../../shared/infrastructure/config/application-config.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function base32(value: Uint8Array): string {
  let bits = 0;
  let buffer = 0;
  let output = '';
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET.charAt((buffer >>> bits) & 31);
    }
  }
  if (bits > 0) output += BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 31);
  return output;
}

function associatedData(factorId: string, userId: string): Buffer {
  return Buffer.from(`resq:mfa:totp:${factorId}:${userId}`, 'utf8');
}

function totp(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, '0');
}

@Injectable()
export class AesTotpCryptography implements MultiFactorCryptography {
  private readonly key: Buffer;
  private readonly keyVersion: string;

  constructor(@Inject(APP_CONFIG) config: ApplicationConfig) {
    this.key = Buffer.from(config.authentication.mfaEncryptionKeyBase64, 'base64');
    this.keyVersion = config.authentication.mfaEncryptionKeyId;
  }

  createTotpEnrollment(input: {
    readonly factorId: string;
    readonly userId: string;
    readonly accountLabel: string;
  }): TotpEnrollmentSecret {
    const secret = randomBytes(20);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(associatedData(input.factorId, input.userId));
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    const encryptedSecret = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    const sharedSecret = base32(secret);
    const issuer = 'RESQ Nepal';
    const label = `${issuer}:${input.accountLabel}`;
    const provisioningUri = `otpauth://totp/${encodeURIComponent(label)}?secret=${sharedSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    return {
      encryptedSecret,
      keyVersion: this.keyVersion,
      sharedSecret,
      provisioningUri,
    };
  }

  matchingTotpStep(input: {
    readonly factorId: string;
    readonly userId: string;
    readonly encryptedSecret: Uint8Array;
    readonly keyVersion: string;
    readonly code: string;
    readonly now: Date;
  }): number | undefined {
    if (input.keyVersion !== this.keyVersion || !/^\d{6}$/.test(input.code)) return undefined;
    const encrypted = Buffer.from(input.encryptedSecret);
    if (encrypted.length <= IV_BYTES + TAG_BYTES) return undefined;
    try {
      const iv = encrypted.subarray(0, IV_BYTES);
      const tag = encrypted.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const ciphertext = encrypted.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(associatedData(input.factorId, input.userId));
      decipher.setAuthTag(tag);
      const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const currentStep = Math.floor(input.now.getTime() / 30_000);
      for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
        const expected = Buffer.from(totp(secret, step), 'ascii');
        const supplied = Buffer.from(input.code, 'ascii');
        if (timingSafeEqual(expected, supplied)) return step;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
