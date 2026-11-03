import { uuidv7 } from 'uuidv7';
import pino, { type Logger } from 'pino';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { MIGRATIONS, MIGRATION_CHECKSUMS } from '../../../../migrations/catalog.js';
import type { ApplicationConfig, DatabaseSslMode } from '../config/application-config.js';
import { REDACTED_LOG_PATHS } from '../logging/pino-options.js';

const MIGRATION_LOCK_NAME = 'resq-platform-schema-migrations-v2';

interface MigrationTableRow {
  readonly name: string;
  readonly timestamp: string;
}

interface BooleanRow {
  readonly value: boolean;
}

function isBooleanRow(value: unknown): value is BooleanRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    typeof value.value === 'boolean'
  );
}

class MigrationPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationPreconditionError';
  }
}

function sslOptions(mode: DatabaseSslMode): false | { rejectUnauthorized: boolean } {
  if (mode === 'disable') return false;
  return { rejectUnauthorized: mode === 'verify-full' };
}

export function migrationDataSourceOptions(config: ApplicationConfig): DataSourceOptions {
  const url = config.dependencies.database.migrationUrl;
  if (url === undefined) throw new MigrationPreconditionError('Migration database URL is missing');
  return {
    type: 'postgres',
    url,
    applicationName: 'resq-migration',
    ssl: sslOptions(config.dependencies.database.sslMode),
    synchronize: false,
    migrationsRun: false,
    migrations: [...MIGRATIONS],
    migrationsTableName: 'schema_migrations',
    migrationsTransactionMode: 'all',
    entities: [],
    logging: false,
    extra: {
      max: 2,
      connectionTimeoutMillis: config.dependencies.timeoutMs,
      statement_timeout: 0,
      query_timeout: 0,
    },
  };
}

function migrationLogger(config: ApplicationConfig): Logger {
  return pino({
    level: config.logging.level,
    base: {
      service: 'resq-platform',
      runtimeRole: 'migration',
      release: config.release,
      environment: config.environment,
    },
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACTED_LOG_PATHS], censor: '[REDACTED]' },
  });
}

async function migrationTableExists(dataSource: DataSource): Promise<boolean> {
  const rows = await dataSource.query<BooleanRow[]>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS value",
  );
  return rows[0]?.value === true;
}

async function currentMigration(dataSource: DataSource): Promise<string> {
  if (!(await migrationTableExists(dataSource))) return 'NONE';
  const rows = await dataSource.query<MigrationTableRow[]>(
    'SELECT name, timestamp::text FROM public.schema_migrations ORDER BY timestamp DESC, id DESC LIMIT 1',
  );
  return rows[0]?.name ?? 'NONE';
}

async function controlTableExists(dataSource: DataSource): Promise<boolean> {
  const rows = await dataSource.query<BooleanRow[]>(
    "SELECT to_regclass('governance.schema_migration_runs') IS NOT NULL AS value",
  );
  return rows[0]?.value === true;
}

async function recordRun(
  dataSource: DataSource,
  values: {
    readonly startedAt: Date;
    readonly finishedAt: Date;
    readonly release: string;
    readonly operator: string;
    readonly expectedCurrent?: string;
    readonly currentBefore: string;
    readonly currentAfter: string;
    readonly applied: readonly string[];
    readonly result: 'SUCCEEDED' | 'FAILED';
    readonly errorCode?: string;
  },
): Promise<void> {
  if (!(await controlTableExists(dataSource))) return;
  await dataSource.query(
    `INSERT INTO governance.schema_migration_runs (
      id, started_at, finished_at, release_id, operator_ref, expected_current,
      current_before, current_after, applied_migrations, migration_checksums, result, error_code
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
    [
      uuidv7(),
      values.startedAt,
      values.finishedAt,
      values.release,
      values.operator,
      values.expectedCurrent ?? null,
      values.currentBefore,
      values.currentAfter,
      JSON.stringify(values.applied),
      JSON.stringify(MIGRATION_CHECKSUMS),
      values.result,
      values.errorCode ?? null,
    ],
  );
}

function safeErrorCode(error: unknown): string {
  if (error instanceof MigrationPreconditionError) return 'MIGRATION.PRECONDITION_FAILED';
  return 'MIGRATION.EXECUTION_FAILED';
}

export async function runMigrations(config: ApplicationConfig): Promise<void> {
  const logger = migrationLogger(config);
  const dataSource = new DataSource(migrationDataSourceOptions(config));
  const startedAt = new Date();
  const operator = config.migration.operator ?? 'local-operator';
  let currentBefore = 'UNKNOWN';
  let lockAcquired = false;

  await dataSource.initialize();
  const lockRunner = dataSource.createQueryRunner();
  await lockRunner.connect();
  try {
    const lockResult = await lockRunner.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS value',
      [MIGRATION_LOCK_NAME],
      true,
    );
    const firstLockRow: unknown = lockResult.records[0];
    lockAcquired = isBooleanRow(firstLockRow) && firstLockRow.value;
    if (!lockAcquired) throw new MigrationPreconditionError('Another migration job holds the lock');

    currentBefore = await currentMigration(dataSource);
    const expected = config.migration.expectedCurrent;
    if (expected !== undefined && expected !== currentBefore) {
      throw new MigrationPreconditionError('Database migration version does not match expectation');
    }

    logger.info({ currentBefore }, 'Starting reviewed database migrations');
    const applied = await dataSource.runMigrations({ transaction: 'all' });
    const currentAfter = await currentMigration(dataSource);
    await recordRun(dataSource, {
      startedAt,
      finishedAt: new Date(),
      release: config.release,
      operator,
      ...(expected === undefined ? {} : { expectedCurrent: expected }),
      currentBefore,
      currentAfter,
      applied: applied.map((migration) => migration.name),
      result: 'SUCCEEDED',
    });
    logger.info(
      {
        currentBefore,
        currentAfter,
        appliedMigrations: applied.map((migration) => migration.name),
      },
      'Database migrations completed',
    );
  } catch (error) {
    const errorCode = safeErrorCode(error);
    const currentAfter = await currentMigration(dataSource).catch(() => currentBefore);
    await recordRun(dataSource, {
      startedAt,
      finishedAt: new Date(),
      release: config.release,
      operator,
      ...(config.migration.expectedCurrent === undefined
        ? {}
        : { expectedCurrent: config.migration.expectedCurrent }),
      currentBefore,
      currentAfter,
      applied: [],
      result: 'FAILED',
      errorCode,
    }).catch(() => undefined);
    logger.error({ errorCode, currentBefore }, 'Database migration failed');
    throw error;
  } finally {
    if (lockAcquired) {
      await lockRunner
        .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [MIGRATION_LOCK_NAME])
        .catch(() => undefined);
    }
    await lockRunner.release().catch(() => undefined);
    await dataSource.destroy().catch(() => undefined);
  }
}
