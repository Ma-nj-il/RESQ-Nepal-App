import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { DataSource } from 'typeorm';

import { DispatchRecoveryService } from '../../src/core-dispatch/application/dispatch-recovery.service.js';
import { PostgresCoreDispatchRepository } from '../../src/core-dispatch/infrastructure/persistence/postgres-core-dispatch.repository.js';
import { RequestContext } from '../../src/shared/application/context/request-context.js';
import type { TransactionContext } from '../../src/shared/application/persistence/unit-of-work.js';
import type { ApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';
import type { DatabaseService } from '../../src/shared/infrastructure/persistence/database.service.js';
import { applicationDataSourceOptions } from '../../src/shared/infrastructure/persistence/data-source-options.js';
import {
  entityManagerFor,
  TypeOrmUnitOfWork,
} from '../../src/shared/infrastructure/persistence/typeorm-unit-of-work.js';

interface Fixture {
  readonly bookingId: string;
  readonly tripId?: string;
  readonly requesterUserId: string;
  readonly parties: readonly { readonly driverUserId: string }[];
}
export function dispatchRecoveryCases(harness: {
  config(): ApplicationConfig;
  owner(): Client;
  createUser(): Promise<string>;
  seedDispatchFixture(input: { partyCount: 1 | 2; active: boolean }): Promise<Fixture>;
}): void {
  const context = (id: string): RequestContext =>
    new RequestContext({
      requestId: randomUUID(),
      correlationId: randomUUID(),
      source: 'HTTP',
      actor: { type: 'USER', id },
    });
  async function persistence(work: (unit: TypeOrmUnitOfWork) => Promise<void>): Promise<void> {
    const source = new DataSource(applicationDataSourceOptions(harness.config()));
    await source.initialize();
    try {
      const database = {
        getDataSource: () => Promise.resolve(source),
      } as unknown as DatabaseService;
      await work(new TypeOrmUnitOfWork(database, { generate: randomUUID }));
    } finally {
      await source.destroy();
    }
  }

  it('returns one requester snapshot across concurrent booking and trip commits', async () => {
    const fixture = await harness.seedDispatchFixture({ partyCount: 1, active: true });
    let committed = false;
    class RacingRepository extends PostgresCoreDispatchRepository {
      override async findAssignmentByBooking(
        tx: TransactionContext,
        id: string,
      ): ReturnType<PostgresCoreDispatchRepository['findAssignmentByBooking']> {
        if (!committed) {
          committed = true;
          await persistence(async (writer) => {
            await writer.execute(context(fixture.requesterUserId), async (transaction) => {
              const rows: { result: string }[] = await entityManagerFor(transaction).query(
                `SELECT dispatch.cancel_booking(
                  $1, 4, $2, $3, $4, $5, 'REQUESTER', 'INTEGRATION_POLICY', 'v1',
                  'REQUESTER_CANCELLED', 'Recovery concurrent cancellation', 0, 'NPR'::char(3), true, $6
                ) AS result`,
                [
                  fixture.bookingId,
                  randomUUID(),
                  randomUUID(),
                  randomUUID(),
                  fixture.requesterUserId,
                  randomUUID(),
                ],
              );
              expect(rows[0]?.result).toBe('CANCELLED');
            });
          });
        }
        return super.findAssignmentByBooking(tx, id);
      }
    }
    const original = (
      await harness
        .owner()
        .query<{ version: number }>('SELECT version FROM dispatch.trips WHERE id=$1', [
          fixture.tripId,
        ])
    ).rows[0];
    await persistence(async (unit) => {
      const recovery = new DispatchRecoveryService(new RacingRepository(), unit, {
        now: () => new Date(),
      });
      const snapshot = await recovery.requesterSnapshot(
        context(fixture.requesterUserId),
        fixture.bookingId,
      );
      expect(snapshot.trip?.version).toBe(original?.version);
      const next = await recovery.requesterSnapshot(
        context(fixture.requesterUserId),
        fixture.bookingId,
      );
      expect(next.booking.version).toBe(snapshot.booking.version + 1);
      expect(next.trip?.version).toBe((snapshot.trip?.version ?? 0) + 1);
      expect(snapshot.booking.status).toBe('ACTIVE');
      expect(next.booking.status).toBe('CANCELLED');
      expect(next.trip?.status).toBe('CANCELLED');
      expect(snapshot.trip?.assignmentId).toBe(snapshot.assignment?.id);
    });
  });

  it('denies other requesters and assigned crew the requester-only recovery projection', async () => {
    const fixture = await harness.seedDispatchFixture({ partyCount: 1, active: true });
    const other = await harness.createUser(),
      driver = fixture.parties[0]?.driverUserId;
    if (driver === undefined) throw new Error('Missing fixture driver');
    await persistence(async (unit) => {
      const recovery = new DispatchRecoveryService(new PostgresCoreDispatchRepository(), unit, {
        now: () => new Date(),
      });
      for (const id of [other, driver])
        await expect(
          recovery.requesterSnapshot(context(id), fixture.bookingId),
        ).rejects.toMatchObject({ status: 404 });
    });
  });

  it('enforces read-only snapshots and releases the connection after a rejected write', async () => {
    const userId = await harness.createUser();
    await persistence(async (unit) => {
      await expect(
        unit.execute(
          context(userId),
          (tx) =>
            entityManagerFor(tx).query(
              'UPDATE identity.users SET token_version=token_version+1 WHERE id=$1',
              [userId],
            ),
          'READ_ONLY_SNAPSHOT',
        ),
      ).rejects.toMatchObject({ code: '25006' });
      await unit.execute(context(userId), async (tx) => {
        expect(await entityManagerFor(tx).query('SHOW transaction_read_only')).toEqual([
          { transaction_read_only: 'off' },
        ]);
      });
    });
  });
}
