import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  APP_CONFIG,
  type ApplicationConfig,
} from '../../../shared/infrastructure/config/application-config.js';
import { DurableJobWorkerRuntime } from '../../../shared/infrastructure/messaging/durable-job-worker.runtime.js';
import { DatabaseService } from '../../../shared/infrastructure/persistence/database.service.js';
import {
  CORE_DISPATCH_JOB_PROCESSOR,
  type CoreDispatchJobProcessorToken,
} from '../../core-dispatch.tokens.js';

@Injectable()
export class CoreDispatchWorkerRuntime extends DurableJobWorkerRuntime {
  constructor(
    @Inject(APP_CONFIG) config: ApplicationConfig,
    @Inject(DatabaseService) database: DatabaseService,
    @Inject(CORE_DISPATCH_JOB_PROCESSOR) processor: CoreDispatchJobProcessorToken,
    @Inject(PinoLogger) logger: PinoLogger,
  ) {
    super(config, database, processor, logger, [
      {
        name: 'dispatch-critical',
        concurrency: 16,
        jobTypes: ['dispatch.expire-offer.v1', 'dispatch.finish-search.v1'],
      },
      {
        name: 'safety-critical',
        concurrency: 8,
        jobTypes: ['safety.deliver-alert.v1', 'safety.escalate-unacknowledged.v1'],
      },
    ]);
  }
}
