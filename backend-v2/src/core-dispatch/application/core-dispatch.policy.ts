export interface CoreDispatchPolicy {
  readonly quoteTtlMs: number;
  readonly searchTtlMs: number;
  readonly offerTtlMs: number;
  readonly trackingStaleAfterMs: number;
  readonly trackingUnavailableAfterMs: number;
  readonly firstSafetyEscalationDelayMs: number;
  readonly subsequentSafetyEscalationDelayMs: number;
}

export const CORE_DISPATCH_POLICY = Symbol('CORE_DISPATCH_POLICY');
