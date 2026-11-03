import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import type { AccessScopeType } from '../../domain/authorization.js';

export interface PermissionCatalogItem {
  readonly code: string;
  readonly description: string;
  readonly resource: string;
  readonly action: string;
  readonly riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface RoleRecord {
  readonly id: string;
  readonly ownerType: 'SYSTEM' | 'TENANT';
  readonly tenantId?: string;
  readonly name: string;
  readonly description: string;
  readonly permissionCodes: readonly string[];
  readonly version: number;
  readonly active: boolean;
}

export interface RoleProfileRecord {
  readonly id: string;
  readonly ownerType: 'SYSTEM' | 'TENANT';
  readonly tenantId?: string;
  readonly name: string;
  readonly description: string;
  readonly roleIds: readonly string[];
  readonly permissionCodes: readonly string[];
  readonly scopeCeiling:
    'SELF' | 'ASSIGNED_TRIP' | 'FACILITY_SET' | 'TENANT' | 'PROVINCE_GRANT' | 'PLATFORM_GRANT';
  readonly version: number;
  readonly active: boolean;
}

export interface AccessAssignmentRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly roleProfileId: string;
  readonly profileName: string;
  readonly profileVersion: number;
  readonly scopeType: AccessScopeType;
  readonly facilityIds: readonly string[];
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';
  readonly validFrom: Date;
  readonly validUntil: Date;
  readonly version: number;
}

export interface AuthorityGrantRecord {
  readonly id: string;
  readonly subjectUserId: string;
  readonly issuedByUserId: string;
  readonly approvedByUserId?: string;
  /** Absent only for the operationally bootstrapped root grant. */
  readonly parentGrantId?: string;
  readonly approvedUnderGrantId?: string;
  readonly roleProfileId: string;
  readonly level: 'PROVINCE' | 'PLATFORM';
  readonly permissionCodes: readonly string[];
  readonly resourceClasses: readonly string[];
  readonly geographicUnitIds: readonly string[];
  readonly nationalScope: boolean;
  readonly purpose: string;
  readonly humanReason: string;
  readonly status: 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';
  readonly validFrom: Date;
  readonly expiresAt: Date;
  readonly allowsPii: boolean;
  readonly allowsDocumentContent: boolean;
  readonly allowsExport: boolean;
  readonly allowsIntervention: boolean;
  readonly version: number;
}

export interface AccessAdministrationRepository {
  listPermissionCatalog(
    transaction: TransactionContext,
    allowedCodes: readonly string[],
  ): Promise<readonly PermissionCatalogItem[]>;
  listRoles(transaction: TransactionContext, tenantId: string): Promise<readonly RoleRecord[]>;
  findRole(
    transaction: TransactionContext,
    tenantId: string,
    roleId: string,
  ): Promise<RoleRecord | undefined>;
  createRole(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly tenantId: string;
      readonly actorId: string;
      readonly name: string;
      readonly description: string;
      readonly permissionCodes: readonly string[];
      readonly now: Date;
    },
  ): Promise<RoleRecord>;
  updateRole(
    transaction: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly roleId: string;
      readonly expectedVersion: number;
      readonly name: string;
      readonly description: string;
      readonly permissionCodes: readonly string[];
      readonly now: Date;
    },
  ): Promise<RoleRecord | undefined>;
  retireRole(
    transaction: TransactionContext,
    tenantId: string,
    roleId: string,
    expectedVersion: number,
    now: Date,
  ): Promise<boolean>;
  listRoleProfiles(
    transaction: TransactionContext,
    tenantId: string,
  ): Promise<readonly RoleProfileRecord[]>;
  findRoleProfile(
    transaction: TransactionContext,
    tenantId: string,
    profileId: string,
  ): Promise<RoleProfileRecord | undefined>;
  permissionsForRoles(
    transaction: TransactionContext,
    tenantId: string,
    roleIds: readonly string[],
  ): Promise<readonly string[]>;
  createRoleProfile(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly tenantId: string;
      readonly actorId: string;
      readonly name: string;
      readonly description: string;
      readonly scopeCeiling: RoleProfileRecord['scopeCeiling'];
      readonly roleIds: readonly string[];
      readonly now: Date;
    },
  ): Promise<RoleProfileRecord>;
  updateRoleProfile(
    transaction: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly profileId: string;
      readonly expectedVersion: number;
      readonly name: string;
      readonly description: string;
      readonly scopeCeiling: RoleProfileRecord['scopeCeiling'];
      readonly roleIds: readonly string[];
      readonly now: Date;
    },
  ): Promise<RoleProfileRecord | undefined>;
  retireRoleProfile(
    transaction: TransactionContext,
    tenantId: string,
    profileId: string,
    expectedVersion: number,
    now: Date,
  ): Promise<boolean>;
  listAssignments(
    transaction: TransactionContext,
    tenantId: string,
  ): Promise<readonly AccessAssignmentRecord[]>;
  findAssignment(
    transaction: TransactionContext,
    tenantId: string,
    assignmentId: string,
  ): Promise<AccessAssignmentRecord | undefined>;
  createAssignment(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly tenantId: string;
      readonly userId: string;
      readonly roleProfileId: string;
      readonly scopeType: AccessScopeType;
      readonly facilityIds: readonly string[];
      readonly validFrom: Date;
      readonly validUntil: Date;
      readonly grantedBy: string;
      readonly delegationEvidence: Readonly<Record<string, string | number | boolean>>;
      readonly now: Date;
    },
  ): Promise<AccessAssignmentRecord>;
  revokeAssignment(
    transaction: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly assignmentId: string;
      readonly actorId: string;
      readonly reason: string;
      readonly now: Date;
    },
  ): Promise<boolean>;
  listAuthorityGrants(
    transaction: TransactionContext,
    actorId: string,
  ): Promise<readonly AuthorityGrantRecord[]>;
  createAuthorityGrant(
    transaction: TransactionContext,
    input: {
      readonly id: string;
      readonly subjectUserId: string;
      readonly issuedByUserId: string;
      readonly parentGrantId: string;
      readonly roleProfileId: string;
      readonly level: 'PROVINCE' | 'PLATFORM';
      readonly nationalScope: boolean;
      readonly purpose: string;
      readonly humanReason: string;
      readonly validFrom: Date;
      readonly expiresAt: Date;
      readonly permissionCodes: readonly string[];
      readonly resourceClasses: readonly string[];
      readonly geographicUnitIds: readonly string[];
      readonly allowsPii: boolean;
      readonly allowsDocumentContent: boolean;
      readonly allowsExport: boolean;
      readonly allowsIntervention: boolean;
      readonly now: Date;
    },
  ): Promise<AuthorityGrantRecord>;
  findAuthorityGrant(
    transaction: TransactionContext,
    grantId: string,
  ): Promise<AuthorityGrantRecord | undefined>;
  approveAuthorityGrant(
    transaction: TransactionContext,
    input: {
      readonly grantId: string;
      readonly subjectUserId: string;
      readonly expectedVersion: number;
      readonly actorId: string;
      readonly approvedUnderGrantId: string;
      readonly reason: string;
      readonly now: Date;
    },
  ): Promise<AuthorityGrantRecord | undefined>;
  revokeAuthorityGrant(
    transaction: TransactionContext,
    input: {
      readonly grantId: string;
      readonly actorId: string;
      readonly reason: string;
      readonly now: Date;
    },
  ): Promise<boolean>;
}

export const ACCESS_ADMINISTRATION_REPOSITORY = Symbol('ACCESS_ADMINISTRATION_REPOSITORY');
