import { jest } from '@jest/globals';

import { RequestContext } from '../../src/shared/application/context/request-context.js';
import type { UnitOfWork } from '../../src/shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../src/shared/domain/clock.js';
import { AuthorizationService } from '../../src/identity-access/application/authorization.service.js';
import type { AccessTokenIssuer } from '../../src/identity-access/application/ports/authentication-cryptography.js';
import type { AuthenticationRepository } from '../../src/identity-access/application/ports/authentication-repository.js';
import type { AuthorizationRepository } from '../../src/identity-access/application/ports/authorization-repository.js';
import type { AccessTokenClaims } from '../../src/identity-access/domain/authentication.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const USER_ID = '018f0000-0000-7000-8000-000000000001';
const SESSION_ID = '018f0000-0000-7000-8000-000000000002';
const TENANT_ID = '018f0000-0000-7000-8000-000000000003';
const TRANSACTION = { transactionId: 'test-transaction' };
const FACILITY_A = '018f0000-0000-7000-8000-000000000005';
const FACILITY_B = '018f0000-0000-7000-8000-000000000006';
const AUTHORITY_GRANT_ID = '018f0000-0000-7000-8000-000000000007';

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

function authorizationRepositoryMock(): jest.Mocked<AuthorizationRepository> {
  return {
    resolveTenantContext: jest.fn(),
    facilityBelongsToTenant: jest.fn(),
    resolveAuthorityContext: jest.fn(),
    findPrincipalProfile: jest.fn(),
    listAccessContexts: jest.fn(),
  };
}

function claims(assurance: 'AAL1' | 'AAL2'): AccessTokenClaims {
  return {
    issuer: 'test',
    audience: 'test',
    subject: USER_ID,
    sessionId: SESSION_ID,
    tokenId: '018f0000-0000-7000-8000-000000000004',
    issuedAt: Math.floor(NOW.getTime() / 1_000),
    notBefore: Math.floor(NOW.getTime() / 1_000),
    expiresAt: Math.floor(NOW.getTime() / 1_000) + 600,
    assurance,
    tokenVersion: 7,
    authenticationMethods: assurance === 'AAL2' ? ['password', 'totp'] : ['otp'],
  };
}

function service(
  authentication: AuthenticationRepository,
  authorization: AuthorizationRepository,
  tokenClaims: AccessTokenClaims,
): AuthorizationService {
  const accessTokens: AccessTokenIssuer = {
    issue: () => {
      throw new Error('not used');
    },
    verify: () => tokenClaims,
    jwks: () => ({ keys: [] }),
  };
  const unitOfWork: UnitOfWork = { execute: (_context, work) => work(TRANSACTION) };
  const clock: Clock = { now: () => new Date(NOW) };
  return new AuthorizationService(authentication, authorization, accessTokens, unitOfWork, clock);
}

function baseContext(): RequestContext {
  return new RequestContext({
    requestId: 'request-id',
    correlationId: 'correlation-id',
    source: 'HTTP',
  });
}

