import { jest } from '@jest/globals';

import type { AuditWriter } from '../../src/shared/application/audit/audit-writer.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import type { UnitOfWork } from '../../src/shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../src/shared/domain/clock.js';
import type { IdGenerator } from '../../src/shared/domain/id-generator.js';
import { MultiFactorAuthenticationService } from '../../src/identity-access/application/multi-factor-authentication.service.js';
import type {
  AccessTokenIssuer,
  AuthenticationCryptography,
} from '../../src/identity-access/application/ports/authentication-cryptography.js';
import type { AuthenticationPolicy } from '../../src/identity-access/application/ports/authentication-policy.js';
import type { AuthenticationRepository } from '../../src/identity-access/application/ports/authentication-repository.js';
import type {
  MultiFactorCryptography,
  PasswordVerifier,
} from '../../src/identity-access/application/ports/multi-factor-cryptography.js';
import type { MultiFactorAuthenticationRepository } from '../../src/identity-access/application/ports/multi-factor-authentication.repository.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const USER_ID = '018f0000-0000-7000-8000-000000000001';
const SESSION_ID = '018f0000-0000-7000-8000-000000000002';
const CHALLENGE_ID = '018f0000-0000-7000-8000-000000000003';
const FACTOR_ID = '018f0000-0000-7000-8000-000000000004';
const TRANSACTION = { transactionId: 'test-transaction' };

function mfaRepositoryMock(): jest.Mocked<MultiFactorAuthenticationRepository> {
  return {
    findAdministrativeIdentity: jest.fn(),
    findActiveUserTokenVersion: jest.fn(),
    hasVerifiedTotpFactor: jest.fn(),
    createChallenge: jest.fn(),
    peekChallengeUser: jest.fn(),
    findChallengeForUpdate: jest.fn(),
    recordChallengeFailure: jest.fn(),
    consumeChallenge: jest.fn(),
    listVerifiedTotpFactors: jest.fn(),
    consumeTotpStep: jest.fn(),
    createPendingTotpFactor: jest.fn(),
    findOwnedTotpFactorForUpdate: jest.fn(),
    verifyTotpFactor: jest.fn(),
    upgradeSessionAssurance: jest.fn(),
  };
}

function authenticationRepositoryMock(): jest.Mocked<AuthenticationRepository> {
  return {
    createOtpChallenge: jest.fn(),
    findOtpChallengeForUpdate: jest.fn(),
    recordOtpFailure: jest.fn(),
    consumeOtpChallenge: jest.fn(),
    findOrCreatePhoneUser: jest.fn(),
    createSessionAndRefreshToken: jest.fn(),
    findRefreshTokenForUpdate: jest.fn(),
    rotateRefreshToken: jest.fn(),
    revokeRefreshFamily: jest.fn(),
    revokeSession: jest.fn(),
    revokeOtherSessions: jest.fn(),
    findSessionAuthorizationState: jest.fn(),
    listOwnedSessions: jest.fn(),
  };
}

function buildService(
  repository: MultiFactorAuthenticationRepository,
  multiFactorCryptographyOverrides: Partial<MultiFactorCryptography> = {},
): MultiFactorAuthenticationService {
  const passwordVerifier: PasswordVerifier = { verify: () => Promise.resolve(false) };
  const multiFactorCryptography: MultiFactorCryptography = {
    createTotpEnrollment: () => ({
      sharedSecret: 'secret',
      provisioningUri: 'otpauth://totp/test',
      encryptedSecret: Uint8Array.of(1),
      keyVersion: 'test-key',
    }),
    matchingTotpStep: () => undefined,
    ...multiFactorCryptographyOverrides,
  };
  const authenticationCryptography: AuthenticationCryptography = {
    generateOtp: () => '123456',
    digestOtp: () => Uint8Array.of(1),
    generateRefreshToken: () => 'refresh-token',
    digestRefreshToken: () => Uint8Array.of(2),
    equals: () => true,
  };
  const accessTokens: AccessTokenIssuer = {
    issue: (input) => ({
      token: 'access-token',
      expiresAt: new Date(input.now.getTime() + 60_000),
    }),
    verify: () => {
      throw new Error('not used');
    },
    jwks: () => ({ keys: [] }),
  };
  const policy: AuthenticationPolicy = {
    otpLifetimeSeconds: 300,
    otpMaximumAttempts: 5,
    mfaChallengeLifetimeSeconds: 300,
    mfaEnrollmentLifetimeSeconds: 600,
    mfaMaximumAttempts: 5,
    aal2LifetimeSeconds: 300,
    refreshTokenTtlSeconds: 3_600,
    sessionIdleTtlSeconds: 1_800,
    sessionAbsoluteTtlSeconds: 7_200,
  };
  const unitOfWork: UnitOfWork = { execute: (_context, work) => work(TRANSACTION) };
  const audit: AuditWriter = { append: jest.fn<AuditWriter['append']>() };
  const clock: Clock = { now: () => new Date(NOW) };
  const ids: IdGenerator = { generate: () => '018f0000-0000-7000-8000-000000000099' };
  return new MultiFactorAuthenticationService(
    repository,
    authenticationRepositoryMock(),
    passwordVerifier,
    multiFactorCryptography,
    authenticationCryptography,
    accessTokens,
    policy,
    unitOfWork,
    audit,
    clock,
    ids,
  );
}

