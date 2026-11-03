import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { RequireAuthorization } from '../../../identity-access/presentation/http/route-authorization.decorator.js';
import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { PRODUCT_SERVICE, type ProductServiceToken } from '../../product-services.tokens.js';
import {
  CashDto,
  CashSummaryDto,
  MessageDto,
  ProductPageDto,
  TicketTransitionDto,
} from './product.dto.js';
import { expectedProductVersion, productCommandResponse, productResponse } from './product-http.js';

abstract class ManagedProductHttp {
  protected constructor(
    protected readonly product: ProductServiceToken,
    protected readonly contexts: RequestContextStorage,
  ) {}

  protected async list(query: ProductPageDto, response: Response): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.tickets(this.contexts.require(), query.afterId),
      response,
    );
  }
  protected async one(id: string, response: Response): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.ticket(this.contexts.require(), id),
      response,
    );
  }
  protected async content(id: string, query: ProductPageDto, response: Response): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.messages(this.contexts.require(), id, query.afterId),
      response,
    );
  }
  protected async reply(
    id: string,
    body: MessageDto,
    version: string | undefined,
    key: string | undefined,
    response: Response,
  ): Promise<unknown> {
    return productCommandResponse(
      this.contexts,
      await this.product.reply(
        this.contexts.require(),
        key ?? '',
        id,
        expectedProductVersion(version),
        body.message,
      ),
      response,
    );
  }
  protected async transition(
    id: string,
    body: TicketTransitionDto,
    version: string | undefined,
    key: string | undefined,
    response: Response,
  ): Promise<unknown> {
    return productCommandResponse(
      this.contexts,
      await this.product.transition(
        this.contexts.require(),
        key ?? '',
        id,
        expectedProductVersion(version),
        body.action,
        body.resolutionCode,
      ),
      response,
    );
  }
}

@Controller('/api/v1/tenant')
export class TenantProductController extends ManagedProductHttp {
  constructor(
    @Inject(PRODUCT_SERVICE) product: ProductServiceToken,
    @Inject(RequestContextStorage) contexts: RequestContextStorage,
  ) {
    super(product, contexts);
  }

  @Get('/reports/cash')
  @RequireAuthorization({ context: 'TENANT', permission: 'report.tenant.read' })
  async cashSummary(
    @Query() query: CashSummaryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.cashSummary(this.contexts.require(), query.from, query.to),
      response,
    );
  }

  @Post('/trips/:tripId/cash-collections')
  @RequireAuthorization({ context: 'TENANT', permission: 'cash.record', minimumAssurance: 'AAL2' })
  async cash(
    @Param('tripId', ParseUUIDPipe) id: string,
    @Body() body: CashDto,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productCommandResponse(
      this.contexts,
      await this.product.cash(
        this.contexts.require(),
        key ?? '',
        id,
        expectedProductVersion(version),
        body.amountMinor,
      ),
      response,
    );
  }

  @Get('/support/tickets')
  @RequireAuthorization({ context: 'TENANT', permission: 'support.ticket.read' })
  tickets(
    @Query() query: ProductPageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.list(query, response);
  }

  @Get('/support/tickets/:ticketId')
  @RequireAuthorization({ context: 'TENANT', permission: 'support.ticket.read' })
  ticket(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.one(id, response);
  }

  @Get('/support/tickets/:ticketId/messages')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'support.ticket.read',
    minimumAssurance: 'AAL2',
  })
  messages(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Query() query: ProductPageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.content(id, query, response);
  }

  @Post('/support/tickets/:ticketId/messages')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'support.ticket.manage',
    minimumAssurance: 'AAL2',
  })
  replyTicket(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Body() body: MessageDto,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.reply(id, body, version, key, response);
  }

  @Post('/support/tickets/:ticketId/transitions')
  @RequireAuthorization({
    context: 'TENANT',
    permission: 'support.ticket.manage',
    minimumAssurance: 'AAL2',
  })
  transitionTicket(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Body() body: TicketTransitionDto,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transition(id, body, version, key, response);
  }
}

@Controller('/api/v1/authority/support/tickets')
export class AuthoritySupportController extends ManagedProductHttp {
  constructor(
    @Inject(PRODUCT_SERVICE) product: ProductServiceToken,
    @Inject(RequestContextStorage) contexts: RequestContextStorage,
  ) {
    super(product, contexts);
  }

  @Get()
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'support.ticket.read',
    resourceClass: 'support_ticket',
  })
  tickets(
    @Query() query: ProductPageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.list(query, response);
  }

  @Get('/:ticketId')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'support.ticket.read',
    resourceClass: 'support_ticket',
  })
  ticket(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.one(id, response);
  }

  @Get('/:ticketId/messages')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'support.ticket.read',
    resourceClass: 'support_ticket',
    requiresPii: true,
    minimumAssurance: 'AAL2',
  })
  messages(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Query() query: ProductPageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.content(id, query, response);
  }

  @Post('/:ticketId/messages')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'support.ticket.manage',
    resourceClass: 'support_ticket',
    requiresPii: true,
    minimumAssurance: 'AAL2',
  })
  replyTicket(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Body() body: MessageDto,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.reply(id, body, version, key, response);
  }

  @Post('/:ticketId/transitions')
  @RequireAuthorization({
    context: 'AUTHORITY',
    permission: 'support.ticket.manage',
    resourceClass: 'support_ticket',
    minimumAssurance: 'AAL2',
  })
  transitionTicket(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Body() body: TicketTransitionDto,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.transition(id, body, version, key, response);
  }
}
