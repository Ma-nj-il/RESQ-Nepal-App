import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { PlatformModule } from '../platform/platform.module.js';
import type { RuntimeRole } from '../shared/infrastructure/config/application-config.js';
import { RuntimeProbeServer } from '../shared/infrastructure/health/runtime-probe.server.js';

type LongRunningRole = Extract<RuntimeRole, 'worker' | 'outbox-relay'>;

export async function bootstrapRuntime(role: LongRunningRole): Promise<void> {
  const application = await NestFactory.createApplicationContext(PlatformModule.forRole(role), {
    bufferLogs: true,
    abortOnError: true,
  });
  application.useLogger(application.get(Logger));
  application.enableShutdownHooks();
  await application.get(RuntimeProbeServer).listen();
}
