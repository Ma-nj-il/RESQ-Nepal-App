import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import type {
  AuthorityAuthorizationContext,
  TenantAuthorizationContext,
} from '../../domain/authorization.js';

export interface PrincipalProfile {
  readonly id: string;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  readonly displayName?: string;
  readonly phoneMasked?: string;
  readonly locale: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AccessContextSummary {
  readonly tenantAssignments: readonly {
    readonly assignmentId: string;
    readonly tenantId: string;
    readonly tenantName: string;
    readonly profileId: string;
    readonly profileName: string;
    readonly profileVersion: number;
    readonly scopeType: 'TENANT' | 'FACILITY_SET';
    readonly facilityIds: readonly string[];
    readonly validUntil: Date;
  }[];
  readonly authorityGrants: readonly {
    readonly grantId: string;
    readonly level: 'PROVINCE' | 'PLATFORM';
    readonly purpose: string;
    readonly expiresAt: Date;
  }[];
}

export interface AuthorizationRepository {
  resolveTenantContext(
    transaction: TransactionContext,
    userId: string,
    tenantId: string,
    now: Date,
  ): Promise<TenantAuthorizationContext | undefined>;
  facilityBelongsToTenant(
    transaction: TransactionContext,
    userId: string,
    tenantId: string,
    facilityId: string,
    now: Date,
  ): Promise<boolean>;
  resolveAuthorityContext(
    transaction: TransactionContext,
    userId: string,
    grantId: string,
    now: Date,
  ): Promise<AuthorityAuthorizationContext | undefined>;
  findPrincipalProfile(
    transaction: TransactionContext,
    userId: string,
  ): Promise<PrincipalProfile | undefined>;
  listAccessContexts(
    transaction: TransactionContext,
    userId: string,
    now: Date,
  ): Promise<AccessContextSummary>;
}

export const AUTHORIZATION_REPOSITORY = Symbol('AUTHORIZATION_REPOSITORY');
