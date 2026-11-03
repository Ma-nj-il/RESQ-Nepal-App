import type { DataSourceOptions } from 'typeorm';

import type { ApplicationConfig, DatabaseSslMode } from '../config/application-config.js';

function sslOptions(mode: DatabaseSslMode): false | { rejectUnauthorized: boolean } {
  if (mode === 'disable') return false;
  return { rejectUnauthorized: mode === 'verify-full' };
}

export function applicationDataSourceOptions(config: ApplicationConfig): DataSourceOptions {
  return {
    type: 'postgres',
    url: config.dependencies.database.url,
    applicationName: `resq-${config.role}`,
    ssl: sslOptions(config.dependencies.database.sslMode),
    synchronize: false,
    migrationsRun: false,
    entities: [],
    migrations: [],
    logging: false,
    extra: {
      max: config.dependencies.database.poolMax,
      connectionTimeoutMillis: config.dependencies.timeoutMs,
      statement_timeout: Math.max(config.dependencies.timeoutMs * 4, 5_000),
      query_timeout: Math.max(config.dependencies.timeoutMs * 4, 5_000),
    },
  };
}
