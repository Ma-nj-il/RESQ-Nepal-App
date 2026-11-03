import 'reflect-metadata';

import { reportStartupFailure } from '../../src/bootstrap/report-startup-failure.js';
import {
  startTelemetry,
  stopTelemetry,
} from '../../src/shared/infrastructure/observability/telemetry.js';

async function main(): Promise<void> {
  await startTelemetry('api');
  const { bootstrapApi } = await import('../../src/bootstrap/api-bootstrap.js');
  await bootstrapApi();
}

void main().catch(async (error: unknown) => {
  reportStartupFailure('api', error);
  await stopTelemetry().catch(() => undefined);
  process.exitCode = 1;
});
