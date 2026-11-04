import type {
  AccessTokenClaims,
  AuthenticationMethod,
  IssuedAccessToken,
} from '../../domain/authentication.js';

export interface AuthenticationCryptography {
  generateOtp(): string;
  digestOtp(challengeId: string, normalizedPhone: string, otp: string): Uint8Array;
  generateRefreshToken(): string;
  digestRefreshToken(token: string): Uint8Array;
  equals(left: Uint8Array, right: Uint8Array): boolean;
}

export const AUTHENTICATION_CRYPTOGRAPHY = Symbol('AUTHENTICATION_CRYPTOGRAPHY');

export interface AccessTokenIssuer {
  issue(input: {
    readonly userId: string;
    readonly sessionId: string;
    readonly assurance: AccessTokenClaims['assurance'];
    readonly tokenVersion: number;
    readonly authenticationMethods: readonly AuthenticationMethod[];
    readonly now: Date;
    readonly tokenId: string;
  }): IssuedAccessToken;
  verify(token: string, now: Date): AccessTokenClaims;
  jwks(): Readonly<{ keys: readonly Readonly<Record<string, unknown>>[] }>;
}

export const ACCESS_TOKEN_ISSUER = Symbol('ACCESS_TOKEN_ISSUER');
