import { z } from 'zod';

export const RUNTIME_ROLES = ['api', 'worker', 'outbox-relay', 'migration'] as const;
export type RuntimeRole = (typeof RUNTIME_ROLES)[number];
export type EnvironmentName = 'development' | 'test' | 'production';
export type DatabaseSslMode = 'disable' | 'require' | 'verify-full';

export interface ApplicationConfig {
  readonly environment: EnvironmentName;
  readonly role: RuntimeRole;
  readonly release: string;
  readonly logging: {
    readonly level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
    readonly pretty: boolean;
  };
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly healthPort: number;
    readonly corsOrigins: readonly string[];
    readonly shutdownGraceMs: number;
  };
  readonly dependencies: {
    readonly timeoutMs: number;
    readonly database: {
      readonly url: string;
      readonly migrationUrl?: string;
      readonly sslMode: DatabaseSslMode;
      readonly poolMax: number;
    };
    readonly redis: {
      readonly cacheUrl: string;
      readonly queueUrl: string;
    };
    readonly kafka: {
      readonly brokers: readonly string[];
      readonly ssl: boolean;
      readonly clientId: string;
      readonly sasl?: {
        readonly mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
        readonly username: string;
        readonly password: string;
      };
    };
    readonly objectStorageEndpoint: string;
  };
  readonly metrics: {
    readonly enabled: boolean;
  };
  readonly telemetry: {
    readonly enabled: boolean;
    readonly exporterEndpoint?: string;
    readonly exportIntervalMs: number;
  };
  readonly migration: {
    readonly expectedCurrent?: string;
    readonly operator?: string;
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

const booleanValue = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return value;
}, z.boolean());

const integerValue = (minimum: number, maximum: number): z.ZodType<number> =>
  z.coerce.number().int().min(minimum).max(maximum);

const rawEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    RESQ_RUNTIME_ROLE: z.enum(RUNTIME_ROLES).optional(),
    RESQ_RELEASE: z.string().trim().min(1).max(128).default('local-dev'),
    RESQ_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    RESQ_LOG_PRETTY: booleanValue.default(false),
    RESQ_HTTP_HOST: z.string().trim().min(1).default('0.0.0.0'),
    RESQ_HTTP_PORT: integerValue(1, 65_535).default(3000),
    RESQ_HEALTH_PORT: integerValue(1, 65_535).optional(),
    RESQ_SHUTDOWN_GRACE_MS: integerValue(1_000, 120_000).default(15_000),
    RESQ_DEPENDENCY_TIMEOUT_MS: integerValue(100, 30_000).default(1_500),
    RESQ_DATABASE_URL: z.url().default('postgresql://resq_api:local-only@localhost:5432/resq'),
    RESQ_MIGRATION_DATABASE_URL: z.url().optional(),
    RESQ_DATABASE_SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
    RESQ_DATABASE_POOL_MAX: integerValue(1, 100).default(10),
    RESQ_REDIS_CACHE_URL: z.url().default('redis://localhost:6379/0'),
    RESQ_REDIS_QUEUE_URL: z.url().default('redis://localhost:6380/0'),
    RESQ_KAFKA_BROKERS: z.string().trim().min(1).default('localhost:9092'),
    RESQ_KAFKA_SSL: booleanValue.default(false),
    RESQ_KAFKA_CLIENT_ID: z.string().trim().min(1).max(128).default('resq-platform'),
    RESQ_KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
    RESQ_KAFKA_SASL_USERNAME: z.string().min(1).max(256).optional(),
    RESQ_KAFKA_SASL_PASSWORD: z.string().min(1).max(4096).optional(),
    RESQ_OBJECT_STORAGE_ENDPOINT: z.url().default('http://localhost:9000'),
    RESQ_CORS_ORIGINS: z.string().default('http://localhost:8081'),
    RESQ_METRICS_ENABLED: booleanValue.default(true),
    RESQ_OTEL_ENABLED: booleanValue.default(false),
    RESQ_OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    RESQ_OTEL_EXPORT_INTERVAL_MS: integerValue(1_000, 300_000).default(30_000),
    RESQ_MIGRATION_EXPECTED_CURRENT: z.string().trim().min(1).max(256).optional(),
    RESQ_MIGRATION_OPERATOR: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const recognizedKeys = new Set(Object.keys(rawEnvironmentSchema.shape));

