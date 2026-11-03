import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

import type { RequestContext } from '../../application/context/request-context.js';

@Injectable()
export class RequestContextStorage {
  // The request owns a stable cell. Replacing the ALS store with enterWith inside an
  // awaited guard cannot update continuations already created by the HTTP pipeline.
  private readonly storage = new AsyncLocalStorage<{ context: RequestContext }>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run({ context }, callback);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore()?.context;
  }

  replace(context: RequestContext): void {
    const current = this.storage.getStore();
    if (current === undefined) throw new Error('Request context is unavailable');
    current.context = context;
  }

  require(): RequestContext {
    const context = this.get();
    if (context === undefined) throw new Error('Request context is unavailable');
    return context;
  }
}
