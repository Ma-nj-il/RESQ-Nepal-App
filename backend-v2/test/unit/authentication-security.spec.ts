import { jest } from '@jest/globals';

import type { AuditWriter } from '../../src/shared/application/audit/audit-writer.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import type { UnitOfWork } from '../../src/shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../src/shared/domain/clock.js';
import type { IdGenerator } from '../../src/shared/domain/id-generator.js';
import { AuthenticationService } from '../../src/identity-access/application/authentication.service.js';
import type {
  AccessTokenIssuer,
  AuthenticationCryptography,
} from '../../src/identity-access/application/ports/authentication-cryptography.js';
import type { AuthenticationPolicy } from '../../src/identity-access/application/ports/authentication-policy.js';
import type {
  AuthenticationRepository,
  RefreshTokenRecord,
} from '../../src/identity-access/application/ports/authentication-repository.js';
import type { OtpDelivery } from '../../src/identity-access/application/ports/otp-delivery.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const TRANSACTION = { transactionId: 'test-transaction' };

function repositoryMock(): jest.Mocked<AuthenticationRepository> {
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

function refreshRecord(overrides: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord {
  return {
    id: '018f0000-0000-7000-8000-000000000001',
    sessionId: '018f0000-0000-7000-8000-000000000002',
    familyId: '018f0000-0000-7000-8000-000000000003',
    userId: '018f0000-0000-7000-8000-000000000004',
    tokenVersion: 3,
    assurance: 'AAL2',
    assuranceExpiresAt: new Date(NOW.getTime() - 1),
    clientType: 'MOBILE',
    expiresAt: new Date(NOW.getTime() + 60_000),
    sessionIdleExpiresAt: new Date(NOW.getTime() + 60_000),
    sessionAbsoluteExpiresAt: new Date(NOW.getTime() + 120_000),
    ...overrides,
  };
}

function service(repository: AuthenticationRepository): AuthenticationService {
  let id = 0;
  const cryptography: AuthenticationCryptography = {
    generateOtp: () => '123456',
    digestOtp: () => Uint8Array.of(1),
    generateRefreshToken: () => 'successor-refresh-token',
    digestRefreshToken: () => Uint8Array.of(2),
    equals: () => true,
  };
  const accessTokens: AccessTokenIssuer = {
    issue: (input) => ({
      token: `access-${input.assurance}`,
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
  const unitOfWork: UnitOfWork = {
    execute: (_context, work) => work(TRANSACTION),
  };
  const audit: AuditWriter = { append: jest.fn<AuditWriter['append']>() };
  const clock: Clock = { now: () => new Date(NOW) };
  const ids: IdGenerator = {
    generate: () => `018f0000-0000-7000-8000-${String(++id).padStart(12, '0')}`,
  };
  const delivery: OtpDelivery = { send: jest.fn<OtpDelivery['send']>() };
  return new AuthenticationService(
    repository,
    cryptography,
    accessTokens,
    policy,
    delivery,
    unitOfWork,
    audit,
    clock,
    ids,
  );
}

function publicContext(): RequestContext {
  return new RequestContext({
    requestId: 'request-id',
    correlationId: 'correlation-id',
    source: 'HTTP',
  });
}

describe('authentication security invariants', () => {
  it('rejects public OTP purposes that are not registration or login', async () => {
    const repository = repositoryMock();

    await expect(
      service(repository).requestOtp(publicContext(), {
        phoneNumber: '+9779812345678',
        purpose: 'RECOVERY',
      }),
    ).rejects.toMatchObject({ code: 'AUTH.OTP_PURPOSE_UNAVAILABLE', status: 400 });
    expect(repository.createOtpChallenge.mock.calls).toHaveLength(0);
  });

  it('downgrades expired AAL2 assurance during refresh rotation', async () => {
    const repository = repositoryMock();
    repository.findRefreshTokenForUpdate.mockResolvedValue(refreshRecord());

    const result = await service(repository).refresh(publicContext(), 'current-refresh-token');

    expect(result.tokens.assurance).toBe('AAL1');
    expect(repository.rotateRefreshToken.mock.calls[0]).toEqual([
      TRANSACTION,
      expect.objectContaining({ assurance: 'AAL1' }),
    ]);
    const rotation = repository.rotateRefreshToken.mock.calls[0]?.[1];
    expect(rotation).not.toHaveProperty('assuranceExpiresAt');
  });

  it('revokes the whole family when a consumed refresh token is reused', async () => {
    const repository = repositoryMock();
    repository.findRefreshTokenForUpdate.mockResolvedValue(
      refreshRecord({ consumedAt: new Date(NOW.getTime() - 5_000) }),
    );

    await expect(
      service(repository).refresh(publicContext(), 'reused-refresh-token'),
    ).rejects.toMatchObject({ code: 'AUTH.REFRESH_TOKEN_REUSED', status: 401 });
    expect(repository.revokeRefreshFamily.mock.calls[0]).toEqual([
      TRANSACTION,
      '018f0000-0000-7000-8000-000000000003',
      NOW,
      'REFRESH_TOKEN_REUSE',
    ]);
    expect(repository.rotateRefreshToken.mock.calls).toHaveLength(0);
  });

  it('allows only one serialized refresh-race winner and treats the loser as reuse', async () => {
    const repository = repositoryMock();
    repository.findRefreshTokenForUpdate
      .mockResolvedValueOnce(refreshRecord())
      .mockResolvedValueOnce(refreshRecord({ consumedAt: new Date(NOW) }));
    const authentication = service(repository);

    const winner = await authentication.refresh(publicContext(), 'same-refresh-token');
    await expect(
      authentication.refresh(publicContext(), 'same-refresh-token'),
    ).rejects.toMatchObject({ code: 'AUTH.REFRESH_TOKEN_REUSED', status: 401 });

    expect(winner.tokens.refreshToken).toBe('successor-refresh-token');
    expect(repository.rotateRefreshToken.mock.calls).toHaveLength(1);
    expect(repository.revokeRefreshFamily.mock.calls).toEqual([
      [TRANSACTION, '018f0000-0000-7000-8000-000000000003', NOW, 'REFRESH_TOKEN_REUSE'],
    ]);
  });
});
