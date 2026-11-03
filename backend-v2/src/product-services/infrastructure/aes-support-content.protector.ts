import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../shared/infrastructure/config/application-config.js';
import type {
  ContentProtector,
  ProtectedContent,
} from '../application/ports/product.repository.js';

@Injectable()
export class AesSupportContentProtector implements ContentProtector {
  constructor(@Inject(APP_CONFIG) private readonly config: ApplicationConfig) {}

  protect(messageId: string, ticketId: string, text: string): ProtectedContent {
    const { key, keyVersion } = this.key();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(`resq:support:v1:${ticketId}:${messageId}`));
    return {
      ciphertext: Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]),
      nonce,
      tag: cipher.getAuthTag(),
      keyVersion,
    };
  }

  reveal(messageId: string, ticketId: string, content: ProtectedContent): string {
    const { key, keyVersion } = this.key();
    if (content.keyVersion !== keyVersion) throw this.unavailable();
    try {
      const cipher = createDecipheriv('aes-256-gcm', key, content.nonce);
      cipher.setAAD(Buffer.from(`resq:support:v1:${ticketId}:${messageId}`));
      cipher.setAuthTag(content.tag);
      return Buffer.concat([cipher.update(content.ciphertext), cipher.final()]).toString('utf8');
    } catch {
      throw this.unavailable();
    }
  }

  private key(): { key: Buffer; keyVersion: string } {
    const encoded = this.config.dispatch.patientDataEncryptionKeyBase64;
    const keyVersion = this.config.dispatch.patientDataEncryptionKeyId;
    if (encoded === undefined || keyVersion === undefined) throw this.unavailable();
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw this.unavailable();
    return { key, keyVersion };
  }

  private unavailable(): ApplicationError {
    return new ApplicationError({
      code: 'SUPPORT.CONTENT_UNAVAILABLE',
      message: 'Protected support content is unavailable.',
      status: 503,
      retryable: true,
    });
  }
}
