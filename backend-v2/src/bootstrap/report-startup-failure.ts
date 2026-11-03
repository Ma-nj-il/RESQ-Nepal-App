import {
  ConfigurationError,
  type RuntimeRole,
} from '../shared/infrastructure/config/application-config.js';

export function reportStartupFailure(role: RuntimeRole, error: unknown): void {
  const record = {
    level: 'fatal',
    time: new Date().toISOString(),
    service: 'resq-platform',
    runtimeRole: role,
    errorCode: error instanceof ConfigurationError ? 'CONFIGURATION.INVALID' : 'STARTUP.FAILED',
    errorType: error instanceof Error ? error.name : 'UnknownThrownValue',
    ...(error instanceof ConfigurationError ? { issues: error.issues } : {}),
  };
  process.stderr.write(`${JSON.stringify(record)}\n`);
}