export class ConfigurationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configuration rejected: ${issues.join('; ')}`);
    this.name = 'ConfigurationError';
  }
}

function onlyApplicationEnvironment(environment: NodeJS.ProcessEnv): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (key === 'NODE_ENV' || key.startsWith('RESQ_')) selected[key] = value;
  }

  const unknown = Object.keys(selected).filter((key) => !recognizedKeys.has(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(unknown.sort().map((key) => `unknown variable ${key}`));
  }
  return selected;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized.startsWith('127.') ||
    normalized.endsWith('.local')
  );
}

function parseUrl(value: string, field: string, issues: string[]): URL | undefined {
  try {
    return new URL(value);
  } catch {
    issues.push(`${field} must be a valid URL`);
    return undefined;
  }
}

function validateProduction(
  raw: z.infer<typeof rawEnvironmentSchema>,
  role: RuntimeRole,
): readonly string[] {
  if (raw.NODE_ENV !== 'production') return [];

  const issues: string[] = [];
  if (raw.RESQ_RELEASE === 'local-dev')
    issues.push('RESQ_RELEASE must identify the deployed build');
  if (raw.RESQ_LOG_PRETTY) issues.push('RESQ_LOG_PRETTY must be false in production');
  if (raw.RESQ_DATABASE_SSL_MODE !== 'verify-full') {
    issues.push('RESQ_DATABASE_SSL_MODE must be verify-full in production');
  }
  if (!raw.RESQ_KAFKA_SSL) issues.push('RESQ_KAFKA_SSL must be true in production');
  if (
    raw.RESQ_KAFKA_SASL_MECHANISM === undefined ||
    raw.RESQ_KAFKA_SASL_USERNAME === undefined ||
    raw.RESQ_KAFKA_SASL_PASSWORD === undefined
  ) {
    issues.push('Kafka SASL mechanism, username, and password are required in production');
  }
  if (raw.RESQ_REDIS_CACHE_URL === raw.RESQ_REDIS_QUEUE_URL) {
    issues.push('cache and BullMQ Redis URLs must use isolated deployments');
  }
  if (!raw.RESQ_OTEL_ENABLED) issues.push('OpenTelemetry must be enabled in production');

  const databaseUrl = parseUrl(raw.RESQ_DATABASE_URL, 'RESQ_DATABASE_URL', issues);
  if (databaseUrl !== undefined) {
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
      issues.push('RESQ_DATABASE_URL must use PostgreSQL');
    }
    if (isLocalHostname(databaseUrl.hostname)) {
      issues.push('RESQ_DATABASE_URL cannot target localhost in production');
    }
    if (databaseUrl.username.length === 0 || databaseUrl.password.length === 0) {
      issues.push('RESQ_DATABASE_URL must use an authenticated runtime identity');
    }
  }

  for (const [field, value] of [
    ['RESQ_REDIS_CACHE_URL', raw.RESQ_REDIS_CACHE_URL],
    ['RESQ_REDIS_QUEUE_URL', raw.RESQ_REDIS_QUEUE_URL],
  ] as const) {
    const redisUrl = parseUrl(value, field, issues);
    if (redisUrl !== undefined) {
      if (redisUrl.protocol !== 'rediss:') issues.push(`${field} must use TLS (rediss)`);
      if (isLocalHostname(redisUrl.hostname)) issues.push(`${field} cannot target localhost`);
      if (redisUrl.password.length === 0) issues.push(`${field} must be authenticated`);
    }
  }

  const objectUrl = parseUrl(
    raw.RESQ_OBJECT_STORAGE_ENDPOINT,
    'RESQ_OBJECT_STORAGE_ENDPOINT',
    issues,
  );
  if (objectUrl !== undefined && objectUrl.protocol !== 'https:') {
    issues.push('RESQ_OBJECT_STORAGE_ENDPOINT must use HTTPS');
  }

  const telemetryUrl = raw.RESQ_OTEL_EXPORTER_OTLP_ENDPOINT;
  if (telemetryUrl === undefined) {
    issues.push('RESQ_OTEL_EXPORTER_OTLP_ENDPOINT is required in production');
  } else {
    const parsed = parseUrl(telemetryUrl, 'RESQ_OTEL_EXPORTER_OTLP_ENDPOINT', issues);
    if (parsed !== undefined && parsed.protocol !== 'https:') {
      issues.push('RESQ_OTEL_EXPORTER_OTLP_ENDPOINT must use HTTPS');
    }
  }

  const origins = raw.RESQ_CORS_ORIGINS.split(',').map((origin) => origin.trim());
  if (origins.length === 0 || origins.some((origin) => origin.length === 0)) {
    issues.push('RESQ_CORS_ORIGINS must be an explicit non-empty allowlist');
  }
  if (origins.includes('*')) issues.push('wildcard CORS is forbidden in production');
  for (const origin of origins.filter((value) => value !== '*')) {
    const parsed = parseUrl(origin, 'RESQ_CORS_ORIGINS', issues);
    if (parsed !== undefined && parsed.protocol !== 'https:') {
      issues.push('every production CORS origin must use HTTPS');
    }
  }

  const brokers = raw.RESQ_KAFKA_BROKERS.split(',').map((broker) => broker.trim());
  if (brokers.some((broker) => isLocalHostname(broker.split(':')[0] ?? ''))) {
    issues.push('RESQ_KAFKA_BROKERS cannot target localhost in production');
  }

  if (role === 'migration') {
    if (raw.RESQ_MIGRATION_DATABASE_URL === undefined) {
      issues.push('RESQ_MIGRATION_DATABASE_URL is required for production migrations');
    }
    if (raw.RESQ_MIGRATION_EXPECTED_CURRENT === undefined) {
      issues.push('RESQ_MIGRATION_EXPECTED_CURRENT is required for production migrations');
    }
    if (raw.RESQ_MIGRATION_OPERATOR === undefined) {
      issues.push('RESQ_MIGRATION_OPERATOR is required for production migrations');
    }
  }

  return issues;
}

function defaultHealthPort(role: RuntimeRole): number {
  if (role === 'worker') return 3001;
  if (role === 'outbox-relay') return 3002;
  return 3000;
}

export function loadApplicationConfig(
  environment: NodeJS.ProcessEnv,
  expectedRole: RuntimeRole,
): ApplicationConfig {
  const parsed = rawEnvironmentSchema.safeParse(onlyApplicationEnvironment(environment));
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`,
      ),
    );
  }

  const raw = parsed.data;
  const saslValues = [
    raw.RESQ_KAFKA_SASL_MECHANISM,
    raw.RESQ_KAFKA_SASL_USERNAME,
    raw.RESQ_KAFKA_SASL_PASSWORD,
  ];
  if (
    saslValues.some((value) => value !== undefined) &&
    saslValues.some((value) => value === undefined)
  ) {
    throw new ConfigurationError([
      'Kafka SASL mechanism, username, and password must be configured together',
    ]);
  }
  if (raw.RESQ_RUNTIME_ROLE !== undefined && raw.RESQ_RUNTIME_ROLE !== expectedRole) {
    throw new ConfigurationError([
      `RESQ_RUNTIME_ROLE=${raw.RESQ_RUNTIME_ROLE} cannot start the ${expectedRole} entry point`,
    ]);
  }

  const productionIssues = validateProduction(raw, expectedRole);
  if (productionIssues.length > 0) throw new ConfigurationError(productionIssues);

  if (expectedRole === 'migration' && raw.RESQ_MIGRATION_DATABASE_URL === undefined) {
    throw new ConfigurationError([
      'RESQ_MIGRATION_DATABASE_URL is required for the migration role',
    ]);
  }

  const brokers = raw.RESQ_KAFKA_BROKERS.split(',')
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0);
  if (brokers.length === 0) throw new ConfigurationError(['RESQ_KAFKA_BROKERS is empty']);

  const corsOrigins = raw.RESQ_CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const config: ApplicationConfig = {
    environment: raw.NODE_ENV,
    role: expectedRole,
    release: raw.RESQ_RELEASE,
    logging: Object.freeze({ level: raw.RESQ_LOG_LEVEL, pretty: raw.RESQ_LOG_PRETTY }),
    http: Object.freeze({
      host: raw.RESQ_HTTP_HOST,
      port: raw.RESQ_HTTP_PORT,
      healthPort: raw.RESQ_HEALTH_PORT ?? defaultHealthPort(expectedRole),
      corsOrigins: Object.freeze(corsOrigins),
      shutdownGraceMs: raw.RESQ_SHUTDOWN_GRACE_MS,
    }),
    dependencies: Object.freeze({
      timeoutMs: raw.RESQ_DEPENDENCY_TIMEOUT_MS,
      database: Object.freeze({
        url: raw.RESQ_DATABASE_URL,
        ...(raw.RESQ_MIGRATION_DATABASE_URL === undefined
          ? {}
          : { migrationUrl: raw.RESQ_MIGRATION_DATABASE_URL }),
        sslMode: raw.RESQ_DATABASE_SSL_MODE,
        poolMax: raw.RESQ_DATABASE_POOL_MAX,
      }),
      redis: Object.freeze({
        cacheUrl: raw.RESQ_REDIS_CACHE_URL,
        queueUrl: raw.RESQ_REDIS_QUEUE_URL,
      }),
      kafka: Object.freeze({
        brokers: Object.freeze(brokers),
        ssl: raw.RESQ_KAFKA_SSL,
        clientId: raw.RESQ_KAFKA_CLIENT_ID,
        ...(raw.RESQ_KAFKA_SASL_MECHANISM === undefined ||
        raw.RESQ_KAFKA_SASL_USERNAME === undefined ||
        raw.RESQ_KAFKA_SASL_PASSWORD === undefined
          ? {}
          : {
              sasl: Object.freeze({
                mechanism: raw.RESQ_KAFKA_SASL_MECHANISM,
                username: raw.RESQ_KAFKA_SASL_USERNAME,
                password: raw.RESQ_KAFKA_SASL_PASSWORD,
              }),
            }),
      }),
      objectStorageEndpoint: raw.RESQ_OBJECT_STORAGE_ENDPOINT,
    }),
    metrics: Object.freeze({ enabled: raw.RESQ_METRICS_ENABLED }),
    telemetry: Object.freeze({
      enabled: raw.RESQ_OTEL_ENABLED,
      ...(raw.RESQ_OTEL_EXPORTER_OTLP_ENDPOINT === undefined
        ? {}
        : { exporterEndpoint: raw.RESQ_OTEL_EXPORTER_OTLP_ENDPOINT }),
      exportIntervalMs: raw.RESQ_OTEL_EXPORT_INTERVAL_MS,
    }),
    migration: Object.freeze({
      ...(raw.RESQ_MIGRATION_EXPECTED_CURRENT === undefined
        ? {}
        : { expectedCurrent: raw.RESQ_MIGRATION_EXPECTED_CURRENT }),
      ...(raw.RESQ_MIGRATION_OPERATOR === undefined
        ? {}
        : { operator: raw.RESQ_MIGRATION_OPERATOR }),
    }),
  };

  return Object.freeze(config);
}
