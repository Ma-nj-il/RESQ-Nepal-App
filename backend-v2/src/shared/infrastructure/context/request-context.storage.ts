import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

import type { RequestContext } from '../../application/context/request-context.js';

@Injectable()
export class RequestContextStorage {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  replace(context: RequestContext): void {
    this.storage.enterWith(context);
  }

  require(): RequestContext {
    const context = this.get();
    if (context === undefined) throw new Error('Request context is unavailable');
    return context;
  }
}
