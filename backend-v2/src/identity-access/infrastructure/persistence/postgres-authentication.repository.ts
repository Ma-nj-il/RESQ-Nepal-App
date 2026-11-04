import { Injectable } from '@nestjs/common';

import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import { queryRows } from '../../../shared/infrastructure/persistence/query-rows.js';
import { entityManagerFor } from '../../../shared/infrastructure/persistence/typeorm-unit-of-work.js';
import { setTransactionClaim } from '../../../shared/infrastructure/persistence/transaction-claims.js';
import type {
  AuthenticationRepository,
  OtpChallengeRecord,
  OwnedSessionRecord,
  PhoneUserRecord,
  RefreshTokenRecord,
} from '../../application/ports/authentication-repository.js';
import type { SessionAuthorizationState } from '../../domain/authorization.js';
import { maskPhoneNumber } from '../../domain/phone-number.js';

interface OtpRow {
  readonly id: string;
  readonly normalized_phone: string;
  readonly purpose: OtpChallengeRecord['purpose'];
  readonly code_digest: Buffer;
  readonly attempts: number;
  readonly maximum_attempts: number;
  readonly expires_at: Date;
  readonly consumed_at: Date | null;
}

@Injectable()
export class PostgresAuthenticationRepository implements AuthenticationRepository {
  async createOtpChallenge(
    transaction: TransactionContext,
    input: Parameters<AuthenticationRepository['createOtpChallenge']>[1],
  ): Promise<void> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_challenge_id', input.id);
    await manager.query(
      `INSERT INTO identity.otp_challenges (
        id, normalized_phone, purpose, code_digest, maximum_attempts, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.id,
        input.normalizedPhone,
        input.purpose,
        Buffer.from(input.codeDigest),
        input.maximumAttempts,
        input.expiresAt,
        input.createdAt,
      ],
    );
  }

  async findOtpChallengeForUpdate(
    transaction: TransactionContext,
    challengeId: string,
  ): Promise<OtpChallengeRecord | undefined> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_challenge_id', challengeId);
    const rows: OtpRow[] = await manager.query(
      `SELECT id, normalized_phone, purpose, code_digest, attempts, maximum_attempts,
              expires_at, consumed_at
         FROM identity.otp_challenges
        WHERE id = $1
        FOR UPDATE`,
      [challengeId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      normalizedPhone: row.normalized_phone,
      purpose: row.purpose,
      codeDigest: row.code_digest,
      attempts: row.attempts,
      maximumAttempts: row.maximum_attempts,
      expiresAt: row.expires_at,
      ...(row.consumed_at === null ? {} : { consumedAt: row.consumed_at }),
    };
  }

  async recordOtpFailure(
    transaction: TransactionContext,
    challengeId: string,
    now: Date,
  ): Promise<number> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_challenge_id', challengeId);
    const rows: { attempts: number }[] = await queryRows(
      manager,
      `UPDATE identity.otp_challenges
          SET attempts = attempts + 1, last_attempt_at = $2
        WHERE id = $1
        RETURNING attempts`,
      [challengeId, now],
    );
    return rows[0]?.attempts ?? 0;
  }

  async consumeOtpChallenge(
    transaction: TransactionContext,
    challengeId: string,
    now: Date,
  ): Promise<void> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_challenge_id', challengeId);
    await manager.query(
      `UPDATE identity.otp_challenges
          SET consumed_at = $2, last_attempt_at = $2
        WHERE id = $1 AND consumed_at IS NULL`,
      [challengeId, now],
    );
  }

  async findOrCreatePhoneUser(
    transaction: TransactionContext,
    normalizedPhone: string,
    userId: string,
    identityId: string,
    profileId: string,
    now: Date,
  ): Promise<PhoneUserRecord> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_identifier', normalizedPhone);
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `phone:${normalizedPhone}`,
    ]);
    const identities: { user_id: string }[] = await manager.query(
      `SELECT ai.user_id
         FROM identity.auth_identities ai
        WHERE ai.identity_type = 'PHONE' AND ai.normalized_identifier = $1`,
      [normalizedPhone],
    );
    const existingUserId = identities[0]?.user_id;
    if (existingUserId !== undefined) {
      await setTransactionClaim(manager, 'app.authentication_user_id', existingUserId);
      const existing: {
        token_version: number;
        status: PhoneUserRecord['status'];
      }[] = await manager.query('SELECT token_version, status FROM identity.users WHERE id = $1', [
        existingUserId,
      ]);
      const user = existing[0];
      if (user === undefined) throw new Error('Authentication identity has no user');
      return {
        userId: existingUserId,
        tokenVersion: user.token_version,
        status: user.status,
        created: false,
      };
    }
    await setTransactionClaim(manager, 'app.authentication_user_id', userId);
    await manager.query(
      `INSERT INTO identity.users (id, status, token_version, created_at, updated_at)
       VALUES ($1, 'ACTIVE', 1, $2, $2)`,
      [userId, now],
    );
    await manager.query(
      `INSERT INTO identity.user_profiles (
        id, user_id, normalized_phone, phone_masked, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $5)`,
      [profileId, userId, normalizedPhone, maskPhoneNumber(normalizedPhone), now],
    );
    await manager.query(
      `INSERT INTO identity.auth_identities (
        id, user_id, identity_type, normalized_identifier, verified_at, created_at, updated_at
      ) VALUES ($1, $2, 'PHONE', $3, $4, $4, $4)`,
      [identityId, userId, normalizedPhone, now],
    );
    return { userId, tokenVersion: 1, status: 'ACTIVE', created: true };
  }

  async createSessionAndRefreshToken(
    transaction: TransactionContext,
    input: Parameters<AuthenticationRepository['createSessionAndRefreshToken']>[1],
  ): Promise<void> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', input.userId);
    await setTransactionClaim(manager, 'app.authentication_session_id', input.sessionId);
    await setTransactionClaim(manager, 'app.authentication_family_id', input.familyId);
    await manager.query(
      `INSERT INTO identity.auth_sessions (
        id, user_id, client_type, device_label, assurance, assurance_expires_at,
        authentication_methods, idle_expires_at, absolute_expires_at, last_used_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::varchar[], $8, $9, $10, $10, $10)`,
      [
        input.sessionId,
        input.userId,
        input.clientType,
        input.deviceLabel ?? null,
        input.assurance,
        input.assuranceExpiresAt ?? null,
        input.authenticationMethods,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
        input.now,
      ],
    );
    await manager.query(
      `INSERT INTO identity.refresh_tokens (
        id, session_id, family_id, token_digest, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.refreshTokenId,
        input.sessionId,
        input.familyId,
        Buffer.from(input.refreshTokenDigest),
        input.refreshTokenExpiresAt,
        input.now,
      ],
    );
  }

  async findRefreshTokenForUpdate(
    transaction: TransactionContext,
    digest: Uint8Array,
  ): Promise<RefreshTokenRecord | undefined> {
    const manager = entityManagerFor(transaction);
    const digestHex = Buffer.from(digest).toString('hex');
    await setTransactionClaim(manager, 'app.refresh_token_digest', digestHex);
    const tokens: {
      id: string;
      session_id: string;
      family_id: string;
      expires_at: Date;
      consumed_at: Date | null;
      revoked_at: Date | null;
    }[] = await manager.query(
      `SELECT id, session_id, family_id, expires_at, consumed_at, revoked_at
         FROM identity.refresh_tokens
        WHERE token_digest = $1
        FOR UPDATE`,
      [Buffer.from(digest)],
    );
    const token = tokens[0];
    if (token === undefined) return undefined;
    await setTransactionClaim(manager, 'app.authentication_session_id', token.session_id);
    await setTransactionClaim(manager, 'app.authentication_family_id', token.family_id);
    const sessions: {
      user_id: string;
      assurance: RefreshTokenRecord['assurance'];
      authentication_methods: RefreshTokenRecord['authenticationMethods'];
      assurance_expires_at: Date | null;
      client_type: RefreshTokenRecord['clientType'];
      idle_expires_at: Date;
      absolute_expires_at: Date;
      revoked_at: Date | null;
    }[] = await manager.query(
      `SELECT user_id, assurance, assurance_expires_at, authentication_methods, client_type, idle_expires_at,
              absolute_expires_at, revoked_at
         FROM identity.auth_sessions
        WHERE id = $1
        FOR UPDATE`,
      [token.session_id],
    );
    const session = sessions[0];
    if (session === undefined) return undefined;
    await setTransactionClaim(manager, 'app.authentication_user_id', session.user_id);
    const users: { token_version: number }[] = await manager.query(
      'SELECT token_version FROM identity.users WHERE id = $1',
      [session.user_id],
    );
    const user = users[0];
    if (user === undefined) return undefined;
    return {
      id: token.id,
      sessionId: token.session_id,
      familyId: token.family_id,
      userId: session.user_id,
      tokenVersion: user.token_version,
      assurance: session.assurance,
      authenticationMethods: session.authentication_methods,
      ...(session.assurance_expires_at === null
        ? {}
        : { assuranceExpiresAt: session.assurance_expires_at }),
      clientType: session.client_type,
      expiresAt: token.expires_at,
      sessionIdleExpiresAt: session.idle_expires_at,
      sessionAbsoluteExpiresAt: session.absolute_expires_at,
      ...(token.consumed_at === null ? {} : { consumedAt: token.consumed_at }),
      ...(token.revoked_at === null ? {} : { revokedAt: token.revoked_at }),
      ...(session.revoked_at === null ? {} : { sessionRevokedAt: session.revoked_at }),
    };
  }

  async rotateRefreshToken(
    transaction: TransactionContext,
    input: Parameters<AuthenticationRepository['rotateRefreshToken']>[1],
  ): Promise<void> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_session_id', input.sessionId);
    await setTransactionClaim(manager, 'app.authentication_family_id', input.familyId);
    await manager.query(
      `INSERT INTO identity.refresh_tokens (
        id, session_id, family_id, predecessor_id, token_digest, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.successorTokenId,
        input.sessionId,
        input.familyId,
        input.consumedTokenId,
        Buffer.from(input.successorDigest),
        input.successorExpiresAt,
        input.now,
      ],
    );
    const updated: { id: string }[] = await queryRows(
      manager,
      `UPDATE identity.refresh_tokens
          SET consumed_at = $2, successor_id = $3
        WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
        RETURNING id`,
      [input.consumedTokenId, input.now, input.successorTokenId],
    );
    if (updated.length !== 1) throw new Error('Refresh token rotation lost its row lock');
    await manager.query(
      `UPDATE identity.auth_sessions
          SET idle_expires_at = $2, assurance = $4, assurance_expires_at = $5,
              authentication_methods = $6::varchar[],
              last_used_at = $3, updated_at = $3
        WHERE id = $1`,
      [
        input.sessionId,
        input.idleExpiresAt,
        input.now,
        input.assurance,
        input.assuranceExpiresAt ?? null,
        input.authenticationMethods,
      ],
    );
  }

  async revokeRefreshFamily(
    transaction: TransactionContext,
    familyId: string,
    now: Date,
    reason: string,
  ): Promise<void> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_family_id', familyId);
    const sessions: { session_id: string }[] = await manager.query(
      `SELECT DISTINCT session_id FROM identity.refresh_tokens WHERE family_id = $1`,
      [familyId],
    );
    const sessionId = sessions[0]?.session_id;
    if (sessionId !== undefined) {
      await setTransactionClaim(manager, 'app.authentication_session_id', sessionId);
    }
    await manager.query(
      `UPDATE identity.refresh_tokens
          SET revoked_at = COALESCE(revoked_at, $2),
              revocation_reason = COALESCE(revocation_reason, $3)
        WHERE family_id = $1`,
      [familyId, now, reason],
    );
    await manager.query(
      `UPDATE identity.auth_sessions s
          SET revoked_at = COALESCE(s.revoked_at, $2),
              revocation_reason = COALESCE(s.revocation_reason, $3),
              session_version = s.session_version + 1,
              updated_at = $2
        WHERE EXISTS (
          SELECT 1 FROM identity.refresh_tokens rt
           WHERE rt.session_id = s.id AND rt.family_id = $1
        )`,
      [familyId, now, reason],
    );
  }

  async revokeSession(
    transaction: TransactionContext,
    userId: string,
    sessionId: string,
    now: Date,
    reason: string,
  ): Promise<boolean> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', userId);
    await setTransactionClaim(manager, 'app.authentication_session_id', sessionId);
    const rows: { id: string }[] = await queryRows(
      manager,
      `UPDATE identity.auth_sessions
          SET revoked_at = COALESCE(revoked_at, $3),
              revocation_reason = COALESCE(revocation_reason, $4),
              session_version = session_version + CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END,
              updated_at = $3
        WHERE id = $2 AND user_id = $1
        RETURNING id`,
      [userId, sessionId, now, reason],
    );
    if (rows.length === 0) return false;
    await manager.query(
      `UPDATE identity.refresh_tokens
          SET revoked_at = COALESCE(revoked_at, $2),
              revocation_reason = COALESCE(revocation_reason, $3)
        WHERE session_id = $1`,
      [sessionId, now, reason],
    );
    return true;
  }

  async revokeOtherSessions(
    transaction: TransactionContext,
    userId: string,
    currentSessionId: string,
    includeCurrent: boolean,
    now: Date,
    reason: string,
  ): Promise<number> {
    const manager = entityManagerFor(transaction);
    await setTransactionClaim(manager, 'app.authentication_user_id', userId);
    const rows: { id: string }[] = await queryRows(
      manager,
      `UPDATE identity.auth_sessions
          SET revoked_at = $4, revocation_reason = $5,
              session_version = session_version + 1, updated_at = $4
        WHERE user_id = $1 AND revoked_at IS NULL AND ($3 OR id <> $2)
        RETURNING id`,
      [userId, currentSessionId, includeCurrent, now, reason],
    );
    if (rows.length > 0) {
      await manager.query(
        `UPDATE identity.refresh_tokens
            SET revoked_at = COALESCE(revoked_at, $2),
                revocation_reason = COALESCE(revocation_reason, $3)
          WHERE session_id = ANY($1::uuid[])`,
        [rows.map((row) => row.id), now, reason],
      );
    }
    if (includeCurrent) {
      await manager.query(
        `UPDATE identity.users
            SET token_version = token_version + 1, updated_at = $2
          WHERE id = $1`,
        [userId, now],
      );
    }
    return rows.length;
  }

  async findSessionAuthorizationState(
    transaction: TransactionContext,
    userId: string,
    sessionId: string,
  ): Promise<SessionAuthorizationState | undefined> {
    const rows: {
      user_id: string;
      user_status: SessionAuthorizationState['userStatus'];
      token_version: number;
      session_id: string;
      session_version: number;
      assurance: SessionAuthorizationState['assurance'];
      assurance_expires_at: Date | null;
      idle_expires_at: Date;
      absolute_expires_at: Date;
      revoked_at: Date | null;
      risk_blocked_at: Date | null;
    }[] = await entityManagerFor(transaction).query(
      `SELECT u.id AS user_id, u.status AS user_status, u.token_version,
               s.id AS session_id, s.session_version, s.assurance, s.assurance_expires_at,
              s.idle_expires_at, s.absolute_expires_at, s.revoked_at, s.risk_blocked_at
         FROM identity.users u
         JOIN identity.auth_sessions s ON s.user_id = u.id
        WHERE u.id = $1 AND s.id = $2`,
      [userId, sessionId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      userId: row.user_id,
      userStatus: row.user_status,
      userTokenVersion: row.token_version,
      sessionId: row.session_id,
      sessionVersion: row.session_version,
      assurance: row.assurance,
      ...(row.assurance_expires_at === null
        ? {}
        : { assuranceExpiresAt: row.assurance_expires_at }),
      idleExpiresAt: row.idle_expires_at,
      absoluteExpiresAt: row.absolute_expires_at,
      ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
      ...(row.risk_blocked_at === null ? {} : { riskBlockedAt: row.risk_blocked_at }),
    };
  }

  async listOwnedSessions(
    transaction: TransactionContext,
    userId: string,
    currentSessionId: string,
  ): Promise<readonly OwnedSessionRecord[]> {
    const rows: {
      id: string;
      client_type: OwnedSessionRecord['clientType'];
      device_label: string | null;
      assurance: OwnedSessionRecord['assurance'];
      assurance_expires_at: Date | null;
      idle_expires_at: Date;
      absolute_expires_at: Date;
      revoked_at: Date | null;
      last_used_at: Date;
      created_at: Date;
      token_version: number;
    }[] = await entityManagerFor(transaction).query(
      `SELECT s.id, s.client_type, s.device_label, s.assurance, s.assurance_expires_at,
               s.idle_expires_at,
              s.absolute_expires_at, s.revoked_at, s.last_used_at, s.created_at,
              u.token_version
         FROM identity.auth_sessions s
         JOIN identity.users u ON u.id = s.user_id
        WHERE s.user_id = $1
        ORDER BY s.last_used_at DESC, s.id DESC`,
      [userId],
    );
    return rows.map((row) => ({
      userId,
      sessionId: row.id,
      clientType: row.client_type,
      assurance: row.assurance,
      ...(row.assurance_expires_at === null
        ? {}
        : { assuranceExpiresAt: row.assurance_expires_at }),
      tokenVersion: row.token_version,
      absoluteExpiresAt: row.absolute_expires_at,
      idleExpiresAt: row.idle_expires_at,
      ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
      ...(row.device_label === null ? {} : { deviceLabel: row.device_label }),
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      current: row.id === currentSessionId,
    }));
  }
}
