import type { RequestContext } from '../../shared/application/context/request-context.js';
import { ApplicationError } from '../../shared/application/errors/application-error.js';
import type {
  IdempotencyExecutor,
  IdempotentResult,
  JsonValue,
} from '../../shared/application/idempotency/idempotency.js';
import type {
  UnitOfWork,
  TransactionContext,
} from '../../shared/application/persistence/unit-of-work.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type {
  ContentProtector,
  Preferences,
  ProductRepository,
  ProductResult,
} from './ports/product.repository.js';

function failure(result: Exclude<ProductResult, 'OK'>): ApplicationError {
  const errors = {
    NOT_FOUND: ['RESOURCE.NOT_FOUND', 'The requested resource was not found.', 404],
    STALE_VERSION: [
      'REQUEST.STALE_VERSION',
      'The resource changed before this request was applied.',
      409,
    ],
    INVALID_STATE: [
      'PRODUCT.INVALID_STATE',
      'The resource cannot perform this action in its current state.',
      422,
    ],
    ALREADY_RECORDED: ['PRODUCT.ALREADY_RECORDED', 'A record already exists for this trip.', 409],
    AMOUNT_MISMATCH: [
      'CASH.AMOUNT_MISMATCH',
      'Cash must match the completed trip fare exactly.',
      422,
    ],
    INVALID_INPUT: ['REQUEST.VALIDATION_FAILED', 'The request is invalid.', 400],
  } as const;
  const [code, message, status] = errors[result];
  return new ApplicationError({ code, message, status });
}

