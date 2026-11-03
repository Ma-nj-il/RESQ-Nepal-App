import 'reflect-metadata';

import { reportStartupFailure } from '../../src/bootstrap/report-startup-failure.js';
import { loadApplicationConfig } from '../../src/shared/infrastructure/config/application-config.js';
import {
  startTelemetry,
  stopTelemetry,
} from '../../src/shared/infrastructure/observability/telemetry.js';
import { runMigrations } from '../../src/shared/infrastructure/persistence/migration-runner.js';

async function main(): Promise<void> {
  await startTelemetry('migration');
  const config = loadApplicationConfig(process.env, 'migration');
  try {
    await runMigrations(config);
  } finally {
    await stopTelemetry();
  }
}

void main().catch((error: unknown) => {
  reportStartupFailure('migration', error);
  process.exitCode = 1;
});
