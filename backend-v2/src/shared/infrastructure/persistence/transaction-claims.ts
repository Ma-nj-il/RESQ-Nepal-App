import type { EntityManager } from 'typeorm';

/** Applies a transaction-local, parameterized database claim used by narrowly scoped RLS policies. */
export async function setTransactionClaim(
  manager: EntityManager,
  name: string,
  value: string | undefined,
): Promise<void> {
  await manager.query('SELECT set_config($1, $2, true)', [name, value ?? '']);
}
