import argon2 from 'argon2';
import { Injectable } from '@nestjs/common';

import type { PasswordVerifier } from '../../application/ports/multi-factor-cryptography.js';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$7NQcDIBlpgMOoYCWJ/XNZw$f0xziltx7WS2GTbyS+8vr/MqDJfUDZWBpe9OslQpTUc';

@Injectable()
export class Argon2PasswordVerifier implements PasswordVerifier {
  async verify(encodedHash: string | undefined, password: string): Promise<boolean> {
    try {
      const valid = await argon2.verify(encodedHash ?? DUMMY_PASSWORD_HASH, password);
      return encodedHash !== undefined && valid;
    } catch {
      return false;
    }
  }
}