describe('authorization security invariants', () => {
  it('rejects an AAL2 token after the server-side assurance window expires', async () => {
    const authentication = authenticationRepositoryMock();
    const authorization = authorizationRepositoryMock();
    authentication.findSessionAuthorizationState.mockResolvedValue({
      userId: USER_ID,
      userStatus: 'ACTIVE',
      userTokenVersion: 7,
      sessionId: SESSION_ID,
      sessionVersion: 2,
      assurance: 'AAL2',
      assuranceExpiresAt: new Date(NOW.getTime() - 1),
      idleExpiresAt: new Date(NOW.getTime() + 60_000),
      absoluteExpiresAt: new Date(NOW.getTime() + 120_000),
    });

    await expect(
      service(authentication, authorization, claims('AAL2')).authorize(
        baseContext(),
        'access-token',
        {},
        { context: 'SELF' },
      ),
    ).rejects.toMatchObject({ code: 'AUTH.ACCESS_TOKEN_STALE', status: 401 });
  });

  it('denies a requested tenant when no server-resolved assignment exists', async () => {
    const authentication = authenticationRepositoryMock();
    const authorization = authorizationRepositoryMock();
    authentication.findSessionAuthorizationState.mockResolvedValue({
      userId: USER_ID,
      userStatus: 'ACTIVE',
      userTokenVersion: 7,
      sessionId: SESSION_ID,
      sessionVersion: 1,
      assurance: 'AAL1',
      idleExpiresAt: new Date(NOW.getTime() + 60_000),
      absoluteExpiresAt: new Date(NOW.getTime() + 120_000),
    });
    authorization.resolveTenantContext.mockResolvedValue(undefined);

    await expect(
      service(authentication, authorization, claims('AAL1')).authorize(
        baseContext(),
        'access-token',
        { tenantId: TENANT_ID },
        { context: 'TENANT', permission: 'access.role.read' },
      ),
    ).rejects.toMatchObject({ code: 'ACCESS.PERMISSION_DENIED', status: 403 });
    expect(authorization.resolveTenantContext.mock.calls[0]).toEqual([
      TRANSACTION,
      USER_ID,
      TENANT_ID,
      NOW,
    ]);
  });

  it('denies a facility outside the server-resolved facility set', async () => {
    const authentication = authenticationRepositoryMock();
    const authorization = authorizationRepositoryMock();
    authentication.findSessionAuthorizationState.mockResolvedValue({
      userId: USER_ID,
      userStatus: 'ACTIVE',
      userTokenVersion: 7,
      sessionId: SESSION_ID,
      sessionVersion: 1,
      assurance: 'AAL1',
      idleExpiresAt: new Date(NOW.getTime() + 60_000),
      absoluteExpiresAt: new Date(NOW.getTime() + 120_000),
    });
    authorization.resolveTenantContext.mockResolvedValue({
      assignmentId: 'assignment-id',
      tenantId: TENANT_ID,
      profileId: 'profile-id',
      profileVersion: 2,
      scopeType: 'FACILITY_SET',
      facilityIds: [FACILITY_A],
      permissionCodes: new Set(['trip.read']),
      validUntil: new Date(NOW.getTime() + 60_000),
    });

    await expect(
      service(authentication, authorization, claims('AAL1')).authorize(
        baseContext(),
        'access-token',
        { tenantId: TENANT_ID, facilityId: FACILITY_B },
        { context: 'TENANT', permission: 'trip.read' },
      ),
    ).rejects.toMatchObject({ code: 'ACCESS.PERMISSION_DENIED', status: 403 });
    expect(authorization.facilityBelongsToTenant.mock.calls).toHaveLength(0);
  });

  it('enforces authority resource and data-capability restrictions independently', async () => {
    const authentication = authenticationRepositoryMock();
    const authorization = authorizationRepositoryMock();
    authentication.findSessionAuthorizationState.mockResolvedValue({
      userId: USER_ID,
      userStatus: 'ACTIVE',
      userTokenVersion: 7,
      sessionId: SESSION_ID,
      sessionVersion: 1,
      assurance: 'AAL2',
      assuranceExpiresAt: new Date(NOW.getTime() + 60_000),
      idleExpiresAt: new Date(NOW.getTime() + 60_000),
      absoluteExpiresAt: new Date(NOW.getTime() + 120_000),
    });
    authorization.resolveAuthorityContext.mockResolvedValue({
      grantId: AUTHORITY_GRANT_ID,
      level: 'PROVINCE',
      permissionCodes: new Set(['trip.read']),
      resourceClasses: new Set(['TRIP']),
      geographicUnitIds: ['province-1'],
      purpose: 'Operations',
      allowsPii: false,
      allowsDocumentContent: false,
      allowsExport: false,
      allowsIntervention: false,
      requiredAssurance: 'AAL2',
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    await expect(
      service(authentication, authorization, claims('AAL2')).authorize(
        baseContext(),
        'access-token',
        { authorityGrantId: AUTHORITY_GRANT_ID },
        {
          context: 'AUTHORITY',
          permission: 'trip.read',
          resourceClass: 'TRIP',
          requiresExport: true,
        },
      ),
    ).rejects.toMatchObject({ code: 'ACCESS.PERMISSION_DENIED', status: 403 });
  });
});
