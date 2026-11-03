export interface AccessAdministrationPolicy {
  readonly maximumDelegatedAssignmentTtlSeconds: number;
  readonly maximumAuthorityGrantTtlSeconds: number;
}

export const ACCESS_ADMINISTRATION_POLICY = Symbol('ACCESS_ADMINISTRATION_POLICY');
