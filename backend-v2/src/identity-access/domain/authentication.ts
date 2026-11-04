export const AUTHENTICATION_ASSURANCE_LEVELS = ['AAL1', 'AAL2'] as const;
export type AuthenticationAssurance = (typeof AUTHENTICATION_ASSURANCE_LEVELS)[number];

export const AUTH_CLIENT_TYPES = ['MOBILE', 'BROWSER'] as const;
export type AuthClientType = (typeof AUTH_CLIENT_TYPES)[number];

export const AUTHENTICATION_METHODS = ['otp', 'password', 'totp'] as const;
export type AuthenticationMethod = (typeof AUTHENTICATION_METHODS)[number];

export interface AccessTokenClaims {
  readonly issuer: string;
  readonly audience: string;
  readonly subject: string;
  readonly sessionId: string;
  readonly tokenId: string;
  readonly issuedAt: number;
  readonly notBefore: number;
  readonly expiresAt: number;
  readonly assurance: AuthenticationAssurance;
  readonly tokenVersion: number;
  readonly authenticationMethods: readonly AuthenticationMethod[];
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface AuthenticatedSession {
  readonly userId: string;
  readonly sessionId: string;
  readonly clientType: AuthClientType;
  readonly assurance: AuthenticationAssurance;
  readonly assuranceExpiresAt?: Date;
  readonly tokenVersion: number;
  readonly absoluteExpiresAt: Date;
  readonly idleExpiresAt: Date;
  readonly revokedAt?: Date;
}

export interface SessionTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly sessionId: string;
  readonly assurance: AuthenticationAssurance;
}
