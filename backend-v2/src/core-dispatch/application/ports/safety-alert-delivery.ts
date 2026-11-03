export interface SafetyAlertDelivery {
  deliver(input: {
    readonly incidentId: string;
    readonly tenantId?: string;
    readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    readonly escalationTier: number;
    readonly jobIntentId: string;
  }): Promise<void>;
}

export const SAFETY_ALERT_DELIVERY = Symbol('SAFETY_ALERT_DELIVERY');
