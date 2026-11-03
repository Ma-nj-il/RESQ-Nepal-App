import type { AuthenticationAssurance } from './authentication.js';

export const ACCESS_SCOPE_TYPES = ['TENANT', 'FACILITY_SET'] as const;
export type AccessScopeType = (typeof ACCESS_SCOPE_TYPES)[number];

export interface SessionAuthorizationState {
  readonly userId: string;
  readonly userStatus: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  readonly userTokenVersion: number;
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly assurance: AuthenticationAssurance;
  readonly assuranceExpiresAt?: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt?: Date;
  readonly riskBlockedAt?: Date;
}

export interface TenantAuthorizationContext {
  readonly assignmentId: string;
  readonly tenantId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly scopeType: AccessScopeType;
  readonly facilityIds: readonly string[];
  readonly permissionCodes: ReadonlySet<string>;
  readonly validUntil: Date;
}

export interface AuthorityAuthorizationContext {
  readonly grantId: string;
  readonly level: 'PROVINCE' | 'PLATFORM';
  readonly permissionCodes: ReadonlySet<string>;
  readonly resourceClasses: ReadonlySet<string>;
  readonly geographicUnitIds: readonly string[];
  readonly purpose: string;
  readonly allowsPii: boolean;
  readonly allowsDocumentContent: boolean;
  readonly allowsExport: boolean;
  readonly allowsIntervention: boolean;
  readonly requiredAssurance: AuthenticationAssurance;
  readonly expiresAt: Date;
}
