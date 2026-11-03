import type { AuditWriter } from '../../shared/application/audit/audit-writer.js';
import type { RequestContext } from '../../shared/application/context/request-context.js';
import { RequestContext as ResolvedRequestContext } from '../../shared/application/context/request-context.js';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type {
  IdempotencyExecutor,
  IdempotentResult,
  JsonValue,
} from '../../shared/application/idempotency/idempotency.js';
import type {
  TransactionContext,
  UnitOfWork,
} from '../../shared/application/persistence/unit-of-work.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type {
  AccessAdministrationRepository,
  AccessAssignmentRecord,
  AuthorityGrantRecord,
  PermissionCatalogItem,
  RoleProfileRecord,
  RoleRecord,
} from './ports/access-administration.repository.js';
import type { AccessAdministrationPolicy } from './ports/access-administration-policy.js';

type ScopeCeiling = RoleProfileRecord['scopeCeiling'];
type AuthorityGrantCreationInput = Omit<
  Parameters<AccessAdministrationRepository['createAuthorityGrant']>[1],
  'id' | 'issuedByUserId' | 'parentGrantId' | 'now'
>;
interface AuthorityScopeRequest {
  readonly level: 'PROVINCE' | 'PLATFORM';
  readonly nationalScope: boolean;
  readonly permissionCodes: readonly string[];
  readonly resourceClasses: readonly string[];
  readonly geographicUnitIds: readonly string[];
  readonly allowsPii: boolean;
  readonly allowsDocumentContent: boolean;
  readonly allowsExport: boolean;
  readonly allowsIntervention: boolean;
  readonly expiresAt: Date;
}

const scopeRank: Readonly<Record<ScopeCeiling, number>> = Object.freeze({
  SELF: 0,
  ASSIGNED_TRIP: 1,
  FACILITY_SET: 2,
  TENANT: 3,
  PROVINCE_GRANT: 4,
  PLATFORM_GRANT: 5,
});

function forbidden(code = 'ACCESS.DELEGATION_CEILING_EXCEEDED'): ApplicationError {
  return new ApplicationError({
    code,
    message: 'The requested access exceeds the delegator ceiling.',
    status: 403,
  });
}

function stale(): ApplicationError {
  return new ApplicationError({
    code: 'REQUEST.STALE_VERSION',
    message: 'The resource changed before this request was applied.',
    status: 409,
  });
}

function notFound(): ApplicationError {
  return new ApplicationError({
    code: 'RESOURCE.NOT_FOUND',
    message: 'The requested resource was not found.',
    status: 404,
  });
}

function asJsonRecord(value: Record<string, JsonValue>): JsonValue {
  return value;
}

export class AccessAdministrationService {
  constructor(
    private readonly repository: AccessAdministrationRepository,
    private readonly policy: AccessAdministrationPolicy,
    private readonly idempotency: IdempotencyExecutor,
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  listPermissions(context: RequestContext): Promise<readonly PermissionCatalogItem[]> {
    this.requireTenant(context);
    const permissionCodes = context.authentication?.permissionCodes ?? [];
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listPermissionCatalog(transaction, permissionCodes),
    );
  }

  listRoles(context: RequestContext): Promise<readonly RoleRecord[]> {
    const tenantId = this.requireTenant(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listRoles(transaction, tenantId),
    );
  }

