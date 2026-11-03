import type { JsonValue } from '../../../shared/application/idempotency/idempotency.js';
import type { TransactionContext } from '../../../shared/application/persistence/unit-of-work.js';

export interface ProtectedContent {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly keyVersion: string;
}

export interface ContentProtector {
  protect(messageId: string, ticketId: string, text: string): ProtectedContent;
  reveal(messageId: string, ticketId: string, content: ProtectedContent): string;
}

export interface Preferences {
  readonly bookingUpdates: boolean;
  readonly tripUpdates: boolean;
  readonly supportUpdates: boolean;
  readonly marketing: boolean;
}

export type ProductCommand =
  | {
      readonly kind: 'PREFERENCES';
      readonly version: number;
      readonly preferences: Preferences;
      readonly factId: string;
    }
  | {
      readonly kind: 'RATING';
      readonly id: string;
      readonly tripId: string;
      readonly version: number;
      readonly score: number;
    }
  | {
      readonly kind: 'CASH';
      readonly id: string;
      readonly tripId: string;
      readonly version: number;
      readonly amountMinor: string;
    }
  | {
      readonly kind: 'TICKET';
      readonly id: string;
      readonly tripId?: string;
      readonly category: string;
      readonly messageId: string;
      readonly content: ProtectedContent;
    }
  | {
      readonly kind: 'REPLY';
      readonly ticketId: string;
      readonly version: number;
      readonly messageId: string;
      readonly content: ProtectedContent;
    }
  | {
      readonly kind: 'TRANSITION';
      readonly ticketId: string;
      readonly version: number;
      readonly action: 'START' | 'RESOLVE';
      readonly resolutionCode?: string;
      readonly factId: string;
    };

export type ProductResult =
  | 'OK'
  | 'NOT_FOUND'
  | 'STALE_VERSION'
  | 'INVALID_STATE'
  | 'ALREADY_RECORDED'
  | 'AMOUNT_MISMATCH'
  | 'INVALID_INPUT';
export interface MessageRecord extends ProtectedContent {
  readonly id: string;
  readonly ticketId: string;
  readonly authorUserId: string;
  readonly createdAt: Date;
}

export interface ProductRepository {
  command(transaction: TransactionContext, command: ProductCommand): Promise<ProductResult>;
  preferences(transaction: TransactionContext): Promise<JsonValue>;
  ticket(transaction: TransactionContext, id: string): Promise<JsonValue | undefined>;
  tickets(transaction: TransactionContext, afterId?: string): Promise<JsonValue[]>;
  messages(
    transaction: TransactionContext,
    ticketId: string,
    factId: string,
    afterId?: string,
  ): Promise<MessageRecord[]>;
  notifications(transaction: TransactionContext, afterId?: string): Promise<JsonValue[]>;
  markRead(transaction: TransactionContext, id: string, factId: string): Promise<boolean>;
  receipt(transaction: TransactionContext, tripId: string): Promise<JsonValue | undefined>;
  cashSummary(transaction: TransactionContext, from: Date, to: Date): Promise<JsonValue[]>;
}

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');
export const PRODUCT_CONTENT_PROTECTOR = Symbol('PRODUCT_CONTENT_PROTECTOR');
