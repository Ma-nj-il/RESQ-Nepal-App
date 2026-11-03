import { Module } from '@nestjs/common';
import { CoreDispatchApiModule } from '../core-dispatch/core-dispatch.module.js';
import { IdentityAccessModule } from '../identity-access/identity-access.module.js';
import { RealtimeRuntime } from './infrastructure/realtime.runtime.js';
import { RedisRecoveryHints } from './infrastructure/redis-recovery-hints.js';
import { REALTIME_READINESS } from '../shared/infrastructure/health/realtime-readiness.js';

@Module({
  imports: [CoreDispatchApiModule, IdentityAccessModule],
  providers: [
    RedisRecoveryHints,
    RealtimeRuntime,
    { provide: REALTIME_READINESS, useExisting: RedisRecoveryHints },
  ],
  exports: [REALTIME_READINESS],
})
export class RealtimeModule {}
