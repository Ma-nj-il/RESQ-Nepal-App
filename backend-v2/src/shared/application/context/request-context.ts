export type RequestSource = 'HTTP' | 'JOB' | 'EVENT' | 'SYSTEM';

export interface RequestActor {
  readonly type: 'USER' | 'WORKLOAD' | 'SYSTEM_POLICY';
  readonly id: string;
}

export interface RequestScope {
  readonly tenantId?: string;
  readonly facilityIds: readonly string[];
  readonly authorityGrantId?: string;
}

interface ResolvedRequestScope {
  readonly tenantId: string | undefined;
  readonly facilityIds: readonly string[];
  readonly authorityGrantId: string | undefined;
}

export interface RequestContextValues {
  readonly requestId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly source: RequestSource;
  readonly actor?: RequestActor;
  readonly sessionId?: string;
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
    this.scope = Object.freeze({
      tenantId: values.scope?.tenantId,
      facilityIds: Object.freeze([...(values.scope?.facilityIds ?? [])]),
      authorityGrantId: values.scope?.authorityGrantId,
    });
    this.traceId = values.traceId;
    this.spanId = values.spanId;
    Object.freeze(this);
  }
}
