import { jest } from '@jest/globals';

import { AccessAdministrationService } from '../../src/identity-access/application/access-administration.service.js';
import type { AccessAdministrationPolicy } from '../../src/identity-access/application/ports/access-administration-policy.js';
import type {
  AccessAdministrationRepository,
  AuthorityGrantRecord,
  RoleProfileRecord,
} from '../../src/identity-access/application/ports/access-administration.repository.js';
import type { AuditWriter } from '../../src/shared/application/audit/audit-writer.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import {
  IdempotencyExecutor,
  type IdempotencyRepository,
} from '../../src/shared/application/idempotency/idempotency.js';
import type { UnitOfWork } from '../../src/shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../src/shared/domain/clock.js';
import type { IdGenerator } from '../../src/shared/domain/id-generator.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const ACTOR_ID = '018f0000-0000-7000-8000-000000000001';
const OTHER_USER_ID = '018f0000-0000-7000-8000-000000000002';
const TENANT_ID = '018f0000-0000-7000-8000-000000000003';
const FACILITY_ID = '018f0000-0000-7000-8000-000000000004';
const OTHER_FACILITY_ID = '018f0000-0000-7000-8000-000000000005';
const PROFILE_ID = '018f0000-0000-7000-8000-000000000006';
const AUTHORITY_GRANT_ID = '018f0000-0000-7000-8000-000000000007';
const TARGET_GRANT_ID = '018f0000-0000-7000-8000-000000000008';
const TRANSACTION = { transactionId: 'test-transaction' };

function repositoryMock(): jest.Mocked<AccessAdministrationRepository> {
  return {
    listPermissionCatalog: jest.fn(),
    listRoles: jest.fn(),
    findRole: jest.fn(),
    createRole: jest.fn(),
    updateRole: jest.fn(),
    retireRole: jest.fn(),
    listRoleProfiles: jest.fn(),
    findRoleProfile: jest.fn(),
    permissionsForRoles: jest.fn(),
    createRoleProfile: jest.fn(),
    updateRoleProfile: jest.fn(),
    retireRoleProfile: jest.fn(),
    listAssignments: jest.fn(),
    findAssignment: jest.fn(),
    createAssignment: jest.fn(),
    revokeAssignment: jest.fn(),
    listAuthorityGrants: jest.fn(),
    createAuthorityGrant: jest.fn(),
    findAuthorityGrant: jest.fn(),
    approveAuthorityGrant: jest.fn(),
    revokeAuthorityGrant: jest.fn(),
  };
}

function tenantContext(
  overrides: { actorId?: string; facilityIds?: readonly string[] } = {},
): RequestContext {
  return new RequestContext({
    requestId: 'request-id',
    correlationId: 'correlation-id',
    source: 'HTTP',
    actor: { type: 'USER', id: overrides.actorId ?? ACTOR_ID },
    sessionId: '018f0000-0000-7000-8000-000000000009',
    authentication: {
      assurance: 'AAL2',
      assuranceExpiresAt: new Date(NOW.getTime() + 300_000),
      tokenVersion: 1,
      profileVersion: 4,
      permissionCodes: ['access.assignment.manage', 'trip.read'],
    },
    scope: {
      tenantId: TENANT_ID,
      facilityIds: [...(overrides.facilityIds ?? [FACILITY_ID])],
      accessScopeType: 'FACILITY_SET',
      delegationExpiresAt: new Date(NOW.getTime() + 3_600_000),
    },
  });
}

function authorityContext(actorId = ACTOR_ID): RequestContext {
  return new RequestContext({
    requestId: 'request-id',
    correlationId: 'correlation-id',
    source: 'HTTP',
    actor: { type: 'USER', id: actorId },
    sessionId: '018f0000-0000-7000-8000-000000000009',
    authentication: {
      assurance: 'AAL2',
      assuranceExpiresAt: new Date(NOW.getTime() + 300_000),
      tokenVersion: 1,
      permissionCodes: ['access.authority.grant', 'trip.read'],
    },
    scope: {
      authorityGrantId: AUTHORITY_GRANT_ID,
      delegationExpiresAt: new Date(NOW.getTime() + 7_200_000),
      authority: {
        level: 'PROVINCE',
        resourceClasses: ['TRIP'],
        geographicUnitIds: ['province-1'],
        allowsPii: false,
        allowsDocumentContent: false,
        allowsExport: false,
        allowsIntervention: false,
        expiresAt: new Date(NOW.getTime() + 7_200_000),
      },
    },
  });
}

