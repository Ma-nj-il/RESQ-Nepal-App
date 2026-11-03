import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type { JsonValue } from '../../shared/application/idempotency/idempotency.js';
import type { TransactionContext } from '../../shared/application/persistence/unit-of-work.js';
import { entityManagerFor } from '../../shared/infrastructure/persistence/typeorm-unit-of-work.js';
import type {
  MessageRecord,
  ProductCommand,
  ProductRepository,
  ProductResult,
} from '../application/ports/product.repository.js';

const TICKET_PROJECTION = `jsonb_build_object('id',id,'tripId',trip_id,'category',category,
  'status',status,'version',version,'resolutionCode',resolution_code,'createdAt',created_at,'updatedAt',updated_at)`;

@Injectable()
export class PostgresProductRepository implements ProductRepository {
  async command(tx: TransactionContext, command: ProductCommand): Promise<ProductResult> {
    const manager = entityManagerFor(tx);
    const run = async (sql: string, parameters: unknown[]): Promise<ProductResult> => {
      const rows: { result: ProductResult }[] = await manager.query(sql, parameters);
      if (rows[0] === undefined) throw new Error('Product command returned no result');
      return rows[0].result;
    };
    switch (command.kind) {
      case 'PREFERENCES':
        return run('SELECT product.replace_preferences($1,$2,$3,$4,$5,$6) AS result', [
          command.version,
          command.preferences.bookingUpdates,
          command.preferences.tripUpdates,
          command.preferences.supportUpdates,
          command.preferences.marketing,
          command.factId,
        ]);
      case 'RATING':
        return run('SELECT product.rate_trip($1,$2,$3,$4::smallint) AS result', [
          command.id,
          command.tripId,
          command.version,
          command.score,
        ]);
      case 'CASH':
        return run('SELECT product.record_cash($1,$2,$3,$4::bigint) AS result', [
          command.id,
          command.tripId,
          command.version,
          command.amountMinor,
        ]);
      case 'TICKET':
        return run('SELECT product.create_ticket($1,$2,$3,$4,$5,$6,$7,$8) AS result', [
          command.id,
          command.tripId ?? null,
          command.category,
          command.messageId,
          command.content.ciphertext,
          command.content.nonce,
          command.content.tag,
          command.content.keyVersion,
        ]);
      case 'REPLY':
        return run('SELECT product.reply_ticket($1,$2,$3,$4,$5,$6,$7) AS result', [
          command.ticketId,
          command.version,
          command.messageId,
          command.content.ciphertext,
          command.content.nonce,
          command.content.tag,
          command.content.keyVersion,
        ]);
      case 'TRANSITION':
        return run('SELECT product.transition_ticket($1,$2,$3,$4,$5) AS result', [
          command.ticketId,
          command.version,
          command.action,
          command.resolutionCode ?? null,
          command.factId,
        ]);
    }
  }

  async preferences(tx: TransactionContext): Promise<JsonValue> {
    const rows = await this.jsonRows(
      tx,
      `SELECT jsonb_build_object('bookingUpdates',booking_updates,
      'tripUpdates',trip_updates,'supportUpdates',support_updates,'marketing',marketing,'version',version) AS data
      FROM product.notification_preferences WHERE user_id=governance.current_setting_uuid('app.user_id')`,
      [],
    );
    return (
      rows[0] ?? {
        bookingUpdates: true,
        tripUpdates: true,
        supportUpdates: true,
        marketing: false,
        version: 0,
      }
    );
  }

  async ticket(tx: TransactionContext, id: string): Promise<JsonValue | undefined> {
    return (
      await this.jsonRows(
        tx,
        `SELECT ${TICKET_PROJECTION} AS data FROM product.support_tickets WHERE id=$1`,
        [id],
      )
    )[0];
  }

  tickets(tx: TransactionContext, afterId?: string): Promise<JsonValue[]> {
    return this.jsonRows(
      tx,
      `SELECT ${TICKET_PROJECTION} AS data FROM product.support_tickets
      WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT 51`,
      [afterId ?? null],
    );
  }

