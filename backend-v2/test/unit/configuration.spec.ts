import {
  ConfigurationError,
  loadApplicationConfig,
} from '../../src/shared/infrastructure/config/application-config.js';

function secureProductionEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    RESQ_RELEASE: 'sha-1234567',
    RESQ_LOG_PRETTY: 'false',
    RESQ_DATABASE_URL: 'postgresql://runtime:secret@db.internal.example:5432/resq',
    RESQ_DATABASE_SSL_MODE: 'verify-full',
    RESQ_REDIS_CACHE_URL: 'rediss://default:secret@cache.internal.example:6380/0',
    RESQ_REDIS_QUEUE_URL: 'rediss://default:secret@queue.internal.example:6380/0',
    RESQ_KAFKA_BROKERS: 'kafka-1.internal.example:9093,kafka-2.internal.example:9093',
    RESQ_KAFKA_SSL: 'true',
    RESQ_KAFKA_SASL_MECHANISM: 'scram-sha-512',
    RESQ_KAFKA_SASL_USERNAME: 'resq-api',
    RESQ_KAFKA_SASL_PASSWORD: 'synthetic-secret',
    RESQ_OBJECT_STORAGE_ENDPOINT: 'https://objects.internal.example',
    RESQ_CORS_ORIGINS: 'https://portal.example,https://app.example',
    RESQ_OTEL_ENABLED: 'true',
    RESQ_OTEL_EXPORTER_OTLP_ENDPOINT: 'https://telemetry.internal.example',
  };
}

describe('application configuration', () => {
  it('loads immutable development defaults without reading unrelated process variables', () => {
    const config = loadApplicationConfig({ PATH: '/bin' }, 'api');

    expect(config.role).toBe('api');
    expect(config.dependencies.database.sslMode).toBe('disable');
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.dependencies.kafka.brokers)).toBe(true);
  });

  it('rejects unknown application-prefixed variables', () => {
    expect(() => loadApplicationConfig({ RESQ_DATABSE_URL: 'typo' }, 'api')).toThrow(
      ConfigurationError,
    );
  });

  it('rejects an entry-point role mismatch', () => {
    expect(() => loadApplicationConfig({ RESQ_RUNTIME_ROLE: 'worker' }, 'api')).toThrow(
      /cannot start the api entry point/,
    );
  });

  it('accepts an explicitly secured production API configuration', () => {
    const config = loadApplicationConfig(secureProductionEnvironment(), 'api');
    expect(config.environment).toBe('production');
    expect(config.telemetry.enabled).toBe(true);
    expect(config.dependencies.kafka.sasl?.mechanism).toBe('scram-sha-512');
  });

  it('rejects partial Kafka SASL configuration in every environment', () => {
    expect(() => loadApplicationConfig({ RESQ_KAFKA_SASL_USERNAME: 'incomplete' }, 'api')).toThrow(
      /must be configured together/,
    );
  });

  it('rejects plaintext, shared, local production dependencies and wildcard CORS', () => {
    const environment = secureProductionEnvironment();
    environment['RESQ_DATABASE_URL'] = 'postgresql://runtime:secret@localhost:5432/resq';
    environment['RESQ_DATABASE_SSL_MODE'] = 'disable';
    environment['RESQ_REDIS_CACHE_URL'] = 'redis://localhost:6379/0';
    environment['RESQ_REDIS_QUEUE_URL'] = 'redis://localhost:6379/0';
    environment['RESQ_KAFKA_SSL'] = 'false';
    environment['RESQ_CORS_ORIGINS'] = '*';

    expect(() => loadApplicationConfig(environment, 'api')).toThrow(ConfigurationError);
  });

  it('requires migration preconditions and a separate migration URL', () => {
    expect(() => loadApplicationConfig(secureProductionEnvironment(), 'migration')).toThrow(
      ConfigurationError,
    );

    const environment = {
      ...secureProductionEnvironment(),
      RESQ_MIGRATION_DATABASE_URL: 'postgresql://migrator:secret@db.internal.example:5432/resq',
      RESQ_MIGRATION_EXPECTED_CURRENT: 'NONE',
      RESQ_MIGRATION_OPERATOR: 'release-job-42',
    };
    expect(loadApplicationConfig(environment, 'migration').migration.expectedCurrent).toBe('NONE');
  });
});
