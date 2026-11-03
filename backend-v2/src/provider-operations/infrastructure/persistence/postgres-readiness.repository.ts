import { Injectable } from '@nestjs/common';

import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';
import { entityManagerFor } from '../../../shared/infrastructure/persistence/typeorm-unit-of-work.js';
import type {
  ReadinessChange,
  ReadinessRepository,
} from '../../application/ports/readiness.repository.js';

@Injectable()
export class PostgresReadinessRepository implements ReadinessRepository {
  async recalculate(
    transaction: TransactionContext,
    resourceId: string,
    version: number,
  ): Promise<readonly ReadinessChange[]> {
    const rows: {
      ambulance_id: string;
      tenant_id: string;
      facility_id: string;
      readiness_version: number;
      readiness_status: 'READY' | 'BLOCKED';
      readiness_reasons: string[];
    }[] = await entityManagerFor(transaction).query(
      'SELECT * FROM documents.refresh_worker_readiness($1,$2)',
      [resourceId, version],
    );
    return rows.map((row) => ({
      ambulanceId: row.ambulance_id,
      tenantId: row.tenant_id,
      facilityId: row.facility_id,
      version: row.readiness_version,
      status: row.readiness_status,
      reasons: row.readiness_reasons,
    }));
  }
}