export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly idempotency: IdempotencyExecutor,
    private readonly content: ContentProtector,
    private readonly ids: IdGenerator,
  ) {}

  preferences(context: RequestContext): Promise<JsonValue> {
    this.requireUser(context, true);
    return this.unitOfWork.execute(context, (tx) => this.repository.preferences(tx));
  }

  replacePreferences(
    context: RequestContext,
    key: string,
    version: number,
    preferences: Preferences,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireUser(context, true);
    this.validateVersion(version, 0);
    if (
      [
        preferences.bookingUpdates,
        preferences.tripUpdates,
        preferences.supportUpdates,
        preferences.marketing,
      ].some((value) => typeof value !== 'boolean')
    )
      throw failure('INVALID_INPUT');
    return this.mutate(
      context,
      key,
      'communication.preferences.replace',
      { version, ...preferences },
      async (tx) => {
        this.check(
          await this.repository.command(tx, {
            kind: 'PREFERENCES',
            version,
            preferences,
            factId: this.ids.generate(),
          }),
        );
        return this.repository.preferences(tx);
      },
    );
  }

  rate(
    context: RequestContext,
    key: string,
    tripId: string,
    version: number,
    score: number,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireUser(context, true);
    this.validateVersion(version);
    if (!Number.isInteger(score) || score < 1 || score > 5) throw failure('INVALID_INPUT');
    return this.mutate(
      context,
      key,
      `support.rating.create:${tripId}`,
      { tripId, version, score },
      async (tx) => {
        const id = this.ids.generate();
        this.check(
          await this.repository.command(tx, { kind: 'RATING', id, tripId, version, score }),
        );
        return { id, tripId, score, version: 1 };
      },
      201,
    );
  }

  cash(
    context: RequestContext,
    key: string,
    tripId: string,
    version: number,
    amountMinor: string,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireUser(context);
    this.validateVersion(version);
    if (
      context.scope.tenantId === undefined ||
      !context.authentication?.permissionCodes.includes('cash.record')
    ) {
      throw failure('NOT_FOUND');
    }
    if (!/^(0|[1-9][0-9]{0,18})$/.test(amountMinor) || BigInt(amountMinor) > 9223372036854775807n) {
      throw failure('INVALID_INPUT');
    }
    return this.mutate(
      context,
      key,
      `billing.cash.record:${tripId}`,
      { tripId, version, amountMinor },
      async (tx) => {
        const id = this.ids.generate();
        this.check(
          await this.repository.command(tx, { kind: 'CASH', id, tripId, version, amountMinor }),
        );
        return {
          id,
          tripId,
          amount: { amountMinor, currency: 'NPR' },
          status: 'RECORDED',
          version: 1,
        };
      },
      201,
    );
  }

  createTicket(
    context: RequestContext,
    key: string,
    input: { category: string; message: string; tripId?: string },
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireUser(context, true);
    this.validateText(input.message);
    if (!['SERVICE', 'BILLING', 'ACCOUNT', 'OTHER'].includes(input.category))
      throw failure('INVALID_INPUT');
    return this.mutate(
      context,
      key,
      'support.ticket.create',
      { ...input },
      async (tx) => {
        const id = this.ids.generate();
        const messageId = this.ids.generate();
        const content = this.content.protect(messageId, id, input.message);
        this.check(
          await this.repository.command(tx, {
            kind: 'TICKET',
            id,
            messageId,
            content,
            category: input.category,
            ...(input.tripId === undefined ? {} : { tripId: input.tripId }),
          }),
        );
        return this.required(await this.repository.ticket(tx, id));
      },
      201,
    );
  }

  reply(
    context: RequestContext,
    key: string,
    ticketId: string,
    version: number,
    message: string,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireUser(context);
    this.validateVersion(version);
    if (context.scope.authorityGrantId !== undefined && context.scope.authority?.allowsPii !== true)
      throw failure('NOT_FOUND');
    this.validateText(message);
    return this.mutate(
      context,
      key,
      `support.ticket.reply:${ticketId}`,
      { ticketId, version, message },
      async (tx) => {
        const messageId = this.ids.generate();
        const content = this.content.protect(messageId, ticketId, message);
        this.check(
          await this.repository.command(tx, {
            kind: 'REPLY',
            ticketId,
            version,
            messageId,
            content,
          }),
        );
        return { id: messageId, ticketId, version: version + 1 };
      },
      201,
    );
  }

  transition(
    context: RequestContext,
    key: string,
    ticketId: string,
    version: number,
    action: 'START' | 'RESOLVE',
    resolutionCode?: string,
  ): Promise<IdempotentResult<JsonValue>> {
    this.requireUser(context);
    this.validateVersion(version);
    if (
      !['START', 'RESOLVE'].includes(action) ||
      (action === 'RESOLVE' && !/^[A-Z][A-Z0-9_]{2,63}$/.test(resolutionCode ?? ''))
    )
      throw failure('INVALID_INPUT');
    if (context.scope.tenantId === undefined && context.scope.authorityGrantId === undefined)
      throw failure('NOT_FOUND');
    return this.mutate(
      context,
      key,
      `support.ticket.transition:${ticketId}`,
      { ticketId, version, action, resolutionCode: resolutionCode ?? null },
      async (tx) => {
        this.check(
          await this.repository.command(tx, {
            kind: 'TRANSITION',
            ticketId,
            version,
            action,
            factId: this.ids.generate(),
            ...(resolutionCode === undefined ? {} : { resolutionCode }),
          }),
        );
        return {
          id: ticketId,
          status: action === 'START' ? 'IN_PROGRESS' : 'RESOLVED',
          version: version + 1,
        };
      },
    );
  }

  ticket(context: RequestContext, id: string): Promise<JsonValue> {
    this.requireUser(context);
    return this.unitOfWork.execute(context, async (tx) =>
      this.required(await this.repository.ticket(tx, id)),
    );
  }

  tickets(context: RequestContext, afterId?: string): Promise<JsonValue> {
    this.requireUser(context);
    return this.unitOfWork.execute(context, async (tx) =>
      this.page(await this.repository.tickets(tx, afterId)),
    );
  }

  messages(context: RequestContext, ticketId: string, afterId?: string): Promise<JsonValue> {
    this.requireUser(context);
    if (context.scope.authorityGrantId !== undefined && context.scope.authority?.allowsPii !== true)
      throw failure('NOT_FOUND');
    return this.unitOfWork.execute(context, async (tx) => {
      this.required(await this.repository.ticket(tx, ticketId));
      const records = await this.repository.messages(tx, ticketId, this.ids.generate(), afterId);
      return this.page(
        records.map((record) => ({
          id: record.id,
          ticketId: record.ticketId,
          authorUserId: record.authorUserId,
          message: this.content.reveal(record.id, record.ticketId, record),
          createdAt: record.createdAt.toISOString(),
        })),
      );
    });
  }

  notifications(context: RequestContext, afterId?: string): Promise<JsonValue> {
    this.requireUser(context, true);
    return this.unitOfWork.execute(context, async (tx) =>
      this.page(await this.repository.notifications(tx, afterId)),
    );
  }

  markRead(context: RequestContext, id: string): Promise<JsonValue> {
    this.requireUser(context, true);
    return this.unitOfWork.execute(context, async (tx) => {
      if (!(await this.repository.markRead(tx, id, this.ids.generate())))
        throw failure('NOT_FOUND');
      return { id, read: true };
    });
  }

  receipt(context: RequestContext, tripId: string): Promise<JsonValue> {
    this.requireUser(context, true);
    return this.unitOfWork.execute(context, async (tx) =>
      this.required(await this.repository.receipt(tx, tripId)),
    );
  }

  cashSummary(context: RequestContext, from: string, to: string): Promise<JsonValue> {
    this.requireUser(context);
    if (
      context.scope.tenantId === undefined ||
      !context.authentication?.permissionCodes.includes('report.tenant.read')
    )
      throw failure('NOT_FOUND');
    const start = new Date(from),
      end = new Date(to);
    const duration = end.getTime() - start.getTime();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 31 * 86_400_000)
      throw failure('INVALID_INPUT');
    return this.unitOfWork.execute(context, async (tx) => ({
      from: start.toISOString(),
      to: end.toISOString(),
      cohort: 'TRIP_COMPLETED_AT',
      currency: 'NPR',
      items: await this.repository.cashSummary(tx, start, end),
    }));
  }

  private page(records: JsonValue[]): JsonValue {
    const items = records.slice(0, 50);
    const last = items.at(-1);
    const afterId =
      last !== null && typeof last === 'object' && !Array.isArray(last) ? last['id'] : null;
    return { items, nextAfterId: records.length > 50 ? (afterId ?? null) : null };
  }

  private mutate(
    context: RequestContext,
    key: string,
    operation: string,
    request: JsonValue,
    work: (transaction: TransactionContext) => Promise<JsonValue>,
    successStatus = 200,
  ): Promise<IdempotentResult<JsonValue>> {
    // Context is part of replay identity, including narrowed facilities and authority grants.
    return this.idempotency.execute(
      context,
      {
        key,
        operation,
        successStatus,
        request: {
          body: request,
          facilityIds: [...context.scope.facilityIds].sort(),
          authorityGrantId: context.scope.authorityGrantId ?? null,
          accessScopeType: context.scope.accessScopeType ?? null,
        },
      },
      work,
    );
  }

  private required(value: JsonValue | undefined): JsonValue {
    if (value === undefined) throw failure('NOT_FOUND');
    return value;
  }

  private check(result: ProductResult): void {
    if (result !== 'OK') throw failure(result);
  }

  private validateText(text: string): void {
    if (text.trim().length === 0 || text.length > 4000) throw failure('INVALID_INPUT');
  }

  private validateVersion(version: number, minimum = 1): void {
    if (!Number.isInteger(version) || version < minimum || version > 2147483646)
      throw failure('INVALID_INPUT');
  }

  private requireUser(context: RequestContext, self = false): void {
    if (context.actor?.type !== 'USER')
      throw new ApplicationError({
        code: 'AUTH.AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
        status: 401,
      });
    if (
      self &&
      (context.scope.tenantId !== undefined || context.scope.authorityGrantId !== undefined)
    )
      throw failure('NOT_FOUND');
  }
}
