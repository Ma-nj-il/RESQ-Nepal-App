import type { RequestContext } from '../context/request-context.js';

/** Deliberately opaque outside persistence infrastructure. */
export interface TransactionContext {
  readonly transactionId: string;
}

export interface UnitOfWork {
  execute<T>(
    requestContext: RequestContext,
    work: (transaction: TransactionContext) => Promise<T>,
  ): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
