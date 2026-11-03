import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import type {
  AuthClientType,
  AuthenticatedSession,
  AuthenticationAssurance,
} from '../../domain/authentication.js';
import type { SessionAuthorizationState } from '../../domain/authorization.js';

export type OtpPurpose = 'REGISTRATION_OR_LOGIN' | 'RECOVERY' | 'STEP_UP';

export interface OtpChallengeRecord {
  readonly id: string;
  readonly normalizedPhone: string;
  readonly purpose: OtpPurpose;
  readonly codeDigest: Uint8Array;
  readonly attempts: number;
  readonly maximumAttempts: number;
  readonly expiresAt: Date;
  readonly consumedAt?: Date;
}

export interface PhoneUserRecord {
  readonly userId: string;
  readonly tokenVersion: number;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  readonly created: boolean;
}

export interface RefreshTokenRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly familyId: string;
  readonly userId: string;
  readonly tokenVersion: number;
  readonly assurance: AuthenticationAssurance;
  readonly assuranceExpiresAt?: Date;
  readonly clientType: AuthClientType;
  readonly expiresAt: Date;
  readonly sessionIdleExpiresAt: Date;
  readonly sessionAbsoluteExpiresAt: Date;
  readonly consumedAt?: Date;
  readonly revokedAt?: Date;
  readonly sessionRevokedAt?: Date;
}

export interface OwnedSessionRecord extends AuthenticatedSession {
  readonly deviceLabel?: string;
  readonly lastUsedAt: Date;
  readonly createdAt: Date;
  readonly current: boolean;
}

export interface AuthenticationRepository {
  createOtpChallenge(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly normalizedPhone: string;
      readonly purpose: OtpPurpose;
      readonly codeDigest: Uint8Array;
      readonly maximumAttempts: number;
      readonly expiresAt: Date;
      readonly createdAt: Date;
    },
  ): Promise<void>;
  findOtpChallengeForUpdate(
    transaction: TransactionContext,
    challengeId: string,
  ): Promise<OtpChallengeRecord | undefined>;
  recordOtpFailure(
    transaction: TransactionContext,
    challengeId: string,
    now: Date,
  ): Promise<number>;
  consumeOtpChallenge(
    transaction: TransactionContext,
    challengeId: string,
    now: Date,
  ): Promise<void>;
  findOrCreatePhoneUser(
    transaction: TransactionContext,
    normalizedPhone: string,
    userId: string,
    identityId: string,
    profileId: string,
    now: Date,
  ): Promise<PhoneUserRecord>;
  createSessionAndRefreshToken(
    transaction: TransactionContext,
    input: {
      readonly sessionId: string;
      readonly userId: string;
      readonly familyId: string;
      readonly refreshTokenId: string;
      readonly refreshTokenDigest: Uint8Array;
      readonly refreshTokenExpiresAt: Date;
      readonly clientType: AuthClientType;
      readonly deviceLabel?: string;
      readonly assurance: AuthenticationAssurance;
      readonly assuranceExpiresAt?: Date;
      readonly idleExpiresAt: Date;
      readonly absoluteExpiresAt: Date;
      readonly now: Date;
    },
  ): Promise<void>;
  findRefreshTokenForUpdate(
    transaction: TransactionContext,
    digest: Uint8Array,
  ): Promise<RefreshTokenRecord | undefined>;
  rotateRefreshToken(
    transaction: TransactionContext,
    input: {
      readonly consumedTokenId: string;
      readonly successorTokenId: string;
      readonly successorDigest: Uint8Array;
      readonly successorExpiresAt: Date;
      readonly sessionId: string;
      readonly familyId: string;
      readonly now: Date;
      readonly idleExpiresAt: Date;
      readonly assurance: AuthenticationAssurance;
      readonly assuranceExpiresAt?: Date;
    },
  ): Promise<void>;
  revokeRefreshFamily(
    transaction: TransactionContext,
    familyId: string,
    now: Date,
    reason: string,
  ): Promise<void>;
  revokeSession(
    transaction: TransactionContext,
    userId: string,
    sessionId: string,
    now: Date,
    reason: string,
  ): Promise<boolean>;
  revokeOtherSessions(
    transaction: TransactionContext,
    userId: string,
    currentSessionId: string,
    includeCurrent: boolean,
    now: Date,
    reason: string,
  ): Promise<number>;
  findSessionAuthorizationState(
    transaction: TransactionContext,
    userId: string,
    sessionId: string,
  ): Promise<SessionAuthorizationState | undefined>;
  listOwnedSessions(
    transaction: TransactionContext,
    userId: string,
    currentSessionId: string,
  ): Promise<readonly OwnedSessionRecord[]>;
}

export const AUTHENTICATION_REPOSITORY = Symbol('AUTHENTICATION_REPOSITORY');
