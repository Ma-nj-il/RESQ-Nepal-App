export const REALTIME_READINESS = Symbol('REALTIME_READINESS');
export interface RealtimeReadiness {
  ready(): boolean;
}
