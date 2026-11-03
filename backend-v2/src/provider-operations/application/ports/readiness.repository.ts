import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';

export interface ReadinessChange {
  readonly ambulanceId: string;
  readonly tenantId: string;
  readonly facilityId: string;
  readonly version: number;
  readonly status: 'READY' | 'BLOCKED';
  readonly reasons: readonly string[];
}

export interface ReadinessRepository {
  recalculate(
    transaction: TransactionContext,
    resourceId: string,
    version: number,
  ): Promise<readonly ReadinessChange[]>;
}
