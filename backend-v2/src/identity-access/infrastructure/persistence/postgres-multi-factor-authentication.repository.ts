import { Injectable } from '@nestjs/common';

import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import { queryRows } from '../../../shared/infrastructure/persistence/query-rows.js';
import { entityManagerFor } from '../../../shared/infrastructure/persistence/typeorm-unit-of-work.js';
import { setTransactionClaim } from '../../../shared/infrastructure/persistence/transaction-claims.js';
import type {
  AdministrativeIdentityRecord,
  MultiFactorAuthenticationRepository,
  MultiFactorChallengeRecord,
  TotpFactorRecord,
} from '../../application/ports/multi-factor-authentication.repository.js';
import type { AuthenticationMethod } from '../../domain/authentication.js';

interface ChallengeRow {
  readonly id: string;
  readonly user_id: string;
  readonly purpose: MultiFactorChallengeRecord['purpose'];
  readonly authentication_method: MultiFactorChallengeRecord['authenticationMethod'];
  readonly client_type: NonNullable<MultiFactorChallengeRecord['clientType']> | null;
  readonly device_label: string | null;
  readonly session_id: string | null;
  readonly attempts: number;
  readonly maximum_attempts: number;
  readonly expires_at: Date;
  readonly consumed_at: Date | null;
}

interface FactorRow {
  readonly id: string;
  readonly user_id: string;
  readonly label: string;
  readonly encrypted_secret: Buffer;
  readonly secret_key_version: string;
  readonly enrollment_expires_at: Date | null;
  readonly last_used_step: string | number | null;
  readonly verified_at: Date | null;
  readonly revoked_at: Date | null;
}

function challengeFrom(row: ChallengeRow): MultiFactorChallengeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    purpose: row.purpose,
    authenticationMethod: row.authentication_method,
    ...(row.client_type === null ? {} : { clientType: row.client_type }),
    ...(row.device_label === null ? {} : { deviceLabel: row.device_label }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    attempts: row.attempts,
    maximumAttempts: row.maximum_attempts,
    expiresAt: row.expires_at,
    ...(row.consumed_at === null ? {} : { consumedAt: row.consumed_at }),
  };
}

function factorFrom(row: FactorRow): TotpFactorRecord {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    encryptedSecret: row.encrypted_secret,
    keyVersion: row.secret_key_version,
    ...(row.enrollment_expires_at === null
      ? {}
      : { enrollmentExpiresAt: row.enrollment_expires_at }),
    ...(row.last_used_step === null ? {} : { lastUsedStep: Number(row.last_used_step) }),
    ...(row.verified_at === null ? {} : { verifiedAt: row.verified_at }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  };
}

const CHALLENGE_COLUMNS = `id, user_id, purpose, authentication_method, client_type,
  device_label, session_id, attempts, maximum_attempts, expires_at, consumed_at`;

const FACTOR_COLUMNS = `id, user_id, label, encrypted_secret, secret_key_version,
  enrollment_expires_at, last_used_step, verified_at, revoked_at`;

