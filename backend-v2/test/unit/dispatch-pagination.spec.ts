import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DispatchListQueryDto } from '../../src/core-dispatch/presentation/http/core-dispatch.dto.js';
import { dispatchPage } from '../../src/core-dispatch/presentation/http/core-dispatch.projections.js';

describe('dispatch keyset contract', () => {
  it('returns a continuation from the last visible item without exposing lookahead content', () => {
    const records = Array.from({ length: 51 }, (_, index) => ({
      id: `row-${String(index)}`,
      private: 'not-for-client',
    }));
    const result = dispatchPage(records, (record) => ({ id: record.id }));
    expect(result).toEqual({
      items: records.slice(0, 50).map(({ id }) => ({ id })),
      nextCursor: 'row-49',
    });
    expect(JSON.stringify(result)).not.toContain('not-for-client');
    expect(JSON.stringify(result)).not.toContain('row-50');
  });

  it('distinguishes a final page from a full page with a known successor', () => {
    expect(dispatchPage<{ id: string }>([], (record) => ({ id: record.id }))).toEqual({
      items: [],
      nextCursor: null,
    });
    const records = Array.from({ length: 50 }, (_, index) => ({ id: `row-${String(index)}` }));
    expect(dispatchPage(records, (record) => ({ id: record.id }))).toEqual({
      items: records,
      nextCursor: null,
    });
  });

  it('rejects malformed or repeated cursors before they reach PostgreSQL', async () => {
    for (const afterId of [
      'invalid',
      "'; DROP TABLE dispatch.bookings; --",
      ['00000000-0000-4000-8000-000000000001'],
    ]) {
      expect(await validate(plainToInstance(DispatchListQueryDto, { afterId }))).not.toHaveLength(
        0,
      );
    }
    expect(
      await validate(
        plainToInstance(DispatchListQueryDto, { afterId: '00000000-0000-4000-8000-000000000001' }),
      ),
    ).toHaveLength(0);
  });
});
