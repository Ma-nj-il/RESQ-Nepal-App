import { Global, Module } from '@nestjs/common';

import { RequestContextStorage } from './request-context.storage.js';

@Global()
@Module({
  providers: [RequestContextStorage],
  exports: [RequestContextStorage],
})
export class ContextModule {}