  async messages(
    tx: TransactionContext,
    ticketId: string,
    factId: string,
    afterId?: string,
  ): Promise<MessageRecord[]> {
    const audit: { allowed: boolean }[] = await entityManagerFor(tx).query(
      'SELECT product.audit_ticket_content($1,$2) AS allowed',
      [ticketId, factId],
    );
    if (audit[0]?.allowed !== true)
      throw new ApplicationError({
        code: 'RESOURCE.NOT_FOUND',
        message: 'The requested resource was not found.',
        status: 404,
      });
    const rows: {
      id: string;
      ticket_id: string;
      author_user_id: string;
      ciphertext: Buffer;
      nonce: Buffer;
      tag: Buffer;
      key_version: string;
      created_at: Date;
    }[] = await entityManagerFor(tx).query(
      `SELECT id,ticket_id,author_user_id,ciphertext,nonce,tag,key_version,created_at FROM product.support_messages
       WHERE ticket_id=$1 AND ($2::uuid IS NULL OR id > $2) ORDER BY id LIMIT 51`,
      [ticketId, afterId ?? null],
    );
    return rows.map((row) => ({
      id: row.id,
      ticketId: row.ticket_id,
      authorUserId: row.author_user_id,
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      tag: row.tag,
      keyVersion: row.key_version,
      createdAt: row.created_at,
    }));
  }

  notifications(tx: TransactionContext, afterId?: string): Promise<JsonValue[]> {
    return this.jsonRows(
      tx,
      `SELECT jsonb_build_object('id',id,'kind',kind,'resourceId',resource_id,
      'resourceVersion',resource_version,'read',read_at IS NOT NULL,'createdAt',created_at) AS data
      FROM product.notifications WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT 51`,
      [afterId ?? null],
    );
  }

  async markRead(tx: TransactionContext, id: string, factId: string): Promise<boolean> {
    const rows: { result: boolean }[] = await entityManagerFor(tx).query(
      'SELECT product.mark_notification_read($1,$2) AS result',
      [id, factId],
    );
    return rows[0]?.result === true;
  }

  async receipt(tx: TransactionContext, tripId: string): Promise<JsonValue | undefined> {
    return (
      await this.jsonRows(
        tx,
        `SELECT jsonb_build_object('tripId',trip.id,'bookingId',trip.booking_id,
      'fare',jsonb_build_object('amountMinor',trip.final_fare_minor::text,'currency',trip.final_fare_currency),
      'fareProvenance',trip.final_fare_provenance,'paymentMethod','CASH',
      'collectionStatus',CASE WHEN cash.id IS NULL THEN 'UNRECORDED' ELSE 'RECORDED' END,
      'collectionId',cash.id,'completedAt',trip.completed_at,'version',trip.version) AS data
      FROM dispatch.trips trip LEFT JOIN product.cash_collections cash ON cash.trip_id=trip.id
      WHERE trip.id=$1 AND trip.status='COMPLETED'
        AND trip.requester_user_id=governance.current_setting_uuid('app.user_id')`,
        [tripId],
      )
    )[0];
  }

  cashSummary(tx: TransactionContext, from: Date, to: Date): Promise<JsonValue[]> {
    return this.jsonRows(
      tx,
      `SELECT jsonb_build_object('facilityId',facility_id,
      'completedTrips',completed_trips::text,'recordedTrips',recorded_trips::text,
      'fareMinor',fare_minor::text,'recordedMinor',recorded_minor::text,'unrecordedMinor',unrecorded_minor::text) AS data
      FROM product.cash_summary($1,$2)`,
      [from, to],
    );
  }

  private async jsonRows(
    tx: TransactionContext,
    sql: string,
    parameters: unknown[],
  ): Promise<JsonValue[]> {
    const rows: { data: JsonValue }[] = await entityManagerFor(tx).query(sql, parameters);
    return rows.map((row) => row.data);
  }
}
