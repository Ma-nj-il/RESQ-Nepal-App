import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../../shared/application/errors/application-error.js';
import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../../shared/infrastructure/config/application-config.js';
import type { AccessTokenIssuer } from '../../application/ports/authentication-cryptography.js';
import {
  AUTHENTICATION_METHODS,
  type AccessTokenClaims,
  type AuthenticationMethod,
  type IssuedAccessToken,
} from '../../domain/authentication.js';

interface JwtHeader {
  readonly alg: 'EdDSA';
  readonly kid: string;
  readonly typ: 'JWT';
}

interface JwtPayload {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly sid: string;
  readonly jti: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly aal: 'AAL1' | 'AAL2';
  readonly ver: number;
  readonly amr: readonly AuthenticationMethod[];
}

interface SigningKey {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

function invalidToken(code = 'AUTH.ACCESS_TOKEN_INVALID'): ApplicationError {
  return new ApplicationError({
    code,
    message: 'The access token is invalid or expired.',
    status: 401,
  });
}

function decodeJsonSegment(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw invalidToken();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPayload(value: unknown): JwtPayload {
  if (!isRecord(value)) throw invalidToken();
  const amr = value['amr'];
  if (
    typeof value['iss'] !== 'string' ||
    typeof value['aud'] !== 'string' ||
    typeof value['sub'] !== 'string' ||
    typeof value['sid'] !== 'string' ||
    typeof value['jti'] !== 'string' ||
    typeof value['iat'] !== 'number' ||
    typeof value['nbf'] !== 'number' ||
    typeof value['exp'] !== 'number' ||
    (value['aal'] !== 'AAL1' && value['aal'] !== 'AAL2') ||
    typeof value['ver'] !== 'number' ||
    !Number.isInteger(value['ver']) ||
    !Array.isArray(amr) ||
    amr.length < 1 ||
    amr.length > AUTHENTICATION_METHODS.length ||
    !amr.every(
      (method): method is AuthenticationMethod =>
        typeof method === 'string' &&
        AUTHENTICATION_METHODS.includes(method as AuthenticationMethod),
    ) ||
    new Set(amr).size !== amr.length
  ) {
    throw invalidToken();
  }
  return {
    iss: value['iss'],
    aud: value['aud'],
    sub: value['sub'],
    sid: value['sid'],
    jti: value['jti'],
    iat: value['iat'],
    nbf: value['nbf'],
    exp: value['exp'],
    aal: value['aal'],
    ver: value['ver'],
    amr,
  };
}

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function configuredSigningKey(config: ApplicationConfig): SigningKey {
  const privateValue = config.authentication.privateKeyBase64;
  const publicValue = config.authentication.publicKeyBase64;
  if (privateValue === undefined && publicValue === undefined) {
    const generated = generateKeyPairSync('ed25519');
    return {
      keyId: config.authentication.signingKeyId,
      privateKey: generated.privateKey,
      publicKey: generated.publicKey,
    };
  }
  if (privateValue === undefined || publicValue === undefined) {
    throw new Error('Both authentication private and public keys must be configured together');
  }
  return {
    keyId: config.authentication.signingKeyId,
    privateKey: createPrivateKey(Buffer.from(privateValue, 'base64').toString('utf8')),
    publicKey: createPublicKey(Buffer.from(publicValue, 'base64').toString('utf8')),
  };
}

@Injectable()
export class EdDsaAccessTokenService implements AccessTokenIssuer {
  private active: SigningKey;
  private readonly verificationKeys = new Map<string, KeyObject>();

  constructor(@Inject(APP_CONFIG) private readonly config: ApplicationConfig) {
    this.active = configuredSigningKey(config);
    this.verificationKeys.set(this.active.keyId, this.active.publicKey);
    for (const graceKey of config.authentication.gracePublicKeys) {
      if (this.verificationKeys.has(graceKey.keyId)) {
        throw new Error(`Duplicate authentication key ID: ${graceKey.keyId}`);
      }
      this.verificationKeys.set(
        graceKey.keyId,
        createPublicKey(Buffer.from(graceKey.publicKeyBase64, 'base64').toString('utf8')),
      );
    }
  }

  issue(input: {
    readonly userId: string;
    readonly sessionId: string;
    readonly assurance: 'AAL1' | 'AAL2';
    readonly tokenVersion: number;
    readonly authenticationMethods: readonly AuthenticationMethod[];
    readonly now: Date;
    readonly tokenId: string;
  }): IssuedAccessToken {
    const issuedAt = Math.floor(input.now.getTime() / 1_000);
    const expiresAtSeconds = issuedAt + this.config.authentication.accessTokenTtlSeconds;
    const header: JwtHeader = { alg: 'EdDSA', kid: this.active.keyId, typ: 'JWT' };
    const payload: JwtPayload = {
      iss: this.config.authentication.issuer,
      aud: this.config.authentication.audience,
      sub: input.userId,
      sid: input.sessionId,
      jti: input.tokenId,
      iat: issuedAt,
      nbf: issuedAt,
      exp: expiresAtSeconds,
      aal: input.assurance,
      ver: input.tokenVersion,
      amr: [...input.authenticationMethods],
    };
    const signingInput = `${encoded(header)}.${encoded(payload)}`;
    const signature = sign(null, Buffer.from(signingInput, 'ascii'), this.active.privateKey);
    return {
      token: `${signingInput}.${signature.toString('base64url')}`,
      expiresAt: new Date(expiresAtSeconds * 1_000),
    };
  }

  verify(token: string, now: Date): AccessTokenClaims {
    const segments = token.split('.');
    if (segments.length !== 3) throw invalidToken();
    const headerSegment = segments[0];
    const payloadSegment = segments[1];
    const signatureSegment = segments[2];
    if (
      headerSegment === undefined ||
      payloadSegment === undefined ||
      signatureSegment === undefined
    ) {
      throw invalidToken();
    }
    const rawHeader = decodeJsonSegment(headerSegment);
    if (!isRecord(rawHeader)) throw invalidToken();
    if (
      rawHeader['alg'] !== 'EdDSA' ||
      rawHeader['typ'] !== 'JWT' ||
      typeof rawHeader['kid'] !== 'string'
    ) {
      throw invalidToken();
    }
    const publicKey = this.verificationKeys.get(rawHeader['kid']);
    if (publicKey === undefined) throw invalidToken();
    let signature: Buffer;
    try {
      signature = Buffer.from(signatureSegment, 'base64url');
    } catch {
      throw invalidToken();
    }
    if (
      !verify(
        null,
        Buffer.from(`${headerSegment}.${payloadSegment}`, 'ascii'),
        publicKey,
        signature,
      )
    ) {
      throw invalidToken();
    }

    const payload = readPayload(decodeJsonSegment(payloadSegment));
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const clockSkewSeconds = 30;
    if (
      payload.iss !== this.config.authentication.issuer ||
      payload.aud !== this.config.authentication.audience ||
      payload.iat > nowSeconds + clockSkewSeconds ||
      payload.nbf > nowSeconds + clockSkewSeconds ||
      payload.exp <= nowSeconds - clockSkewSeconds
    ) {
      throw invalidToken(
        payload.exp <= nowSeconds - clockSkewSeconds ? 'AUTH.ACCESS_TOKEN_EXPIRED' : undefined,
      );
    }
    return {
      issuer: payload.iss,
      audience: payload.aud,
      subject: payload.sub,
      sessionId: payload.sid,
      tokenId: payload.jti,
      issuedAt: payload.iat,
      notBefore: payload.nbf,
      expiresAt: payload.exp,
      assurance: payload.aal,
      tokenVersion: payload.ver,
      authenticationMethods: Object.freeze([...payload.amr]),
    };
  }

  jwks(): Readonly<{ keys: readonly Readonly<Record<string, unknown>>[] }> {
    const keys = [...this.verificationKeys.entries()].map(([keyId, key]) => {
      const exported = key.export({ format: 'jwk' });
      return Object.freeze({ ...exported, kid: keyId, use: 'sig', alg: 'EdDSA' });
    });
    return Object.freeze({ keys: Object.freeze(keys) });
  }

  /** Used by a managed-key adapter during publish-before-sign rotation and by rotation tests. */
  installSigningKey(keyId: string, privateKey: KeyObject, publicKey: KeyObject): void {
    this.verificationKeys.set(keyId, publicKey);
    this.active = { keyId, privateKey, publicKey };
  }

  retireVerificationKey(keyId: string): void {
    if (keyId === this.active.keyId) throw new Error('The active signing key cannot be retired');
    this.verificationKeys.delete(keyId);
  }
}
