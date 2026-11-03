import type { EntityManager, QueryResult } from 'typeorm';

/** PostgreSQL raw UPDATE/DELETE results are [rows, count], unlike SELECT/INSERT.
 * Use the transaction's structured result whenever callers consume RETURNING rows.
 */
export async function queryRows<Row>(
  manager: EntityManager,
  sql: string,
  parameters: readonly unknown[],
): Promise<Row[]> {
  const runner = manager.queryRunner;
  if (runner === undefined || !runner.isTransactionActive) {
    throw new Error('Returning-row queries require an active transaction');
  }
  const result: QueryResult = await runner.query(sql, [...parameters], true);
  return result.records as Row[];
}
