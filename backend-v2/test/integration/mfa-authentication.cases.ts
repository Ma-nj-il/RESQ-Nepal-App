import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import argon2 from 'argon2';
import type { Client } from 'pg';
import { DataSource } from 'typeorm';

import { AuthenticationService } from '../../src/identity-access/application/authentication.service.js';
import { AuthorizationService } from '../../src/identity-access/application/authorization.service.js';
import { MultiFactorAuthenticationService } from '../../src/identity-access/application/multi-factor-authentication.service.js';
import type { AuthenticationPolicy } from '../../src/identity-access/application/ports/authentication-policy.js';
import { AesTotpCryptography } from '../../src/identity-access/infrastructure/crypto/aes-totp-cryptography.js';
import { Argon2PasswordVerifier } from '../../src/identity-access/infrastructure/crypto/argon2-password-verifier.js';
import { EdDsaAccessTokenService } from '../../src/identity-access/infrastructure/crypto/eddsa-access-token.service.js';
import { HmacAuthenticationCryptography } from '../../src/identity-access/infrastructure/crypto/hmac-authentication-cryptography.js';
import { PostgresAuthenticationRepository } from '../../src/identity-access/infrastructure/persistence/postgres-authentication.repository.js';
import { PostgresAuthorizationRepository } from '../../src/identity-access/infrastructure/persistence/postgres-authorization.repository.js';
import { PostgresMultiFactorAuthenticationRepository } from '../../src/identity-access/infrastructure/persistence/postgres-multi-factor-authentication.repository.js';
import type { AuditWriter } from '../../src/shared/application/audit/audit-writer.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import { PostgresAuditWriter } from '../../src/shared/infrastructure/audit/postgres-audit-writer.js';
import {
  loadApplicationConfig,
  type ApplicationConfig,
} from '../../src/shared/infrastructure/config/application-config.js';
import type { DatabaseService } from '../../src/shared/infrastructure/persistence/database.service.js';
import { applicationDataSourceOptions } from '../../src/shared/infrastructure/persistence/data-source-options.js';
import { TypeOrmUnitOfWork } from '../../src/shared/infrastructure/persistence/typeorm-unit-of-work.js';

const PASSWORD = '  synthetic integration password  ';
const policy: AuthenticationPolicy = {
  otpLifetimeSeconds: 300,
  otpMaximumAttempts: 5,
  mfaChallengeLifetimeSeconds: 300,
  mfaEnrollmentLifetimeSeconds: 600,
  mfaMaximumAttempts: 5,
  aal2LifetimeSeconds: 120,
  refreshTokenTtlSeconds: 3600,
  sessionIdleTtlSeconds: 1800,
  sessionAbsoluteTtlSeconds: 7200,
};

interface SessionFixture {
  context: RequestContext;
  raw: string;
  sessionId: string;
}
interface MfaRuntime {
  mfa: MultiFactorAuthenticationService;
  authentication: AuthenticationService;
  authorization: AuthorizationService;
  repository: PostgresMultiFactorAuthenticationRepository;
  authenticationRepository: PostgresAuthenticationRepository;
  unit: TypeOrmUnitOfWork;
  cryptography: HmacAuthenticationCryptography;
  tokens: EdDsaAccessTokenService;
  userId: string;
  identifier: string;
  session(owner?: string): Promise<SessionFixture>;
  enroll(): Promise<
    Awaited<ReturnType<MultiFactorAuthenticationService['createTotpEnrollment']>> & {
      initial: SessionFixture;
    }
  >;
  challenge(): ReturnType<MultiFactorAuthenticationService['createPasswordChallenge']>;
  sessions(): Promise<{ id: string }[]>;
  challengeRow(
    id: string,
  ): ReturnType<PostgresMultiFactorAuthenticationRepository['findChallengeForUpdate']>;
  clock: { now(): Date };
  advance(ms: number): void;
}

