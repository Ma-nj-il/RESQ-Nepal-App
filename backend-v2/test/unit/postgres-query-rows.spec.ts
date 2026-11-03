import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import { queryRows } from '../../src/shared/infrastructure/persistence/query-rows.js';

describe('installed TypeORM PostgreSQL result contract', () => {
  // Keep the actual driver/query runner. Only the pg wire response is synthetic.
  it.each(['UPDATE', 'DELETE'])(
    'distinguishes zero, one and many %s RETURNING rows',
    async (command) => {
      const source = new DataSource({ type: 'postgres' });
      const runner = source.createQueryRunner();
      const wire = { query: jest.fn<() => Promise<unknown>>() };
      jest.spyOn(runner, 'connect').mockResolvedValue(wire);
      await runner.startTransaction();
      for (const rows of [[], [{ id: 'one' }], [{ id: 'one' }, { id: 'two' }]]) {
        wire.query.mockResolvedValue({ command, rows, rowCount: rows.length });
        expect(await runner.manager.query(`${command} synthetic RETURNING id`)).toEqual([
          rows,
          rows.length,
        ]);
        expect(await queryRows(runner.manager, `${command} synthetic RETURNING id`, [])).toEqual(
          rows,
        );
      }
    },
  );

  it('requires the transaction-bound runner', async () => {
    const source = new DataSource({ type: 'postgres' });
    await expect(queryRows(source.manager, 'UPDATE synthetic RETURNING id', [])).rejects.toThrow(
      'active transaction',
    );
    await expect(
      queryRows(source.createQueryRunner().manager, 'UPDATE synthetic RETURNING id', []),
    ).rejects.toThrow('active transaction');
  });
});
