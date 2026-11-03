import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import type { AuthClientType } from '../../domain/authentication.js';

export interface AdministrativeIdentityRecord {
  readonly userId: string;
  readonly passwordHash: string;
  readonly tokenVersion: number;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
}

export interface MultiFactorChallengeRecord {
  readonly id: string;
  readonly userId: string;
  readonly purpose: 'LOGIN' | 'STEP_UP' | 'RECOVERY';
  readonly authenticationMethod: 'PASSWORD' | 'SESSION';
  readonly clientType?: AuthClientType;
  readonly deviceLabel?: string;
  readonly sessionId?: string;
  readonly attempts: number;
  readonly maximumAttempts: number;
  readonly expiresAt: Date;
  readonly consumedAt?: Date;
}

export interface TotpFactorRecord {
  readonly id: string;
  readonly userId: string;
  readonly label: string;
  readonly encryptedSecret: Uint8Array;
  readonly keyVersion: string;
  readonly enrollmentExpiresAt?: Date;
  readonly lastUsedStep?: number;
  readonly verifiedAt?: Date;
  readonly revokedAt?: Date;
}

export interface MultiFactorAuthenticationRepository {
  findAdministrativeIdentity(
    transaction: TransactionContext,
    normalizedIdentifier: string,
  ): Promise<AdministrativeIdentityRecord | undefined>;
  findActiveUserTokenVersion(
    transaction: TransactionContext,
    userId: string,
  ): Promise<number | undefined>;
  hasVerifiedTotpFactor(transaction: TransactionContext, userId: string): Promise<boolean>;
  createChallenge(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly userId: string;
      readonly purpose: MultiFactorChallengeRecord['purpose'];
      readonly authenticationMethod: MultiFactorChallengeRecord['authenticationMethod'];
      readonly clientType?: AuthClientType;
      readonly deviceLabel?: string;
      readonly sessionId?: string;
      readonly maximumAttempts: number;
      readonly expiresAt: Date;
      readonly now: Date;
    },
  ): Promise<void>;
  peekChallengeUser(
    transaction: TransactionContext,
    challengeId: string,
  ): Promise<string | undefined>;
  findChallengeForUpdate(
    transaction: TransactionContext,
    challengeId: string,
  ): Promise<MultiFactorChallengeRecord | undefined>;
  recordChallengeFailure(transaction: TransactionContext, challengeId: string): Promise<number>;
  consumeChallenge(transaction: TransactionContext, challengeId: string, now: Date): Promise<void>;
  listVerifiedTotpFactors(
    transaction: TransactionContext,
    userId: string,
  ): Promise<readonly TotpFactorRecord[]>;
  consumeTotpStep(
    transaction: TransactionContext,
    factorId: string,
    step: number,
    now: Date,
  ): Promise<boolean>;
  createPendingTotpFactor(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly userId: string;
      readonly label: string;
      readonly encryptedSecret: Uint8Array;
      readonly keyVersion: string;
      readonly enrollmentExpiresAt: Date;
      readonly now: Date;
    },
  ): Promise<void>;
  findOwnedTotpFactorForUpdate(
    transaction: TransactionContext,
    userId: string,
    factorId: string,
  ): Promise<TotpFactorRecord | undefined>;
  verifyTotpFactor(
    transaction: TransactionContext,
    userId: string,
    factorId: string,
    step: number,
    now: Date,
  ): Promise<boolean>;
  upgradeSessionAssurance(
    transaction: TransactionContext,
    userId: string,
    sessionId: string,
    now: Date,
    assuranceExpiresAt: Date,
  ): Promise<boolean>;
}

export const MULTI_FACTOR_AUTHENTICATION_REPOSITORY = Symbol(
  'MULTI_FACTOR_AUTHENTICATION_REPOSITORY',
);