// Independent authenticator: decode the public provisioning secret, then RFC 4226/6238.
function authenticatorCode(secret: string, now: Date): string {
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('Invalid fixture provisioning secret');
  const bits = Array.from(secret)
    .map((value) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(value).toString(2).padStart(5, '0'))
    .join('');
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((value) => Number.parseInt(value, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 30000)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = digest.readUInt8(digest.length - 1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

function context(userId?: string, sessionId?: string): RequestContext {
  return new RequestContext({
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source: 'HTTP',
    ...(userId === undefined ? {} : { actor: { type: 'USER', id: userId } }),
    ...(sessionId === undefined
      ? {}
      : { sessionId, authentication: { assurance: 'AAL1', tokenVersion: 1 } }),
  });
}

/** Real application services, crypto, transaction-bound audits and non-owner PostgreSQL persistence. */
export function mfaAuthenticationCases(harness: {
  config(): ApplicationConfig;
  owner(): Client;
  createUser(): Promise<string>;
}): void {
  describe('password, enrollment and TOTP service integration', () => {
    let passwordHash: string;
    beforeAll(async () => {
      passwordHash = await argon2.hash(PASSWORD, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    });

    async function persistence(
      work: (runtime: MfaRuntime) => Promise<void>,
      audit?: AuditWriter,
    ): Promise<void> {
      const source = new DataSource(applicationDataSourceOptions(harness.config()));
      await source.initialize();
      try {
        expect(
          await source.query(
            'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
          ),
        ).toEqual([{ rolsuper: false, rolbypassrls: false }]);
        await work(await runtimeFor(source, audit));
      } finally {
        await source.destroy();
      }
    }

    async function runtimeFor(
      source: DataSource,
      audit: AuditWriter = new PostgresAuditWriter(),
    ): Promise<MfaRuntime> {
      // Generate fixture-only keys; never inherit signing/encryption keys from the test environment.
      const config = loadApplicationConfig(
        {
          NODE_ENV: 'test',
          RESQ_AUTH_MFA_ENCRYPTION_KEY_BASE64: randomBytes(32).toString('base64'),
        },
        'api',
      );
      const repository = new PostgresMultiFactorAuthenticationRepository();
      const authenticationRepository = new PostgresAuthenticationRepository();
      const unit = new TypeOrmUnitOfWork(
        { getDataSource: () => Promise.resolve(source) } as unknown as DatabaseService,
        { generate: randomUUID },
      );
      const cryptography = new HmacAuthenticationCryptography(config),
        tokens = new EdDsaAccessTokenService(config);
      let now = new Date(Math.ceil(Date.now() / 30000) * 30000);
      const clock = { now: () => new Date(now) },
        ids = { generate: randomUUID };
      const mfa = new MultiFactorAuthenticationService(
        repository,
        authenticationRepository,
        new Argon2PasswordVerifier(),
        new AesTotpCryptography(config),
        cryptography,
        tokens,
        policy,
        unit,
        audit,
        clock,
        ids,
      );
      const authentication = new AuthenticationService(
        authenticationRepository,
        cryptography,
        tokens,
        policy,
        {
          send: () => {
            throw new Error('OTP delivery is outside this fixture');
          },
        },
        unit,
        audit,
        clock,
        ids,
      );
      const authorization = new AuthorizationService(
        authenticationRepository,
        new PostgresAuthorizationRepository(),
        tokens,
        unit,
        clock,
      );
      const userId = await harness.createUser(),
        identifier = `${userId}@example.test`;
      await harness.owner().query(
        `INSERT INTO identity.auth_identities
        (id,user_id,identity_type,normalized_identifier,verified_at,password_hash,password_changed_at,created_at,updated_at)
        VALUES ($1,$2,'ADMIN_PASSWORD',$3,now(),$4,now(),now(),now())`,
        [randomUUID(), userId, identifier, passwordHash],
      );

      async function session(owner = userId): Promise<SessionFixture> {
        const sessionId = randomUUID(),
          raw = cryptography.generateRefreshToken();
        await unit.execute(context(owner), (tx) =>
          authenticationRepository.createSessionAndRefreshToken(tx, {
            sessionId,
            userId: owner,
            familyId: randomUUID(),
            refreshTokenId: randomUUID(),
            refreshTokenDigest: cryptography.digestRefreshToken(raw),
            clientType: 'MOBILE',
            assurance: 'AAL1',
            authenticationMethods: ['otp'],
            refreshTokenExpiresAt: new Date(now.getTime() + 3600000),
            idleExpiresAt: new Date(now.getTime() + 1800000),
            absoluteExpiresAt: new Date(now.getTime() + 7200000),
            now,
          }),
        );
        return { context: context(owner, sessionId), raw, sessionId };
      }
      async function enroll(): ReturnType<MfaRuntime['enroll']> {
        const initial = await session();
        const enrollment = await mfa.createTotpEnrollment(
          initial.context,
          'Synthetic authenticator',
        );
        expect(new URL(enrollment.provisioningUri).searchParams.get('secret')).toBe(
          enrollment.sharedSecret,
        );
        await mfa.verifyTotpEnrollment(
          initial.context,
          enrollment.factorId,
          authenticatorCode(enrollment.sharedSecret, now),
        );
        now = new Date(now.getTime() + 60000);
        return { ...enrollment, initial };
      }
      const challenge = (): ReturnType<MfaRuntime['challenge']> =>
        mfa.createPasswordChallenge(context(), {
          identifier: ` ${identifier.toUpperCase()} `,
          password: PASSWORD,
          clientType: 'MOBILE',
        });
      const sessions = async (): ReturnType<MfaRuntime['sessions']> =>
        (
          await harness
            .owner()
            .query<{ id: string }>(
              'SELECT id FROM identity.auth_sessions WHERE user_id = $1 ORDER BY id',
              [userId],
            )
        ).rows;
      const challengeRow = async (id: string): ReturnType<MfaRuntime['challengeRow']> =>
        unit.execute(context(userId), (tx) => repository.findChallengeForUpdate(tx, id));
      return {
        mfa,
        authentication,
        authorization,
        repository,
        authenticationRepository,
        unit,
        cryptography,
        tokens,
        userId,
        identifier,
        session,
        enroll,
        challenge,
        sessions,
        challengeRow,
        clock,
        advance: (ms: number) => {
          now = new Date(now.getTime() + ms);
        },
      };
    }

    it('requires the password and a one-time authenticator before issuing live AAL2 credentials', async () => {
      await persistence(async (f) => {
        const enrollment = await f.enroll(),
          before = await f.sessions();
        const challenge = await f.challenge();
        expect(await f.sessions()).toEqual(before);
        expect(await f.challengeRow(challenge.challengeId)).toMatchObject({
          purpose: 'LOGIN',
          authenticationMethod: 'PASSWORD',
          clientType: 'MOBILE',
          attempts: 0,
        });
        const code = authenticatorCode(enrollment.sharedSecret, f.clock.now());
        const result = await f.mfa.verifyChallenge(context(), challenge.challengeId, code);
        if (result.kind !== 'SESSION') throw new Error('Expected password session');
        expect(result).toMatchObject({
          userId: f.userId,
          clientType: 'MOBILE',
          tokens: { assurance: 'AAL2' },
        });
        expect(f.tokens.verify(result.tokens.accessToken, f.clock.now())).toMatchObject({
          subject: f.userId,
          sessionId: result.tokens.sessionId,
          tokenVersion: 1,
          assurance: 'AAL2',
          authenticationMethods: ['password', 'totp'],
        });
        expect(
          await f.authorization.authorize(
            context(),
            result.tokens.accessToken,
            {},
            { context: 'SELF', minimumAssurance: 'AAL2' },
          ),
        ).toMatchObject({ actor: { id: f.userId }, sessionId: result.tokens.sessionId });
        await expect(
          f.mfa.verifyChallenge(context(), challenge.challengeId, code),
        ).rejects.toMatchObject({ code: 'AUTH.MFA_INVALID' });
        expect(await f.sessions()).toHaveLength(before.length + 1);
        const refresh = await f.unit.execute(context(), (tx) =>
          f.authenticationRepository.findRefreshTokenForUpdate(
            tx,
            f.cryptography.digestRefreshToken(result.tokens.refreshToken),
          ),
        );
        expect(refresh).toMatchObject({ sessionId: result.tokens.sessionId, assurance: 'AAL2' });
        const persisted = await harness
          .owner()
          .query<{ encrypted_secret: Buffer }>(
            'SELECT encrypted_secret FROM identity.mfa_factors WHERE id = $1',
            [enrollment.factorId],
          );
        expect(Buffer.isBuffer(persisted.rows[0]?.encrypted_secret)).toBe(true);
        expect(persisted.rows[0]?.encrypted_secret.toString('utf8')).not.toContain(
          enrollment.sharedSecret,
        );
        const audits = await harness
          .owner()
          .query('SELECT * FROM governance.audit_events WHERE actor_id = $1', [f.userId]);
        expect(audits.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: 'authentication.session.create',
              reason_code: 'AUTH.ADMIN_LOGIN_SUCCEEDED',
              resource_id: result.tokens.sessionId,
            }),
          ]),
        );
        for (const secret of [
          PASSWORD,
          enrollment.sharedSecret,
          result.tokens.accessToken,
          result.tokens.refreshToken,
        ])
          expect(JSON.stringify(audits.rows)).not.toContain(secret);
      });
    });

    it('rejects unknown, incorrect and inactive credentials uniformly and requires verified enrollment', async () => {
      await persistence(async (f) => {
        for (const input of [
          { identifier: `unknown-${randomUUID()}@example.test`, password: PASSWORD },
          { identifier: f.identifier, password: PASSWORD.trim() },
        ]) {
          const request = context();
          await expect(
            f.mfa.createPasswordChallenge(request, { ...input, clientType: 'MOBILE' }),
          ).rejects.toMatchObject({ code: 'AUTH.CREDENTIALS_INVALID', status: 401 });
          expect(
            (
              await harness
                .owner()
                .query(
                  'SELECT outcome, reason_code, safe_context FROM governance.audit_events WHERE correlation_id = $1',
                  [request.correlationId],
                )
            ).rows,
          ).toEqual([
            { outcome: 'DENIED', reason_code: 'AUTH.CREDENTIALS_INVALID', safe_context: {} },
          ]);
        }
        await expect(f.challenge()).rejects.toMatchObject({ code: 'AUTH.MFA_ENROLLMENT_REQUIRED' });
        await harness
          .owner()
          .query("UPDATE identity.users SET status = 'SUSPENDED' WHERE id = $1", [f.userId]);
        await expect(f.challenge()).rejects.toMatchObject({
          code: 'AUTH.CREDENTIALS_INVALID',
          status: 401,
        });
        expect(await f.sessions()).toHaveLength(0);
        expect(
          (
            await harness
              .owner()
              .query('SELECT id FROM identity.mfa_challenges WHERE user_id = $1', [f.userId])
          ).rows,
        ).toHaveLength(0);
      });
    });

    it('commits attempt exhaustion and expiry without creating sessions or consuming valid factor steps', async () => {
      await persistence(async (f) => {
        const enrollment = await f.enroll(),
          before = await f.sessions(),
          challenge = await f.challenge();
        const validCodes = [-30000, 0, 30000].map((delta) =>
          authenticatorCode(enrollment.sharedSecret, new Date(f.clock.now().getTime() + delta)),
        );
        const wrong = Array.from({ length: 4 }, (_, i) => String(i).padStart(6, '0')).find(
          (code) => !validCodes.includes(code),
        );
        if (wrong === undefined) throw new Error('No invalid fixture code available');
        for (let attempt = 1; attempt <= policy.mfaMaximumAttempts; attempt++) {
          await expect(
            f.mfa.verifyChallenge(context(), challenge.challengeId, wrong),
          ).rejects.toMatchObject({
            code:
              attempt === policy.mfaMaximumAttempts
                ? 'AUTH.MFA_ATTEMPTS_EXCEEDED'
                : 'AUTH.MFA_INVALID',
          });
          expect((await f.challengeRow(challenge.challengeId))?.attempts).toBe(attempt);
        }
        await expect(
          f.mfa.verifyChallenge(
            context(),
            challenge.challengeId,
            authenticatorCode(enrollment.sharedSecret, f.clock.now()),
          ),
        ).rejects.toMatchObject({ code: 'AUTH.MFA_INVALID' });
        expect((await f.challengeRow(challenge.challengeId))?.attempts).toBe(
          policy.mfaMaximumAttempts,
        );
        const expired = await f.challenge();
        f.advance(policy.mfaChallengeLifetimeSeconds * 1000);
        await expect(
          f.mfa.verifyChallenge(
            context(),
            expired.challengeId,
            authenticatorCode(enrollment.sharedSecret, f.clock.now()),
          ),
        ).rejects.toMatchObject({ code: 'AUTH.MFA_INVALID' });
        expect(await f.challengeRow(expired.challengeId)).toMatchObject({ attempts: 0 });
        expect((await f.challengeRow(expired.challengeId))?.consumedAt).toBeUndefined();
        expect(await f.sessions()).toEqual(before);
        const fresh = await f.challenge();
        expect(
          await f.mfa.verifyChallenge(
            context(),
            fresh.challengeId,
            authenticatorCode(enrollment.sharedSecret, f.clock.now()),
          ),
        ).toMatchObject({ kind: 'SESSION' });
      });
    });

    it('serializes duplicate challenges and cross-challenge factor replay across application transactions', async () => {
      await persistence(async (f) => {
        const enrollment = await f.enroll();
        for (const distinct of [false, true]) {
          const before = await f.sessions(),
            first = await f.challenge(),
            second = distinct ? await f.challenge() : first;
          const code = authenticatorCode(enrollment.sharedSecret, f.clock.now());
          const results = await Promise.allSettled(
            [first, second].map((value) =>
              f.mfa.verifyChallenge(context(), value.challengeId, code),
            ),
          );
          expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
          const failed = results.filter((value) => value.status === 'rejected');
          expect(failed).toHaveLength(1);
          expect(failed[0]?.reason).toMatchObject({ code: 'AUTH.MFA_INVALID' });
          expect(await f.sessions()).toHaveLength(before.length + 1);
          f.advance(60000);
        }
      });
    });

    it('rolls back factor, challenge, credentials and audit together when session audit publication fails', async () => {
      const writer = new PostgresAuditWriter();
      let fail = true;
      await persistence(
        async (f) => {
          const enrollment = await f.enroll(),
            challenge = await f.challenge(),
            before = await f.sessions();
          const code = authenticatorCode(enrollment.sharedSecret, f.clock.now());
          await expect(
            f.mfa.verifyChallenge(context(), challenge.challengeId, code),
          ).rejects.toThrow('Synthetic audit failure');
          expect(await f.sessions()).toEqual(before);
          expect((await f.challengeRow(challenge.challengeId))?.consumedAt).toBeUndefined();
          expect(
            (
              await harness
                .owner()
                .query(
                  "SELECT id FROM governance.audit_events WHERE actor_id = $1 AND reason_code = 'AUTH.ADMIN_LOGIN_SUCCEEDED'",
                  [f.userId],
                )
            ).rows,
          ).toHaveLength(0);
          fail = false;
          expect(await f.mfa.verifyChallenge(context(), challenge.challengeId, code)).toMatchObject(
            { kind: 'SESSION' },
          );
          expect(await f.sessions()).toHaveLength(before.length + 1);
        },
        {
          append: async (tx, input) => {
            await writer.append(tx, input);
            if (fail && input.reasonCode === 'AUTH.ADMIN_LOGIN_SUCCEEDED')
              throw new Error('Synthetic audit failure');
          },
        },
      );
    });

    it('binds step-up to the exact user/session and upgrades access without replacing refresh credentials', async () => {
      await persistence(async (f) => {
        const enrollment = await f.enroll(),
          current = await f.session(),
          other = await f.session();
        const challenge = await f.mfa.createStepUpChallenge(current.context),
          code = authenticatorCode(enrollment.sharedSecret, f.clock.now());
        for (const request of [
          context(),
          other.context,
          context(await harness.createUser(), current.sessionId),
        ]) {
          await expect(
            f.mfa.verifyChallenge(request, challenge.challengeId, code),
          ).rejects.toMatchObject({ code: 'AUTH.MFA_INVALID' });
        }
        expect((await f.challengeRow(challenge.challengeId))?.attempts).toBe(0);
        const result = await f.mfa.verifyChallenge(current.context, challenge.challengeId, code);
        if (result.kind !== 'STEP_UP') throw new Error('Expected access-only step-up');
        expect(result).toMatchObject({
          userId: f.userId,
          sessionId: current.sessionId,
          assurance: 'AAL2',
        });
        expect(result).not.toHaveProperty('refreshToken');
        expect(
          await f.authorization.authorize(
            context(),
            result.accessToken,
            {},
            { context: 'SELF', minimumAssurance: 'AAL2' },
          ),
        ).toMatchObject({ sessionId: current.sessionId });
        const stored = await f.unit.execute(context(), (tx) =>
          f.authenticationRepository.findRefreshTokenForUpdate(
            tx,
            f.cryptography.digestRefreshToken(current.raw),
          ),
        );
        expect(stored).toMatchObject({ assurance: 'AAL2', sessionId: current.sessionId });
        expect(stored?.consumedAt).toBeUndefined();
        expect(
          (
            await harness
              .owner()
              .query('SELECT id FROM identity.refresh_tokens WHERE session_id = $1', [
                current.sessionId,
              ])
          ).rows,
        ).toHaveLength(1);
        expect(
          await f.unit.execute(other.context, (tx) =>
            f.authenticationRepository.findSessionAuthorizationState(tx, f.userId, other.sessionId),
          ),
        ).toMatchObject({ assurance: 'AAL1' });
      });
    });

    it('rejects suspension after password acceptance and revocation before step-up or enrollment completion', async () => {
      await persistence(async (f) => {
        const enrollment = await f.enroll(),
          challenge = await f.challenge(),
          before = await f.sessions();
        await harness
          .owner()
          .query("UPDATE identity.users SET status = 'SUSPENDED' WHERE id = $1", [f.userId]);
        await expect(
          f.mfa.verifyChallenge(
            context(),
            challenge.challengeId,
            authenticatorCode(enrollment.sharedSecret, f.clock.now()),
          ),
        ).rejects.toMatchObject({ code: 'AUTH.MFA_INVALID' });
        expect(await f.sessions()).toEqual(before);
        await harness
          .owner()
          .query("UPDATE identity.users SET status = 'ACTIVE' WHERE id = $1", [f.userId]);
        f.advance(60000);
        const current = await f.session(),
          stepUp = await f.mfa.createStepUpChallenge(current.context);
        await f.authentication.revokeCurrentSession(current.context);
        await expect(
          f.mfa.verifyChallenge(
            current.context,
            stepUp.challengeId,
            authenticatorCode(enrollment.sharedSecret, f.clock.now()),
          ),
        ).rejects.toMatchObject({ code: 'AUTH.MFA_INVALID' });
        const revoked = await f.unit.execute(current.context, (tx) =>
          f.authenticationRepository.findSessionAuthorizationState(tx, f.userId, current.sessionId),
        );
        expect(revoked?.assurance).toBe('AAL1');
        expect(revoked?.revokedAt).toBeInstanceOf(Date);
      });
      await persistence(async (f) => {
        const initial = await f.session(),
          enrollment = await f.mfa.createTotpEnrollment(initial.context, 'Pending');
        await f.authentication.revokeCurrentSession(initial.context);
        await expect(
          f.mfa.verifyTotpEnrollment(
            initial.context,
            enrollment.factorId,
            authenticatorCode(enrollment.sharedSecret, f.clock.now()),
          ),
        ).rejects.toMatchObject({ code: 'AUTH.MFA_INVALID' });
        expect(
          (
            await f.unit.execute(initial.context, (tx) =>
              f.repository.findOwnedTotpFactorForUpdate(tx, f.userId, enrollment.factorId),
            )
          )?.verifiedAt,
        ).toBeUndefined();
      });
    });

    it('rotates password-login refresh credentials, expires AAL2 and invalidates the family on predecessor reuse', async () => {
      await persistence(async (f) => {
        const enrollment = await f.enroll(),
          challenge = await f.challenge();
        const login = await f.mfa.verifyChallenge(
          context(),
          challenge.challengeId,
          authenticatorCode(enrollment.sharedSecret, f.clock.now()),
        );
        if (login.kind !== 'SESSION') throw new Error('Expected password session');
        const rotated = await f.authentication.refresh(context(), login.tokens.refreshToken);
        expect(rotated.tokens).toMatchObject({
          sessionId: login.tokens.sessionId,
          assurance: 'AAL2',
        });
        expect(rotated.tokens.refreshToken).not.toBe(login.tokens.refreshToken);
        expect(
          f.tokens.verify(rotated.tokens.accessToken, f.clock.now()).authenticationMethods,
        ).toEqual(['password', 'totp']);
        f.advance(policy.aal2LifetimeSeconds * 1000);
        await expect(
          f.authorization.authorize(context(), rotated.tokens.accessToken, {}, { context: 'SELF' }),
        ).rejects.toMatchObject({ code: 'AUTH.ACCESS_TOKEN_STALE' });
        const downgraded = await f.authentication.refresh(context(), rotated.tokens.refreshToken);
        expect(downgraded.tokens.assurance).toBe('AAL1');
        expect(
          f.tokens.verify(downgraded.tokens.accessToken, f.clock.now()).authenticationMethods,
        ).toEqual(['password']);
        await expect(
          f.authorization.authorize(
            context(),
            downgraded.tokens.accessToken,
            {},
            { context: 'SELF', minimumAssurance: 'AAL2' },
          ),
        ).rejects.toMatchObject({ code: 'ACCESS.STEP_UP_REQUIRED' });
        await expect(
          f.authentication.refresh(context(), login.tokens.refreshToken),
        ).rejects.toMatchObject({ code: 'AUTH.REFRESH_TOKEN_REUSED' });
        await expect(
          f.authentication.refresh(context(), downgraded.tokens.refreshToken),
        ).rejects.toMatchObject({ code: 'AUTH.REFRESH_TOKEN_INVALID' });
        await expect(
          f.authorization.authorize(
            context(),
            downgraded.tokens.accessToken,
            {},
            { context: 'SELF' },
          ),
        ).rejects.toMatchObject({ code: 'AUTH.SESSION_REVOKED' });
      });
    });
  });
}
