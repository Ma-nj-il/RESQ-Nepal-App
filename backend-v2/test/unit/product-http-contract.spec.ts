import 'reflect-metadata';

/* eslint-disable @typescript-eslint/unbound-method -- Inspect route metadata without invoking methods. */

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ROUTE_AUTHORIZATION } from '../../src/identity-access/presentation/http/route-authorization.decorator.js';
import {
  AuthoritySupportController,
  TenantProductController,
} from '../../src/product-services/presentation/http/managed-product.controller.js';
import { RequesterProductController } from '../../src/product-services/presentation/http/requester-product.controller.js';
import {
  CashDto,
  PreferencesDto,
  ProductPageDto,
  TicketDto,
  TicketTransitionDto,
} from '../../src/product-services/presentation/http/product.dto.js';
import { expectedProductVersion } from '../../src/product-services/presentation/http/product-http.js';

describe('product HTTP contracts', () => {
  it('requires strong, bounded If-Match versions and handles initial preferences', () => {
    expect(expectedProductVersion('"0"', 0)).toBe(0);
    expect(expectedProductVersion('"2"')).toBe(2);
    expect(() => expectedProductVersion(undefined)).toThrow('required');
    for (const value of ['0', 'W/"1"', '"1', '1"', '*', '1,2', '-1', '2147483647', '1.2', '01']) {
      expect(() => expectedProductVersion(value)).toThrow('invalid');
    }
  });

  it('validates preference booleans, exact cash strings, optional UUIDs and resolution codes', async () => {
    expect(
      await validate(plainToInstance(PreferencesDto, { bookingUpdates: 'true' })),
    ).not.toHaveLength(0);
    expect(await validate(plainToInstance(CashDto, { amountMinor: 120 }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(CashDto, { amountMinor: '120' }))).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(TicketDto, {
          category: 'ACCOUNT',
          message: 'Synthetic message',
          tripId: null,
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(TicketDto, { category: 'ACCOUNT', message: 'Synthetic message' }),
      ),
    ).toHaveLength(0);
    expect(await validate(plainToInstance(ProductPageDto, { afterId: 'bad-id' }))).not.toHaveLength(
      0,
    );
    expect(
      await validate(plainToInstance(TicketTransitionDto, { action: 'RESOLVE' })),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(TicketTransitionDto, {
          action: 'RESOLVE',
          resolutionCode: 'ISSUE_RESOLVED',
        }),
      ),
    ).toHaveLength(0);
  });

  it('protects managed content and cash routes with explicit permissions and step-up', () => {
    expect(Reflect.getMetadata(ROUTE_AUTHORIZATION, RequesterProductController)).toEqual({
      context: 'SELF',
    });
    expect(
      Reflect.getMetadata(ROUTE_AUTHORIZATION, TenantProductController.prototype.cash),
    ).toEqual({ context: 'TENANT', permission: 'cash.record', minimumAssurance: 'AAL2' });
    expect(
      Reflect.getMetadata(ROUTE_AUTHORIZATION, AuthoritySupportController.prototype.messages),
    ).toMatchObject({
      context: 'AUTHORITY',
      permission: 'support.ticket.read',
      resourceClass: 'support_ticket',
      requiresPii: true,
      minimumAssurance: 'AAL2',
    });
    expect(
      Reflect.getMetadata(ROUTE_AUTHORIZATION, AuthoritySupportController.prototype.replyTicket),
    ).toMatchObject({ permission: 'support.ticket.manage', requiresPii: true });
    for (const controller of [TenantProductController, AuthoritySupportController]) {
      for (const name of [
        'tickets',
        'ticket',
        'messages',
        'replyTicket',
        'transitionTicket',
      ] as const) {
        expect(Reflect.getMetadata(ROUTE_AUTHORIZATION, controller.prototype[name])).toBeDefined();
      }
    }
  });
});
