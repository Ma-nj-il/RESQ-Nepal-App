import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { RequireAuthorization } from '../../../identity-access/presentation/http/route-authorization.decorator.js';
import { RequestContextStorage } from '../../../shared/infrastructure/context/request-context.storage.js';
import { PRODUCT_SERVICE, type ProductServiceToken } from '../../product-services.tokens.js';
import { MessageDto, PreferencesDto, ProductPageDto, RatingDto, TicketDto } from './product.dto.js';
import { expectedProductVersion, productCommandResponse, productResponse } from './product-http.js';

@Controller('/api/v1')
@RequireAuthorization({ context: 'SELF' })
export class RequesterProductController {
  constructor(
    @Inject(PRODUCT_SERVICE) private readonly product: ProductServiceToken,
    @Inject(RequestContextStorage) private readonly contexts: RequestContextStorage,
  ) {}

  @Get('/me/notification-preferences')
  async preferences(@Res({ passthrough: true }) response: Response): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.preferences(this.contexts.require()),
      response,
    );
  }

  @Put('/me/notification-preferences')
  async replacePreferences(
    @Body() body: PreferencesDto,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productCommandResponse(
      this.contexts,
      await this.product.replacePreferences(
        this.contexts.require(),
        key ?? '',
        expectedProductVersion(version, 0),
        body,
      ),
      response,
    );
  }

  @Post('/trips/:tripId/ratings')
  async rate(
    @Param('tripId', ParseUUIDPipe) id: string,
    @Body() body: RatingDto,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productCommandResponse(
      this.contexts,
      await this.product.rate(
        this.contexts.require(),
        key ?? '',
        id,
        expectedProductVersion(version),
        body.score,
      ),
      response,
    );
  }

  @Get('/trips/:tripId/receipt')
  async receipt(
    @Param('tripId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.receipt(this.contexts.require(), id),
      response,
    );
  }

  @Post('/support/tickets')
  async createTicket(
    @Body() body: TicketDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productCommandResponse(
      this.contexts,
      await this.product.createTicket(this.contexts.require(), key ?? '', body),
      response,
    );
  }

  @Get('/support/tickets')
  async tickets(
    @Query() query: ProductPageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.tickets(this.contexts.require(), query.afterId),
      response,
    );
  }

  @Get('/support/tickets/:ticketId')
  async ticket(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.ticket(this.contexts.require(), id),
      response,
    );
  }

  @Get('/support/tickets/:ticketId/messages')
  async messages(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Query() query: ProductPageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.messages(this.contexts.require(), id, query.afterId),
      response,
    );
  }

  @Post('/support/tickets/:ticketId/messages')
  async reply(
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Body() body: MessageDto,
    @Headers('if-match') version: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
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

  @Get('/me/notifications')
  async notifications(
    @Query() query: ProductPageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.notifications(this.contexts.require(), query.afterId),
      response,
    );
  }

  @Put('/me/notifications/:notificationId/read')
  async markRead(
    @Param('notificationId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return productResponse(
      this.contexts,
      await this.product.markRead(this.contexts.require(), id),
      response,
    );
  }
}
