import 'reflect-metadata';

import { reportStartupFailure } from '../../src/bootstrap/report-startup-failure.js';
import {
  startTelemetry,
  stopTelemetry,
} from '../../src/shared/infrastructure/observability/telemetry.js';

async function main(): Promise<void> {
  await startTelemetry('worker');
  const { bootstrapRuntime } = await import('../../src/bootstrap/runtime-bootstrap.js');
  await bootstrapRuntime('worker');
}

void main().catch(async (error: unknown) => {
  reportStartupFailure('worker', error);
  await stopTelemetry().catch(() => undefined);
  process.exitCode = 1;
});
