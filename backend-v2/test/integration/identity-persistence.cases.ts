import { randomBytes, randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import { PostgresAuthenticationRepository } from '../../src/identity-access/infrastructure/persistence/postgres-authentication.repository.js';
import { PostgresMultiFactorAuthenticationRepository } from '../../src/identity-access/infrastructure/persistence/postgres-multi-factor-authentication.repository.js';
import { PostgresProviderOperationsRepository } from '../../src/provider-operations/infrastructure/persistence/postgres-provider-operations.repository.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import type { ApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';
import type { DatabaseService } from '../../src/shared/infrastructure/persistence/database.service.js';
import { applicationDataSourceOptions } from '../../src/shared/infrastructure/persistence/data-source-options.js';
import { TypeOrmUnitOfWork } from '../../src/shared/infrastructure/persistence/typeorm-unit-of-work.js';

/** Exercises the real application login, forced RLS and TypeORM RETURNING results. */
export function identityPersistenceCases(harness: {
  config: () => ApplicationConfig;
  createUser: () => Promise<string>;
}): void {
  const authentication = new PostgresAuthenticationRepository();
  const mfa = new PostgresMultiFactorAuthenticationRepository();
  const context = (userId?: string): RequestContext =>
    new RequestContext({
      requestId: randomUUID(),
      correlationId: randomUUID(),
      source: 'HTTP',
      ...(userId === undefined ? {} : { actor: { type: 'USER', id: userId } }),
    });
  async function withPersistence(work: (uow: TypeOrmUnitOfWork) => Promise<void>): Promise<void> {
    const source = new DataSource(applicationDataSourceOptions(harness.config()));
    await source.initialize();
    try {
      const database = {
        getDataSource: () => Promise.resolve(source),
      } as unknown as DatabaseService;
      await work(new TypeOrmUnitOfWork(database, { generate: randomUUID }));
    } finally {
      await source.destroy();
    }
  }
  async function session(
    uow: TypeOrmUnitOfWork,
    userId: string,
  ): Promise<Parameters<PostgresAuthenticationRepository['createSessionAndRefreshToken']>[1]> {
    const input = {
      userId,
      sessionId: randomUUID(),
      familyId: randomUUID(),
      refreshTokenId: randomUUID(),
      refreshTokenDigest: randomBytes(32),
      clientType: 'MOBILE' as const,
      assurance: 'AAL1' as const,
      authenticationMethods: ['otp' as const],
      now: new Date(),
      refreshTokenExpiresAt: new Date(Date.now() + 3_600_000),
      idleExpiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 7_200_000),
    };
    await uow.execute(context(), (transaction) =>
      authentication.createSessionAndRefreshToken(transaction, input),
    );
    return input;
  }

  it('commits refresh rotation and revokes predecessor and successor together on reuse', async () => {
    await withPersistence(async (uow) => {
      const original = await session(uow, await harness.createUser());
      const successorDigest = randomBytes(32),
        successorTokenId = randomUUID();
      await uow.execute(context(), async (transaction) => {
        const current = await authentication.findRefreshTokenForUpdate(
          transaction,
          original.refreshTokenDigest,
        );
        expect(current).toMatchObject({ id: original.refreshTokenId, userId: original.userId });
        await authentication.rotateRefreshToken(transaction, {
          consumedTokenId: original.refreshTokenId,
          successorTokenId,
          successorDigest,
          successorExpiresAt: original.refreshTokenExpiresAt,
          sessionId: original.sessionId,
          familyId: original.familyId,
          now: new Date(),
          idleExpiresAt: original.idleExpiresAt,
          assurance: 'AAL1',
          authenticationMethods: ['otp'],
        });
      });
      await uow.execute(context(), async (transaction) => {
        const current = await authentication.findRefreshTokenForUpdate(
          transaction,
          successorDigest,
        );
        expect(current).toMatchObject({ id: successorTokenId, sessionId: original.sessionId });
        expect(current?.consumedAt).toBeUndefined();
      });
      await uow.execute(context(), async (transaction) => {
        const predecessor = await authentication.findRefreshTokenForUpdate(
          transaction,
          original.refreshTokenDigest,
        );
        expect(predecessor?.consumedAt).toBeInstanceOf(Date);
        await authentication.revokeRefreshFamily(
          transaction,
          original.familyId,
          new Date(),
          'REFRESH_TOKEN_REUSE',
        );
      });
      for (const digest of [original.refreshTokenDigest, successorDigest]) {
        await uow.execute(context(), async (transaction) => {
          const revoked = await authentication.findRefreshTokenForUpdate(transaction, digest);
          expect(revoked?.revokedAt).toBeInstanceOf(Date);
          expect(revoked?.sessionRevokedAt).toBeInstanceOf(Date);
        });
      }
    });
  });

  it('counts multi-session revocation exactly and rejects a foreign session', async () => {
    await withPersistence(async (uow) => {
      const userId = await harness.createUser();
      const current = await session(uow, userId);
      const others = [
        await session(uow, userId),
        await session(uow, userId),
        await session(uow, userId),
      ];
      const outsider = await session(uow, await harness.createUser());
      await expect(
        uow.execute(context(userId), (tx) =>
          authentication.revokeSession(tx, userId, outsider.sessionId, new Date(), 'LOGOUT'),
        ),
      ).resolves.toBe(false);
      await expect(
        uow.execute(context(userId), (tx) =>
          authentication.revokeOtherSessions(
            tx,
            userId,
            current.sessionId,
            false,
            new Date(),
            'LOGOUT',
          ),
        ),
      ).resolves.toBe(3);
      await expect(
        uow.execute(context(userId), (tx) =>
          authentication.revokeOtherSessions(
            tx,
            userId,
            current.sessionId,
            false,
            new Date(),
            'LOGOUT',
          ),
        ),
      ).resolves.toBe(0);
      for (const other of others) {
        await uow.execute(context(), async (tx) => {
          expect(
            (await authentication.findRefreshTokenForUpdate(tx, other.refreshTokenDigest))
              ?.revokedAt,
          ).toBeInstanceOf(Date);
        });
      }
      await uow.execute(context(), async (tx) => {
        expect(
          (await authentication.findRefreshTokenForUpdate(tx, outsider.refreshTokenDigest))
            ?.revokedAt,
        ).toBeUndefined();
      });
      await expect(
        uow.execute(context(userId), (tx) =>
          authentication.revokeSession(tx, userId, current.sessionId, new Date(), 'LOGOUT'),
        ),
      ).resolves.toBe(true);
    });
  });

  it('returns persisted OTP and MFA failure counts instead of resetting to zero', async () => {
    await withPersistence(async (uow) => {
      const userId = await harness.createUser(),
        otpId = randomUUID(),
        mfaId = randomUUID();
      await uow.execute(context(userId), async (tx) => {
        await authentication.createOtpChallenge(tx, {
          id: otpId,
          normalizedPhone: '+9779800000099',
          purpose: 'REGISTRATION_OR_LOGIN',
          codeDigest: randomBytes(32),
          maximumAttempts: 5,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 300_000),
        });
        await mfa.createChallenge(tx, {
          id: mfaId,
          userId,
          purpose: 'LOGIN',
          authenticationMethod: 'PASSWORD',
          clientType: 'BROWSER',
          maximumAttempts: 5,
          expiresAt: new Date(Date.now() + 300_000),
          now: new Date(),
        });
      });
      for (const count of [1, 2, 3]) {
        await uow.execute(context(userId), async (tx) => {
          expect(await authentication.recordOtpFailure(tx, otpId, new Date())).toBe(count);
          expect(await mfa.recordChallengeFailure(tx, mfaId)).toBe(count);
        });
      }
    });
  });

  it('verifies TOTP once, rejects reused steps, and upgrades only a live owned session', async () => {
    await withPersistence(async (uow) => {
      const userId = await harness.createUser(),
        factorId = randomUUID();
      const current = await session(uow, userId);
      await uow.execute(context(userId), async (tx) => {
        await mfa.createPendingTotpFactor(tx, {
          id: factorId,
          userId,
          label: 'Synthetic factor',
          encryptedSecret: randomBytes(64),
          keyVersion: 'synthetic',
          enrollmentExpiresAt: new Date(Date.now() + 300_000),
          now: new Date(),
        });
        expect(await mfa.verifyTotpFactor(tx, userId, factorId, 100, new Date())).toBe(true);
        expect(await mfa.verifyTotpFactor(tx, userId, factorId, 100, new Date())).toBe(false);
      });
      await uow.execute(context(userId), async (tx) => {
        expect(await mfa.consumeTotpStep(tx, factorId, 100, new Date())).toBe(false);
        expect(await mfa.consumeTotpStep(tx, factorId, 101, new Date())).toBe(true);
        expect(await mfa.consumeTotpStep(tx, factorId, 101, new Date())).toBe(false);
        expect(
          await mfa.upgradeSessionAssurance(
            tx,
            userId,
            current.sessionId,
            new Date(),
            new Date(Date.now() + 300_000),
          ),
        ).toEqual(['otp', 'totp']);
        expect(
          await mfa.upgradeSessionAssurance(
            tx,
            userId,
            randomUUID(),
            new Date(),
            new Date(Date.now() + 300_000),
          ),
        ).toBeUndefined();
      });
    });
  });

  it('returns provider transitions and rejects stale and foreign updates without changing the row', async () => {
    await withPersistence(async (uow) => {
      const providers = new PostgresProviderOperationsRepository(),
        userId = await harness.createUser();
      const application = await uow.execute(context(userId), (tx) =>
        providers.createProviderApplication(tx, {
          id: randomUUID(),
          applicantUserId: userId,
          legalName: 'Synthetic provider',
          displayName: 'Synthetic',
          registrationNumber: randomUUID(),
          geographicUnitId: '019a45f0-0000-7000-8000-000000000103',
          facilityName: 'Synthetic base',
          facilityType: 'AMBULANCE_BASE',
          now: new Date(),
        }),
      );
      const transition = {
        applicationId: application.id,
        expectedVersion: application.version,
        fromStatuses: ['DRAFT' as const],
        toStatus: 'SUBMITTED' as const,
        now: new Date(),
      };
      await expect(
        uow.execute(context(await harness.createUser()), (tx) =>
          providers.transitionProviderApplication(tx, transition),
        ),
      ).resolves.toBeUndefined();
      await expect(
        uow.execute(context(userId), (tx) =>
          providers.transitionProviderApplication(tx, transition),
        ),
      ).resolves.toMatchObject({
        id: application.id,
        version: application.version + 1,
        status: 'SUBMITTED',
      });
      await expect(
        uow.execute(context(userId), (tx) =>
          providers.transitionProviderApplication(tx, transition),
        ),
      ).resolves.toBeUndefined();
      await expect(
        uow.execute(context(userId), (tx) => providers.findProviderApplication(tx, application.id)),
      ).resolves.toMatchObject({ version: application.version + 1, status: 'SUBMITTED' });
    });
  });
}