function profile(): RoleProfileRecord {
  return {
    id: PROFILE_ID,
    ownerType: 'TENANT',
    tenantId: TENANT_ID,
    name: 'Dispatcher',
    description: 'Bounded dispatch profile',
    roleIds: ['role-id'],
    permissionCodes: ['trip.read'],
    scopeCeiling: 'FACILITY_SET',
    version: 2,
    active: true,
  };
}

function authorityGrant(overrides: Partial<AuthorityGrantRecord> = {}): AuthorityGrantRecord {
  return {
    id: TARGET_GRANT_ID,
    subjectUserId: OTHER_USER_ID,
    issuedByUserId: '018f0000-0000-7000-8000-000000000010',
    parentGrantId: AUTHORITY_GRANT_ID,
    roleProfileId: PROFILE_ID,
    level: 'PROVINCE',
    permissionCodes: ['trip.read'],
    resourceClasses: ['TRIP'],
    geographicUnitIds: ['province-1'],
    nationalScope: false,
    purpose: 'Operational oversight',
    humanReason: 'Temporary incident coverage',
    status: 'PENDING_APPROVAL',
    validFrom: NOW,
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    allowsPii: false,
    allowsDocumentContent: false,
    allowsExport: false,
    allowsIntervention: false,
    version: 1,
    ...overrides,
  };
}

function buildService(repository: AccessAdministrationRepository): AccessAdministrationService {
  let id = 20;
  const unitOfWork: UnitOfWork = { execute: (_context, work) => work(TRANSACTION) };
  const idempotencyRepository: IdempotencyRepository = {
    begin: () => Promise.resolve({ kind: 'STARTED' }),
    complete: () => Promise.resolve(),
  };
  const clock: Clock = { now: () => new Date(NOW) };
  const ids: IdGenerator = {
    generate: () => `018f0000-0000-7000-8000-${String(++id).padStart(12, '0')}`,
  };
  const idempotency = new IdempotencyExecutor(idempotencyRepository, unitOfWork, clock, ids);
  const policy: AccessAdministrationPolicy = {
    maximumDelegatedAssignmentTtlSeconds: 3_600,
    maximumAuthorityGrantTtlSeconds: 7_200,
  };
  const audit: AuditWriter = { append: jest.fn<AuditWriter['append']>() };
  return new AccessAdministrationService(
    repository,
    policy,
    idempotency,
    unitOfWork,
    audit,
    clock,
    ids,
  );
}

const IDEMPOTENCY_KEY = 'security-test-key-0001';

