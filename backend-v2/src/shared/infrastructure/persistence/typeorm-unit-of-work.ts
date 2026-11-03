import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { RequestContext } from '../../application/context/request-context.js';
import type { TransactionContext, UnitOfWork } from '../../application/persistence/unit-of-work.js';
import { ID_GENERATOR, type IdGenerator } from '../../domain/id-generator.js';
import { DatabaseService } from './database.service.js';

class TypeOrmTransactionContext implements TransactionContext {
  constructor(
    readonly transactionId: string,
    readonly manager: EntityManager,
  ) {}
}

export function entityManagerFor(transaction: TransactionContext): EntityManager {
  if (!(transaction instanceof TypeOrmTransactionContext)) {
    throw new Error('Transaction context was not created by TypeOrmUnitOfWork');
  }
  return transaction.manager;
}

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute<T>(
    requestContext: RequestContext,
    work: (transaction: TransactionContext) => Promise<T>,
  ): Promise<T> {
    const dataSource = await this.database.getDataSource();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('READ COMMITTED');

    try {
      await this.applyRequestClaims(runner.manager, requestContext);
      const transaction = new TypeOrmTransactionContext(this.ids.generate(), runner.manager);
      const result = await work(transaction);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  private async applyRequestClaims(manager: EntityManager, context: RequestContext): Promise<void> {
    const claims: ReadonlyArray<readonly [string, string]> = [
      ['app.user_id', context.actor?.type === 'USER' ? context.actor.id : ''],
      ['app.session_id', context.sessionId ?? ''],
      ['app.tenant_id', context.scope.tenantId ?? ''],
      ['app.facility_scope', JSON.stringify(context.scope.facilityIds)],
      ['app.authority_grant_id', context.scope.authorityGrantId ?? ''],
      ['app.correlation_id', context.correlationId],
    ];

    for (const [name, value] of claims) {
      await manager.query('SELECT set_config($1, $2, true)', [name, value]);
    }
  }
}