  async role(context: RequestContext, roleId: string): Promise<RoleRecord> {
    const tenantId = this.requireTenant(context);
    const role = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findRole(transaction, tenantId, roleId),
    );
    if (role === undefined) throw notFound();
    return role;
  }

  createRole(
    context: RequestContext,
    key: string,
    input: {
      readonly name: string;
      readonly description: string;
      readonly permissionCodes: readonly string[];
      readonly reason: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    const actorId = this.requireAal2Actor(context);
    this.requireDelegablePermissions(context, input.permissionCodes);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: 'access.role.create',
        request: asJsonRecord({
          name: input.name,
          description: input.description,
          permissionCodes: [...input.permissionCodes],
          reason: input.reason,
        }),
        successStatus: 201,
      },
      async (transaction) => {
        const now = this.clock.now();
        const role = await this.repository.createRole(transaction, {
          id: this.ids.generate(),
          tenantId,
          actorId,
          name: input.name,
          description: input.description,
          permissionCodes: input.permissionCodes,
          now,
        });
        await this.appendAllowedAudit(transaction, context, {
          now,
          action: 'access.role.create',
          resourceType: 'role',
          resourceId: role.id,
          reasonCode: 'ACCESS.ROLE_CREATED',
          reason: input.reason,
          permissionCount: role.permissionCodes.length,
        });
        return this.roleJson(role);
      },
    );
  }

  updateRole(
    context: RequestContext,
    key: string,
    roleId: string,
    input: {
      readonly expectedVersion: number;
      readonly name: string;
      readonly description: string;
      readonly permissionCodes: readonly string[];
      readonly reason: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    this.requireAal2Actor(context);
    this.requireDelegablePermissions(context, input.permissionCodes);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `access.role.update:${roleId}`,
        request: asJsonRecord({ roleId, ...input, permissionCodes: [...input.permissionCodes] }),
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const role = await this.repository.updateRole(transaction, {
          tenantId,
          roleId,
          expectedVersion: input.expectedVersion,
          name: input.name,
          description: input.description,
          permissionCodes: input.permissionCodes,
          now,
        });
        if (role === undefined) throw stale();
        await this.appendAllowedAudit(transaction, context, {
          now,
          action: 'access.role.update',
          resourceType: 'role',
          resourceId: role.id,
          reasonCode: 'ACCESS.ROLE_UPDATED',
          reason: input.reason,
          permissionCount: role.permissionCodes.length,
        });
        return this.roleJson(role);
      },
    );
  }

  retireRole(
    context: RequestContext,
    key: string,
    roleId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    this.requireAal2Actor(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `access.role.retire:${roleId}`,
        request: asJsonRecord({ roleId, expectedVersion, reason }),
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const retired = await this.repository.retireRole(
          transaction,
          tenantId,
          roleId,
          expectedVersion,
          now,
        );
        if (!retired) throw stale();
        await this.appendAllowedAudit(transaction, context, {
          now,
          action: 'access.role.retire',
          resourceType: 'role',
          resourceId: roleId,
          reasonCode: 'ACCESS.ROLE_RETIRED',
          reason,
        });
        return asJsonRecord({ id: roleId, active: false, version: expectedVersion + 1 });
      },
    );
  }

  listRoleProfiles(context: RequestContext): Promise<readonly RoleProfileRecord[]> {
    const tenantId = this.requireTenant(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listRoleProfiles(transaction, tenantId),
    );
  }

  async roleProfile(context: RequestContext, profileId: string): Promise<RoleProfileRecord> {
    const tenantId = this.requireTenant(context);
    const profile = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findRoleProfile(transaction, tenantId, profileId),
    );
    if (profile === undefined) throw notFound();
    return profile;
  }

  createRoleProfile(
    context: RequestContext,
    key: string,
    input: {
      readonly name: string;
      readonly description: string;
      readonly scopeCeiling: ScopeCeiling;
      readonly roleIds: readonly string[];
      readonly reason: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    const actorId = this.requireAal2Actor(context);
    this.requireScopeCeiling(context, input.scopeCeiling);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: 'access.role-profile.create',
        request: asJsonRecord({ ...input, roleIds: [...input.roleIds] }),
        successStatus: 201,
      },
      async (transaction) => {
        const permissions = await this.repository.permissionsForRoles(
          transaction,
          tenantId,
          input.roleIds,
        );
        this.requireDelegablePermissions(context, permissions);
        const now = this.clock.now();
        const profile = await this.repository.createRoleProfile(transaction, {
          id: this.ids.generate(),
          tenantId,
          actorId,
          name: input.name,
          description: input.description,
          scopeCeiling: input.scopeCeiling,
          roleIds: input.roleIds,
          now,
        });
        await this.appendAllowedAudit(transaction, context, {
          now,
          action: 'access.role-profile.create',
          resourceType: 'role_profile',
          resourceId: profile.id,
          reasonCode: 'ACCESS.ROLE_PROFILE_CREATED',
          reason: input.reason,
          roleCount: profile.roleIds.length,
        });
        return this.profileJson(profile);
      },
    );
  }

  updateRoleProfile(
    context: RequestContext,
    key: string,
    profileId: string,
    input: {
      readonly expectedVersion: number;
      readonly name: string;
      readonly description: string;
      readonly scopeCeiling: ScopeCeiling;
      readonly roleIds: readonly string[];
      readonly reason: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    this.requireAal2Actor(context);
    this.requireScopeCeiling(context, input.scopeCeiling);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `access.role-profile.update:${profileId}`,
        request: asJsonRecord({ profileId, ...input, roleIds: [...input.roleIds] }),
        successStatus: 200,
      },
      async (transaction) => {
        const permissions = await this.repository.permissionsForRoles(
          transaction,
          tenantId,
          input.roleIds,
        );
        this.requireDelegablePermissions(context, permissions);
        const now = this.clock.now();
        const profile = await this.repository.updateRoleProfile(transaction, {
          tenantId,
          profileId,
          expectedVersion: input.expectedVersion,
          name: input.name,
          description: input.description,
          scopeCeiling: input.scopeCeiling,
          roleIds: input.roleIds,
          now,
        });
        if (profile === undefined) throw stale();
        await this.appendAllowedAudit(transaction, context, {
          now,
          action: 'access.role-profile.update',
          resourceType: 'role_profile',
          resourceId: profile.id,
          reasonCode: 'ACCESS.ROLE_PROFILE_UPDATED',
          reason: input.reason,
          roleCount: profile.roleIds.length,
        });
        return this.profileJson(profile);
      },
    );
  }

  retireRoleProfile(
    context: RequestContext,
    key: string,
    profileId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    this.requireAal2Actor(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `access.role-profile.retire:${profileId}`,
        request: asJsonRecord({ profileId, expectedVersion, reason }),
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const retired = await this.repository.retireRoleProfile(
          transaction,
          tenantId,
          profileId,
          expectedVersion,
          now,
        );
        if (!retired) throw stale();
        await this.appendAllowedAudit(transaction, context, {
          now,
          action: 'access.role-profile.retire',
          resourceType: 'role_profile',
          resourceId: profileId,
          reasonCode: 'ACCESS.ROLE_PROFILE_RETIRED',
          reason,
        });
        return asJsonRecord({ id: profileId, active: false, version: expectedVersion + 1 });
      },
    );
  }

  listAssignments(context: RequestContext): Promise<readonly AccessAssignmentRecord[]> {
    const tenantId = this.requireTenant(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listAssignments(transaction, tenantId),
    );
  }

  async assignment(context: RequestContext, assignmentId: string): Promise<AccessAssignmentRecord> {
    const tenantId = this.requireTenant(context);
    const assignment = await this.unitOfWork.execute(context, (transaction) =>
      this.repository.findAssignment(transaction, tenantId, assignmentId),
    );
    if (assignment === undefined) throw notFound();
    return assignment;
  }

  createAssignment(
    context: RequestContext,
    key: string,
    input: {
      readonly userId: string;
      readonly roleProfileId: string;
      readonly scopeType: 'TENANT' | 'FACILITY_SET';
      readonly facilityIds: readonly string[];
      readonly validFrom: Date;
      readonly validUntil: Date;
      readonly reason: string;
    },
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    const actorId = this.requireAal2Actor(context);
    if (input.userId === actorId) throw forbidden('ACCESS.SELF_ELEVATION_FORBIDDEN');
    this.requireAssignmentScope(context, input.scopeType, input.facilityIds);
    this.requireDelegatedWindow(
      context,
      input.validFrom,
      input.validUntil,
      this.policy.maximumDelegatedAssignmentTtlSeconds,
    );
    return this.idempotency.execute(
      context,
      {
        key,
        operation: 'access.assignment.create',
        request: asJsonRecord({
          userId: input.userId,
          roleProfileId: input.roleProfileId,
          scopeType: input.scopeType,
          facilityIds: [...input.facilityIds],
          validFrom: input.validFrom.toISOString(),
          validUntil: input.validUntil.toISOString(),
          reason: input.reason,
        }),
        successStatus: 201,
      },
      async (transaction) => {
        const profile = await this.repository.findRoleProfile(
          transaction,
          tenantId,
          input.roleProfileId,
        );
        if (profile === undefined || !profile.active) throw forbidden();
        this.requireDelegablePermissions(context, profile.permissionCodes);
        this.requireScopeCeiling(context, profile.scopeCeiling);
        const now = this.clock.now();
        const assignment = await this.repository.createAssignment(transaction, {
          id: this.ids.generate(),
          tenantId,
          userId: input.userId,
          roleProfileId: input.roleProfileId,
          scopeType: input.scopeType,
          facilityIds: input.facilityIds,
          validFrom: input.validFrom,
          validUntil: input.validUntil,
          grantedBy: actorId,
          delegationEvidence: {
            reason: input.reason,
            delegatorProfileVersion: context.authentication?.profileVersion ?? 0,
            delegatorExpiresAt: context.scope.delegationExpiresAt?.toISOString() ?? 'POLICY_BOUND',
          },
          now,
        });
        await this.appendAllowedAudit(transaction, context, {
          now,
          action: 'access.assignment.create',
          resourceType: 'access_assignment',
          resourceId: assignment.id,
          reasonCode: 'ACCESS.ASSIGNMENT_CREATED',
          reason: input.reason,
          subjectUserId: assignment.userId,
        });
        return this.assignmentJson(assignment);
      },
    );
  }

  revokeAssignment(
    context: RequestContext,
    key: string,
    assignmentId: string,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    const tenantId = this.requireTenant(context);
    const actorId = this.requireAal2Actor(context);
    return this.idempotency.execute(
      context,
      {
        key,
        operation: `access.assignment.revoke:${assignmentId}`,
        request: asJsonRecord({ assignmentId, reason }),
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const revoked = await this.repository.revokeAssignment(transaction, {
          tenantId,
          assignmentId,
          actorId,
          reason,
          now,
        });
        if (!revoked) throw notFound();
        await this.appendAllowedAudit(transaction, context, {
          now,
          action: 'access.assignment.revoke',
          resourceType: 'access_assignment',
          resourceId: assignmentId,
          reasonCode: 'ACCESS.ASSIGNMENT_REVOKED',
          reason,
        });
        return asJsonRecord({ id: assignmentId, status: 'REVOKED' });
      },
    );
  }

  listAuthorityGrants(context: RequestContext): Promise<readonly AuthorityGrantRecord[]> {
    const actorId = this.requireAal2Actor(context);
    return this.unitOfWork.execute(context, (transaction) =>
      this.repository.listAuthorityGrants(transaction, actorId),
    );
  }

  createAuthorityGrant(
    context: RequestContext,
    key: string,
    input: AuthorityGrantCreationInput,
  ): Promise<IdempotentResult<JsonValue>> {
    const actorId = this.requireAal2Actor(context);
    const authority = context.scope.authority;
    const parentGrantId = context.scope.authorityGrantId;
    if (authority === undefined || parentGrantId === undefined) throw forbidden();
    if (input.subjectUserId === actorId) throw forbidden('ACCESS.SELF_ELEVATION_FORBIDDEN');
    this.requireAuthorityWithinContext(context, input);
    this.requireDelegatedWindow(
      context,
      input.validFrom,
      input.expiresAt,
      this.policy.maximumAuthorityGrantTtlSeconds,
    );
    return this.idempotency.execute(
      context,
      {
        key,
        operation: 'access.authority-grant.create',
        request: this.authorityInputJson(input),
        successStatus: 201,
      },
      async (transaction) => {
        const now = this.clock.now();
        const grant = await this.repository.createAuthorityGrant(transaction, {
          id: this.ids.generate(),
          issuedByUserId: actorId,
          parentGrantId,
          ...input,
          now,
        });
        await this.appendAllowedAudit(transaction, context, {
          now,
          action: 'access.authority-grant.create',
          resourceType: 'authority_grant',
          resourceId: grant.id,
          reasonCode: 'ACCESS.AUTHORITY_GRANT_PENDING_APPROVAL',
          reason: input.humanReason,
          subjectUserId: grant.subjectUserId,
        });
        return this.authorityJson(grant);
      },
    );
  }

  approveAuthorityGrant(
    context: RequestContext,
    key: string,
    grantId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    const actorId = this.requireAal2Actor(context);
    const approvingGrantId = context.scope.authorityGrantId;
    if (approvingGrantId === undefined) throw forbidden();
    const targetedContext = this.withAuthorityTarget(context, grantId);
    return this.idempotency.execute(
      targetedContext,
      {
        key,
        operation: `access.authority-grant.approve:${grantId}`,
        request: asJsonRecord({ grantId, expectedVersion, reason }),
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const grant = await this.repository.findAuthorityGrant(transaction, grantId);
        if (grant === undefined) throw notFound();
        if (grant.status !== 'PENDING_APPROVAL' || grant.version !== expectedVersion) throw stale();
        if (grant.subjectUserId === actorId || grant.issuedByUserId === actorId) {
          throw forbidden('ACCESS.DUAL_CONTROL_REQUIRED');
        }
        this.requireAuthorityWithinContext(targetedContext, grant);
        if (grant.expiresAt.getTime() <= now.getTime()) throw stale();
        const approved = await this.repository.approveAuthorityGrant(transaction, {
          grantId,
          subjectUserId: grant.subjectUserId,
          expectedVersion,
          actorId,
          approvedUnderGrantId: approvingGrantId,
          reason,
          now,
        });
        if (approved === undefined) throw stale();
        await this.appendAllowedAudit(transaction, targetedContext, {
          now,
          action: 'access.authority-grant.approve',
          resourceType: 'authority_grant',
          resourceId: grantId,
          reasonCode: 'ACCESS.AUTHORITY_GRANT_APPROVED',
          reason,
          subjectUserId: approved.subjectUserId,
        });
        return this.authorityJson(approved);
      },
    );
  }

  revokeAuthorityGrant(
    context: RequestContext,
    key: string,
    grantId: string,
    reason: string,
  ): Promise<IdempotentResult<JsonValue>> {
    const actorId = this.requireAal2Actor(context);
    const targetedContext = this.withAuthorityTarget(context, grantId);
    return this.idempotency.execute(
      targetedContext,
      {
        key,
        operation: `access.authority-grant.revoke:${grantId}`,
        request: asJsonRecord({ grantId, reason }),
        successStatus: 200,
      },
      async (transaction) => {
        const now = this.clock.now();
        const grant = await this.repository.findAuthorityGrant(transaction, grantId);
        if (grant === undefined) throw notFound();
        this.requireAuthorityWithinContext(targetedContext, grant);
        const revoked = await this.repository.revokeAuthorityGrant(transaction, {
          grantId,
          actorId,
          reason,
          now,
        });
        if (!revoked) throw notFound();
        await this.appendAllowedAudit(transaction, targetedContext, {
          now,
          action: 'access.authority-grant.revoke',
          resourceType: 'authority_grant',
          resourceId: grantId,
          reasonCode: 'ACCESS.AUTHORITY_GRANT_REVOKED',
          reason,
        });
        return asJsonRecord({ id: grantId, status: 'REVOKED' });
      },
    );
  }

  private requireTenant(context: RequestContext): string {
    if (context.scope.tenantId === undefined) throw forbidden();
    return context.scope.tenantId;
  }

  private requireAal2Actor(context: RequestContext): string {
    if (context.actor?.type !== 'USER') throw forbidden();
    if (
      context.authentication?.assurance !== 'AAL2' ||
      context.authentication.assuranceExpiresAt === undefined ||
      context.authentication.assuranceExpiresAt.getTime() <= this.clock.now().getTime()
    ) {
      throw new ApplicationError({
        code: 'ACCESS.STEP_UP_REQUIRED',
        message: 'Recent multi-factor authentication is required.',
        status: 403,
      });
    }
    return context.actor.id;
  }

  private requireDelegablePermissions(context: RequestContext, requested: readonly string[]): void {
    const effective = new Set(context.authentication?.permissionCodes ?? []);
    if (requested.some((code) => !effective.has(code))) throw forbidden();
  }

  private requireScopeCeiling(context: RequestContext, requested: ScopeCeiling): void {
    const ceiling: ScopeCeiling =
      context.scope.authority?.level === 'PLATFORM'
        ? 'PLATFORM_GRANT'
        : context.scope.authority?.level === 'PROVINCE'
          ? 'PROVINCE_GRANT'
          : context.scope.accessScopeType === 'TENANT'
            ? 'TENANT'
            : 'FACILITY_SET';
    if (scopeRank[requested] > scopeRank[ceiling]) throw forbidden();
  }

  private requireAssignmentScope(
    context: RequestContext,
    scopeType: 'TENANT' | 'FACILITY_SET',
    facilityIds: readonly string[],
  ): void {
    if (scopeType === 'TENANT' && facilityIds.length > 0) throw forbidden();
    if (scopeType === 'FACILITY_SET' && facilityIds.length === 0) throw forbidden();
    if (scopeType === 'TENANT' && context.scope.accessScopeType !== 'TENANT') throw forbidden();
    if (
      context.scope.accessScopeType === 'FACILITY_SET' &&
      facilityIds.some((id) => !context.scope.facilityIds.includes(id))
    ) {
      throw forbidden();
    }
  }

  private requireDelegatedWindow(
    context: RequestContext,
    validFrom: Date,
    expiresAt: Date,
    maximumTtlSeconds: number,
  ): void {
    const now = this.clock.now();
    if (
      !Number.isFinite(validFrom.getTime()) ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= validFrom.getTime() ||
      expiresAt.getTime() <= now.getTime() ||
      expiresAt.getTime() - validFrom.getTime() > maximumTtlSeconds * 1_000 ||
      (context.scope.delegationExpiresAt !== undefined &&
        expiresAt.getTime() > context.scope.delegationExpiresAt.getTime())
    ) {
      throw forbidden('ACCESS.DELEGATION_VALIDITY_EXCEEDED');
    }
  }

  private requireAuthorityWithinContext(
    context: RequestContext,
    requested: AuthorityScopeRequest,
  ): void {
    const authority = context.scope.authority;
    if (authority === undefined) throw forbidden();
    this.requireDelegablePermissions(context, requested.permissionCodes);
    if (requested.permissionCodes.length === 0 || requested.resourceClasses.length === 0) {
      throw forbidden();
    }
    if (
      (requested.level === 'PROVINCE' &&
        (requested.nationalScope || requested.geographicUnitIds.length === 0)) ||
      (requested.nationalScope && requested.geographicUnitIds.length > 0) ||
      (requested.level === 'PLATFORM' && authority.level !== 'PLATFORM') ||
      requested.expiresAt.getTime() > authority.expiresAt.getTime() ||
      requested.resourceClasses.some((value) => !authority.resourceClasses.includes(value)) ||
      (authority.geographicUnitIds.length > 0 &&
        (requested.nationalScope ||
          requested.geographicUnitIds.some(
            (value) => !authority.geographicUnitIds.includes(value),
          ))) ||
      (requested.allowsPii && !authority.allowsPii) ||
      (requested.allowsDocumentContent && !authority.allowsDocumentContent) ||
      (requested.allowsExport && !authority.allowsExport) ||
      (requested.allowsIntervention && !authority.allowsIntervention)
    ) {
      throw forbidden();
    }
  }

  private withAuthorityTarget(context: RequestContext, grantId: string): RequestContext {
    return new ResolvedRequestContext({
      requestId: context.requestId,
      correlationId: context.correlationId,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      source: context.source,
      ...(context.actor === undefined ? {} : { actor: context.actor }),
      ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      ...(context.authentication === undefined
        ? {}
        : {
            authentication: {
              assurance: context.authentication.assurance,
              tokenVersion: context.authentication.tokenVersion,
              ...(context.authentication.assuranceExpiresAt === undefined
                ? {}
                : { assuranceExpiresAt: context.authentication.assuranceExpiresAt }),
              ...(context.authentication.profileVersion === undefined
                ? {}
                : { profileVersion: context.authentication.profileVersion }),
              permissionCodes: context.authentication.permissionCodes,
            },
          }),
      scope: {
        ...(context.scope.tenantId === undefined ? {} : { tenantId: context.scope.tenantId }),
        facilityIds: context.scope.facilityIds,
        ...(context.scope.accessScopeType === undefined
          ? {}
          : { accessScopeType: context.scope.accessScopeType }),
        ...(context.scope.authorityGrantId === undefined
          ? {}
          : { authorityGrantId: context.scope.authorityGrantId }),
        authorityTargetGrantId: grantId,
        ...(context.scope.delegationExpiresAt === undefined
          ? {}
          : { delegationExpiresAt: context.scope.delegationExpiresAt }),
        ...(context.scope.authority === undefined ? {} : { authority: context.scope.authority }),
      },
      ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
      ...(context.spanId === undefined ? {} : { spanId: context.spanId }),
    });
  }

  private appendAllowedAudit(
    transaction: TransactionContext,
    context: RequestContext,
    input: {
      readonly now: Date;
      readonly action: string;
      readonly resourceType: string;
      readonly resourceId: string;
      readonly reasonCode: string;
      readonly reason: string;
      readonly permissionCount?: number;
      readonly roleCount?: number;
      readonly subjectUserId?: string;
    },
  ): Promise<void> {
    const actorId = this.requireAal2Actor(context);
    return this.audit.append(transaction, {
      id: this.ids.generate(),
      occurredAt: input.now,
      ...(context.scope.tenantId === undefined ? {} : { tenantId: context.scope.tenantId }),
      actorType: 'USER',
      actorId,
      ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      ...(context.scope.authorityGrantId === undefined
        ? {}
        : { authorityGrantId: context.scope.authorityGrantId }),
      authenticationAssurance: 'AAL2',
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: 'ALLOWED',
      reasonCode: input.reasonCode,
      correlationId: context.correlationId,
      ...(context.causationId === undefined ? {} : { causationId: context.causationId }),
      ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
      source: context.source,
      safeContext: {
        reason: input.reason,
        ...(input.permissionCount === undefined ? {} : { permissionCount: input.permissionCount }),
        ...(input.roleCount === undefined ? {} : { roleCount: input.roleCount }),
        ...(input.subjectUserId === undefined ? {} : { subjectUserId: input.subjectUserId }),
      },
      retentionClass: 'SECURITY',
    });
  }

  private roleJson(role: RoleRecord): JsonValue {
    return asJsonRecord({
      id: role.id,
      ownerType: role.ownerType,
      tenantId: role.tenantId ?? null,
      name: role.name,
      description: role.description,
      permissionCodes: [...role.permissionCodes],
      version: role.version,
      active: role.active,
    });
  }

  private profileJson(profile: RoleProfileRecord): JsonValue {
    return asJsonRecord({
      id: profile.id,
      ownerType: profile.ownerType,
      tenantId: profile.tenantId ?? null,
      name: profile.name,
      description: profile.description,
      roleIds: [...profile.roleIds],
      permissionCodes: [...profile.permissionCodes],
      scopeCeiling: profile.scopeCeiling,
      version: profile.version,
      active: profile.active,
    });
  }

  private assignmentJson(assignment: AccessAssignmentRecord): JsonValue {
    return asJsonRecord({
      id: assignment.id,
      tenantId: assignment.tenantId,
      userId: assignment.userId,
      roleProfileId: assignment.roleProfileId,
      profileName: assignment.profileName,
      profileVersion: assignment.profileVersion,
      scopeType: assignment.scopeType,
      facilityIds: [...assignment.facilityIds],
      status: assignment.status,
      validFrom: assignment.validFrom.toISOString(),
      validUntil: assignment.validUntil.toISOString(),
      version: assignment.version,
    });
  }

  private authorityJson(grant: AuthorityGrantRecord): JsonValue {
    return asJsonRecord({
      id: grant.id,
      subjectUserId: grant.subjectUserId,
      issuedByUserId: grant.issuedByUserId,
      approvedByUserId: grant.approvedByUserId ?? null,
      parentGrantId: grant.parentGrantId ?? null,
      approvedUnderGrantId: grant.approvedUnderGrantId ?? null,
      roleProfileId: grant.roleProfileId,
      level: grant.level,
      permissionCodes: [...grant.permissionCodes],
      resourceClasses: [...grant.resourceClasses],
      geographicUnitIds: [...grant.geographicUnitIds],
      nationalScope: grant.nationalScope,
      purpose: grant.purpose,
      humanReason: grant.humanReason,
      status: grant.status,
      validFrom: grant.validFrom.toISOString(),
      expiresAt: grant.expiresAt.toISOString(),
      allowsPii: grant.allowsPii,
      allowsDocumentContent: grant.allowsDocumentContent,
      allowsExport: grant.allowsExport,
      allowsIntervention: grant.allowsIntervention,
      version: grant.version,
    });
  }

  private authorityInputJson(input: AuthorityGrantCreationInput): JsonValue {
    return asJsonRecord({
      subjectUserId: input.subjectUserId,
      roleProfileId: input.roleProfileId,
      level: input.level,
      nationalScope: input.nationalScope,
      purpose: input.purpose,
      humanReason: input.humanReason,
      validFrom: input.validFrom.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      permissionCodes: [...input.permissionCodes],
      resourceClasses: [...input.resourceClasses],
      geographicUnitIds: [...input.geographicUnitIds],
      allowsPii: input.allowsPii,
      allowsDocumentContent: input.allowsDocumentContent,
      allowsExport: input.allowsExport,
      allowsIntervention: input.allowsIntervention,
    });
  }
}
