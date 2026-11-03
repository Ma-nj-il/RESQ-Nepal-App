export type RequestSource = 'HTTP' | 'JOB' | 'EVENT' | 'SYSTEM';

export interface RequestActor {
  readonly type: 'USER' | 'WORKLOAD' | 'SYSTEM_POLICY';
  readonly id: string;
}

export interface RequestScope {
  readonly tenantId?: string;
  readonly facilityIds: readonly string[];
  readonly accessScopeType?: 'TENANT' | 'FACILITY_SET';
  readonly authorityGrantId?: string;
  /** Server-resolved target used to constrain authority administration RLS. */
  readonly authorityTargetGrantId?: string;
  readonly delegationExpiresAt?: Date;
  readonly authority?: {
    readonly level: 'PROVINCE' | 'PLATFORM';
    readonly resourceClasses: readonly string[];
    readonly geographicUnitIds: readonly string[];
    readonly allowsPii: boolean;
    readonly allowsDocumentContent: boolean;
    readonly allowsExport: boolean;
    readonly allowsIntervention: boolean;
    readonly expiresAt: Date;
  };
}

interface ResolvedRequestScope {
  readonly tenantId: string | undefined;
  readonly facilityIds: readonly string[];
  readonly accessScopeType: 'TENANT' | 'FACILITY_SET' | undefined;
  readonly authorityGrantId: string | undefined;
  readonly authorityTargetGrantId: string | undefined;
  readonly delegationExpiresAt: Date | undefined;
  readonly authority:
    | Readonly<{
        level: 'PROVINCE' | 'PLATFORM';
        resourceClasses: readonly string[];
        geographicUnitIds: readonly string[];
        allowsPii: boolean;
        allowsDocumentContent: boolean;
        allowsExport: boolean;
        allowsIntervention: boolean;
        expiresAt: Date;
      }>
    | undefined;
}

export interface RequestContextValues {
  readonly requestId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly source: RequestSource;
  readonly actor?: RequestActor;
  readonly sessionId?: string;
  readonly authentication?: {
    readonly assurance: 'AAL1' | 'AAL2';
    readonly tokenVersion: number;
    readonly assuranceExpiresAt?: Date;
    readonly profileVersion?: number;
    readonly permissionCodes?: readonly string[];
  };
  readonly scope?: Partial<RequestScope>;
  readonly traceId?: string;
  readonly spanId?: string;
}

export class RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly causationId: string | undefined;
  readonly source: RequestSource;
  readonly actor: Readonly<RequestActor> | undefined;
  readonly sessionId: string | undefined;
  readonly authentication:
    | Readonly<{
        assurance: 'AAL1' | 'AAL2';
        tokenVersion: number;
        assuranceExpiresAt: Date | undefined;
        profileVersion: number | undefined;
        permissionCodes: readonly string[];
      }>
    | undefined;
  readonly scope: Readonly<ResolvedRequestScope>;
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;

  constructor(values: RequestContextValues) {
    this.requestId = values.requestId;
    this.correlationId = values.correlationId;
    this.causationId = values.causationId;
    this.source = values.source;
    this.actor = values.actor === undefined ? undefined : Object.freeze({ ...values.actor });
    this.sessionId = values.sessionId;
    this.authentication =
      values.authentication === undefined
        ? undefined
        : Object.freeze({
            assurance: values.authentication.assurance,
            tokenVersion: values.authentication.tokenVersion,
            assuranceExpiresAt:
              values.authentication.assuranceExpiresAt === undefined
                ? undefined
                : new Date(values.authentication.assuranceExpiresAt),
            profileVersion: values.authentication.profileVersion,
            permissionCodes: Object.freeze([...(values.authentication.permissionCodes ?? [])]),
          });
    this.scope = Object.freeze({
      tenantId: values.scope?.tenantId,
      facilityIds: Object.freeze([...(values.scope?.facilityIds ?? [])]),
      accessScopeType: values.scope?.accessScopeType,
      authorityGrantId: values.scope?.authorityGrantId,
      authorityTargetGrantId: values.scope?.authorityTargetGrantId,
      delegationExpiresAt:
        values.scope?.delegationExpiresAt === undefined
          ? undefined
          : new Date(values.scope.delegationExpiresAt),
      authority:
        values.scope?.authority === undefined
          ? undefined
          : Object.freeze({
              ...values.scope.authority,
              expiresAt: new Date(values.scope.authority.expiresAt),
              resourceClasses: Object.freeze([...values.scope.authority.resourceClasses]),
              geographicUnitIds: Object.freeze([...values.scope.authority.geographicUnitIds]),
            }),
    });
    this.traceId = values.traceId;
    this.spanId = values.spanId;
    Object.freeze(this);
  }
}