function context(input?: { userId: string; sessionId: string }): RequestContext {
  return new RequestContext({
    requestId: 'request-id',
    correlationId: 'correlation-id',
    source: 'HTTP',
    ...(input === undefined
      ? {}
      : {
          actor: { type: 'USER' as const, id: input.userId },
          sessionId: input.sessionId,
          authentication: { assurance: 'AAL1' as const, tokenVersion: 1 },
        }),
  });
}

describe('multi-factor security invariants', () => {
  it('returns the same enrollment expiry that is stored with the encrypted factor', async () => {
    const repository = mfaRepositoryMock();
    repository.hasVerifiedTotpFactor.mockResolvedValue(false);
    const result = await buildService(repository).createTotpEnrollment(
      context({ userId: USER_ID, sessionId: SESSION_ID }),
      'Primary',
    );
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 600000));
    expect(repository.createPendingTotpFactor.mock.calls).toEqual([
      [
        TRANSACTION,
        expect.objectContaining({
          userId: USER_ID,
          enrollmentExpiresAt: result.expiresAt,
          encryptedSecret: Uint8Array.of(1),
        }),
      ],
    ]);
    expect(repository.createPendingTotpFactor.mock.calls[0]?.[1]).not.toHaveProperty(
      'sharedSecret',
    );
  });

  it('requires live AAL2 before enrolling another factor', async () => {
    const repository = mfaRepositoryMock();
    repository.hasVerifiedTotpFactor.mockResolvedValue(true);
    await expect(
      buildService(repository).createTotpEnrollment(
        context({ userId: USER_ID, sessionId: SESSION_ID }),
        'Extra',
      ),
    ).rejects.toMatchObject({ code: 'ACCESS.STEP_UP_REQUIRED' });
    expect(repository.createPendingTotpFactor.mock.calls).toHaveLength(0);
  });

  it('binds an enrollment upgrade response to the factor owner and current session', async () => {
    const repository = mfaRepositoryMock();
    repository.findOwnedTotpFactorForUpdate.mockResolvedValue({
      id: FACTOR_ID,
      userId: USER_ID,
      label: 'Primary',
      encryptedSecret: Uint8Array.of(1),
      keyVersion: 'test-key',
      enrollmentExpiresAt: new Date(NOW.getTime() + 600000),
    });
    repository.verifyTotpFactor.mockResolvedValue(true);
    repository.upgradeSessionAssurance.mockResolvedValue(true);
    const result = await buildService(repository, {
      matchingTotpStep: () => 100,
    }).verifyTotpEnrollment(
      context({ userId: USER_ID, sessionId: SESSION_ID }),
      FACTOR_ID,
      '123456',
    );
    expect(result).toMatchObject({ userId: USER_ID, sessionId: SESSION_ID, assurance: 'AAL2' });
    expect(result).not.toHaveProperty('refreshToken');
    expect(repository.findOwnedTotpFactorForUpdate.mock.calls).toEqual([
      [TRANSACTION, USER_ID, FACTOR_ID],
    ]);
  });

  it('binds step-up verification to the authenticated user and session', async () => {
    const repository = mfaRepositoryMock();
    repository.peekChallengeUser.mockResolvedValue(USER_ID);
    repository.findChallengeForUpdate.mockResolvedValue({
      id: CHALLENGE_ID,
      userId: USER_ID,
      purpose: 'STEP_UP',
      authenticationMethod: 'SESSION',
      sessionId: SESSION_ID,
      attempts: 0,
      maximumAttempts: 5,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    await expect(
      buildService(repository).verifyChallenge(context(), CHALLENGE_ID, '123456'),
    ).rejects.toMatchObject({ code: 'AUTH.MFA_INVALID', status: 401 });
    expect(repository.listVerifiedTotpFactors.mock.calls).toHaveLength(0);
  });

  it('rejects a TOTP time step that was already consumed', async () => {
    const repository = mfaRepositoryMock();
    repository.peekChallengeUser.mockResolvedValue(USER_ID);
    repository.findChallengeForUpdate.mockResolvedValue({
      id: CHALLENGE_ID,
      userId: USER_ID,
      purpose: 'LOGIN',
      authenticationMethod: 'PASSWORD',
      clientType: 'BROWSER',
      attempts: 0,
      maximumAttempts: 5,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    repository.listVerifiedTotpFactors.mockResolvedValue([
      {
        id: FACTOR_ID,
        userId: USER_ID,
        label: 'Primary',
        encryptedSecret: Uint8Array.of(1),
        keyVersion: 'test-key',
        lastUsedStep: 100,
        verifiedAt: new Date(NOW.getTime() - 60_000),
      },
    ]);
    repository.recordChallengeFailure.mockResolvedValue(1);

    await expect(
      buildService(repository, { matchingTotpStep: () => 100 }).verifyChallenge(
        context(),
        CHALLENGE_ID,
        '123456',
      ),
    ).rejects.toMatchObject({ code: 'AUTH.MFA_INVALID', status: 401 });
    expect(repository.consumeTotpStep.mock.calls).toHaveLength(0);
    expect(repository.recordChallengeFailure.mock.calls[0]).toEqual([TRANSACTION, CHALLENGE_ID]);
  });
});