@Injectable()
export class PostgresMultiFactorAuthenticationRepository implements MultiFactorAuthenticationRepository {
  async findAdministrativeIdentity(
    transaction: TransactionContext,
    normalizedIdentifier: string,
  ): Promise<AdministrativeIdentityRecord | undefined> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_identifier', normalizedIdentifier);
    const identities: { user_id: string; password_hash: string }[] = await manager.query(
      `SELECT user_id, password_hash
         FROM identity.auth_identities
        WHERE identity_type = 'ADMIN_PASSWORD' AND normalized_identifier = $1`,
      [normalizedIdentifier],
    );
    const identity = identities[0];
    if (identity === undefined) return undefined;
    await setTransactionClaim(manager, 'app.authentication_user_id', identity.user_id);
    const users: {
      token_version: number;
      status: AdministrativeIdentityRecord['status'];
    }[] = await manager.query('SELECT token_version, status FROM identity.users WHERE id = $1', [
      identity.user_id,
    ]);
    const user = users[0];
    if (user === undefined) return undefined;
    return {
      userId: identity.user_id,
      passwordHash: identity.password_hash,
      tokenVersion: user.token_version,
      status: user.status,
    };
  }

  async hasVerifiedTotpFactor(transaction: TransactionContext, userId: string): Promise<boolean> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', userId);
    const rows: { present: boolean }[] = await manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM identity.mfa_factors
          WHERE user_id = $1 AND factor_type = 'TOTP'
            AND verified_at IS NOT NULL AND revoked_at IS NULL
       ) AS present`,
      [userId],
    );
    return rows[0]?.present === true;
  }

  async findActiveUserTokenVersion(
    transaction: TransactionContext,
    userId: string,
  ): Promise<number | undefined> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', userId);
    const rows: { token_version: number }[] = await manager.query(
      `SELECT token_version FROM identity.users WHERE id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    return rows[0]?.token_version;
  }

  async createChallenge(
    transaction: TransactionContext,
    input: Parameters<MultiFactorAuthenticationRepository['createChallenge']>[1],
  ): Promise<void> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', input.userId);
    await setTransactionClaim(manager, 'app.authentication_challenge_id', input.id);
    await manager.query(
      `INSERT INTO identity.mfa_challenges (
         id, user_id, purpose, authentication_method, client_type, device_label,
         session_id, maximum_attempts, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.id,
        input.userId,
        input.purpose,
        input.authenticationMethod,
        input.clientType ?? null,
        input.deviceLabel ?? null,
        input.sessionId ?? null,
        input.maximumAttempts,
        input.expiresAt,
        input.now,
      ],
    );
  }

  async peekChallengeUser(
    transaction: TransactionContext,
    challengeId: string,
  ): Promise<string | undefined> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_challenge_id', challengeId);
    const rows: { user_id: string }[] = await manager.query(
      'SELECT user_id FROM identity.mfa_challenges WHERE id = $1',
      [challengeId],
    );
    return rows[0]?.user_id;
  }

  async findChallengeForUpdate(
    transaction: TransactionContext,
    challengeId: string,
  ): Promise<MultiFactorChallengeRecord | undefined> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_challenge_id', challengeId);
    const rows: ChallengeRow[] = await manager.query(
      `SELECT ${CHALLENGE_COLUMNS}
         FROM identity.mfa_challenges
        WHERE id = $1
        FOR UPDATE`,
      [challengeId],
    );
    const row = rows[0];
    return row === undefined ? undefined : challengeFrom(row);
  }

  async recordChallengeFailure(
    transaction: TransactionContext,
    challengeId: string,
  ): Promise<number> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_challenge_id', challengeId);
    const rows: { attempts: number }[] = await queryRows(
      manager,
      `UPDATE identity.mfa_challenges
          SET attempts = attempts + 1
        WHERE id = $1 AND consumed_at IS NULL
        RETURNING attempts`,
      [challengeId],
    );
    return rows[0]?.attempts ?? 0;
  }

  async consumeChallenge(
    transaction: TransactionContext,
    challengeId: string,
    now: Date,
  ): Promise<void> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_challenge_id', challengeId);
    await manager.query(
      `UPDATE identity.mfa_challenges SET consumed_at = $2
        WHERE id = $1 AND consumed_at IS NULL`,
      [challengeId, now],
    );
  }

  async listVerifiedTotpFactors(
    transaction: TransactionContext,
    userId: string,
  ): Promise<readonly TotpFactorRecord[]> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', userId);
    const rows: FactorRow[] = await manager.query(
      `SELECT ${FACTOR_COLUMNS}
         FROM identity.mfa_factors
        WHERE user_id = $1 AND factor_type = 'TOTP'
          AND verified_at IS NOT NULL AND revoked_at IS NULL
        ORDER BY created_at, id`,
      [userId],
    );
    return rows.map(factorFrom);
  }

  async consumeTotpStep(
    transaction: TransactionContext,
    factorId: string,
    step: number,
    now: Date,
  ): Promise<boolean> {
    const manager = entityManagerFor(transaction);
    const rows: { user_id: string }[] = await manager.query(
      'SELECT user_id FROM identity.mfa_factors WHERE id = $1',
      [factorId],
    );
    if (rows[0]?.user_id !== undefined) {
      await setTransactionClaim(manager, 'app.authentication_user_id', rows[0].user_id);
    }
    const updated: { id: string }[] = await queryRows(
      manager,
      `UPDATE identity.mfa_factors
          SET last_used_step = $2, updated_at = $3
        WHERE id = $1 AND factor_type = 'TOTP' AND verified_at IS NOT NULL
          AND revoked_at IS NULL AND (last_used_step IS NULL OR last_used_step < $2)
        RETURNING id`,
      [factorId, step, now],
    );
    return updated.length === 1;
  }

  async createPendingTotpFactor(
    transaction: TransactionContext,
    input: Parameters<MultiFactorAuthenticationRepository['createPendingTotpFactor']>[1],
  ): Promise<void> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', input.userId);
    await manager.query(
      `UPDATE identity.mfa_factors
          SET revoked_at = COALESCE(revoked_at, $2), updated_at = $2
        WHERE user_id = $1 AND factor_type = 'TOTP' AND verified_at IS NULL
          AND revoked_at IS NULL`,
      [input.userId, input.now],
    );
    await manager.query(
      `INSERT INTO identity.mfa_factors (
         id, user_id, factor_type, label, encrypted_secret, secret_key_version,
          enrollment_expires_at, created_at, updated_at
        ) VALUES ($1, $2, 'TOTP', $3, $4, $5, $6, $7, $7)`,
      [
        input.id,
        input.userId,
        input.label,
        Buffer.from(input.encryptedSecret),
        input.keyVersion,
        input.enrollmentExpiresAt,
        input.now,
      ],
    );
  }

  async findOwnedTotpFactorForUpdate(
    transaction: TransactionContext,
    userId: string,
    factorId: string,
  ): Promise<TotpFactorRecord | undefined> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', userId);
    const rows: FactorRow[] = await manager.query(
      `SELECT ${FACTOR_COLUMNS}
         FROM identity.mfa_factors
        WHERE id = $2 AND user_id = $1 AND factor_type = 'TOTP'
        FOR UPDATE`,
      [userId, factorId],
    );
    const row = rows[0];
    return row === undefined ? undefined : factorFrom(row);
  }

  async verifyTotpFactor(
    transaction: TransactionContext,
    userId: string,
    factorId: string,
    step: number,
    now: Date,
  ): Promise<boolean> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', userId);
    const rows: { id: string }[] = await queryRows(
      manager,
      `UPDATE identity.mfa_factors
          SET verified_at = $4, enrollment_expires_at = NULL,
              last_used_step = $3, updated_at = $4
        WHERE user_id = $1 AND id = $2 AND factor_type = 'TOTP'
          AND verified_at IS NULL AND revoked_at IS NULL AND enrollment_expires_at > $4
        RETURNING id`,
      [userId, factorId, step, now],
    );
    return rows.length === 1;
  }

  async upgradeSessionAssurance(
    transaction: TransactionContext,
    userId: string,
    sessionId: string,
    now: Date,
    assuranceExpiresAt: Date,
  ): Promise<readonly AuthenticationMethod[] | undefined> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', userId);
    await setTransactionClaim(manager, 'app.authentication_session_id', sessionId);
    const rows: { authentication_methods: AuthenticationMethod[] }[] = await queryRows(
      manager,
      `UPDATE identity.auth_sessions
           SET assurance = 'AAL2', assurance_expires_at = LEAST($4, absolute_expires_at),
               authentication_methods = CASE
                 WHEN array_position(authentication_methods, 'totp'::varchar) IS NULL
                   THEN array_append(authentication_methods, 'totp'::varchar)
                 ELSE authentication_methods END,
               session_version = session_version + 1, last_used_at = $3, updated_at = $3
        WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL
          AND risk_blocked_at IS NULL AND idle_expires_at > $3 AND absolute_expires_at > $3
         RETURNING authentication_methods`,
      [userId, sessionId, now, assuranceExpiresAt],
    );
    return rows[0]?.authentication_methods;
  }
}