describe('access administration security invariants', () => {
  it('rejects self-elevation before creating an assignment', async () => {
    const repository = repositoryMock();

    await expect(
      Promise.resolve().then(() =>
        buildService(repository).createAssignment(tenantContext(), IDEMPOTENCY_KEY, {
          userId: ACTOR_ID,
          roleProfileId: PROFILE_ID,
          scopeType: 'FACILITY_SET',
          facilityIds: [FACILITY_ID],
          validFrom: NOW,
          validUntil: new Date(NOW.getTime() + 600_000),
          reason: 'Self elevation attempt',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACCESS.SELF_ELEVATION_FORBIDDEN', status: 403 });
    expect(repository.createAssignment.mock.calls).toHaveLength(0);
  });

  it('rejects facility and validity delegation beyond the caller ceiling', async () => {
    const repository = repositoryMock();
    const administration = buildService(repository);
    const input = {
      userId: OTHER_USER_ID,
      roleProfileId: PROFILE_ID,
      scopeType: 'FACILITY_SET' as const,
      facilityIds: [OTHER_FACILITY_ID],
      validFrom: NOW,
      validUntil: new Date(NOW.getTime() + 600_000),
      reason: 'Out-of-scope facility',
    };

    await expect(
      Promise.resolve().then(() =>
        administration.createAssignment(tenantContext(), IDEMPOTENCY_KEY, input),
      ),
    ).rejects.toMatchObject({ code: 'ACCESS.DELEGATION_CEILING_EXCEEDED', status: 403 });

    await expect(
      Promise.resolve().then(() =>
        administration.createAssignment(tenantContext(), IDEMPOTENCY_KEY, {
          ...input,
          facilityIds: [FACILITY_ID],
          validUntil: new Date(NOW.getTime() + 3_600_001),
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACCESS.DELEGATION_VALIDITY_EXCEEDED', status: 403 });
    expect(repository.createAssignment.mock.calls).toHaveLength(0);
  });

  it('creates only a profile- and facility-bounded assignment with mandatory expiry', async () => {
    const repository = repositoryMock();
    repository.findRoleProfile.mockResolvedValue(profile());
    repository.createAssignment.mockImplementation((_transaction, input) =>
      Promise.resolve({
        id: input.id,
        tenantId: input.tenantId,
        userId: input.userId,
        roleProfileId: input.roleProfileId,
        profileName: 'Dispatcher',
        profileVersion: 2,
        scopeType: input.scopeType,
        facilityIds: input.facilityIds,
        status: 'ACTIVE',
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        version: 1,
      }),
    );

    const result = await buildService(repository).createAssignment(
      tenantContext(),
      IDEMPOTENCY_KEY,
      {
        userId: OTHER_USER_ID,
        roleProfileId: PROFILE_ID,
        scopeType: 'FACILITY_SET',
        facilityIds: [FACILITY_ID],
        validFrom: NOW,
        validUntil: new Date(NOW.getTime() + 600_000),
        reason: 'Shift coverage',
      },
    );

    expect(result.replayed).toBe(false);
    expect(repository.createAssignment.mock.calls[0]).toEqual([
      TRANSACTION,
      expect.objectContaining({
        tenantId: TENANT_ID,
        grantedBy: ACTOR_ID,
        facilityIds: [FACILITY_ID],
        validUntil: new Date(NOW.getTime() + 600_000),
      }),
    ]);
  });

  it('rejects an authority grant that widens geography or restricted capabilities', async () => {
    const repository = repositoryMock();
    const administration = buildService(repository);

    await expect(
      Promise.resolve().then(() =>
        administration.createAuthorityGrant(authorityContext(), IDEMPOTENCY_KEY, {
          subjectUserId: OTHER_USER_ID,
          roleProfileId: PROFILE_ID,
          level: 'PROVINCE',
          nationalScope: false,
          purpose: 'Oversight',
          humanReason: 'Out-of-scope request',
          validFrom: NOW,
          expiresAt: new Date(NOW.getTime() + 3_600_000),
          permissionCodes: ['trip.read'],
          resourceClasses: ['TRIP'],
          geographicUnitIds: ['province-2'],
          allowsPii: true,
          allowsDocumentContent: false,
          allowsExport: false,
          allowsIntervention: false,
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACCESS.DELEGATION_CEILING_EXCEEDED', status: 403 });
    expect(repository.createAuthorityGrant.mock.calls).toHaveLength(0);
  });

  it('requires authority approval by someone other than issuer or subject', async () => {
    const repository = repositoryMock();
    repository.findAuthorityGrant.mockResolvedValue(authorityGrant({ issuedByUserId: ACTOR_ID }));

    await expect(
      buildService(repository).approveAuthorityGrant(
        authorityContext(),
        IDEMPOTENCY_KEY,
        TARGET_GRANT_ID,
        1,
        'Independent review',
      ),
    ).rejects.toMatchObject({ code: 'ACCESS.DUAL_CONTROL_REQUIRED', status: 403 });
    expect(repository.approveAuthorityGrant.mock.calls).toHaveLength(0);
  });

  it('binds independent approval to the approver authority grant', async () => {
    const repository = repositoryMock();
    const pending = authorityGrant();
    const approved = authorityGrant({
      status: 'ACTIVE',
      approvedByUserId: ACTOR_ID,
      approvedUnderGrantId: AUTHORITY_GRANT_ID,
      version: 2,
    });
    repository.findAuthorityGrant.mockResolvedValue(pending);
    repository.approveAuthorityGrant.mockResolvedValue(approved);

    const result = await buildService(repository).approveAuthorityGrant(
      authorityContext(),
      IDEMPOTENCY_KEY,
      TARGET_GRANT_ID,
      1,
      'Independent review completed',
    );

    expect(result.value).toMatchObject({
      id: TARGET_GRANT_ID,
      status: 'ACTIVE',
      approvedUnderGrantId: AUTHORITY_GRANT_ID,
    });
    expect(repository.approveAuthorityGrant.mock.calls[0]).toEqual([
      TRANSACTION,
      expect.objectContaining({
        actorId: ACTOR_ID,
        approvedUnderGrantId: AUTHORITY_GRANT_ID,
        subjectUserId: OTHER_USER_ID,
      }),
    ]);
  });
});
