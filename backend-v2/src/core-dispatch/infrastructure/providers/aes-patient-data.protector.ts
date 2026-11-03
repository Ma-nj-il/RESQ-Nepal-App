import { createCipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  PatientDataProtector,
  ProtectedPatientData,
} from '../../application/ports/patient-data-protector.js';
import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import type { JsonValue } from '../../../shared/application/idempotency/idempotency.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../../shared/infrastructure/config/application-config.js';

@Injectable()
export class AesPatientDataProtector implements PatientDataProtector {
  constructor(@Inject(APP_CONFIG) private readonly config: ApplicationConfig) {}

  protect(payload: Readonly<Record<string, JsonValue>>): Promise<ProtectedPatientData> {
    const encodedKey = this.config.dispatch.patientDataEncryptionKeyBase64;
    const keyVersion = this.config.dispatch.patientDataEncryptionKeyId;
    if (encodedKey === undefined || keyVersion === undefined) {
      throw new ApplicationError({
        code: 'DISPATCH.ENCRYPTION_UNAVAILABLE',
        message: 'Sensitive booking data cannot be protected at this time.',
        status: 503,
        retryable: true,
      });
    }
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32) throw new Error('Validated dispatch encryption key has invalid length');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    return Promise.resolve({
      ciphertext,
      nonce,
      tag: cipher.getAuthTag(),
      keyVersion,
    });
  }
}
