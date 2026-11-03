import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';

import { APP_CONFIG, type ApplicationConfig } from '../config/application-config.js';
import { applicationDataSourceOptions } from './data-source-options.js';

@Injectable()
export class DatabaseService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly dataSource: DataSource;
  private initialization: Promise<DataSource> | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: ApplicationConfig,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DatabaseService.name);
    this.dataSource = new DataSource(applicationDataSourceOptions(config));
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.check();
    } catch {
      this.logger.warn(
        { errorCode: 'DEPENDENCY.DATABASE_UNAVAILABLE' },
        'Database unavailable during startup; readiness remains false',
      );
    }
  }

  async getDataSource(): Promise<DataSource> {
    if (this.dataSource.isInitialized) return this.dataSource;
    if (this.initialization !== undefined) return this.initialization;

    this.initialization = this.dataSource.initialize().finally(() => {
      this.initialization = undefined;
    });
    return this.initialization;
  }

  async check(): Promise<void> {
    const source = await this.getDataSource();
    await source.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }

  timeoutMs(): number {
    return this.config.dependencies.timeoutMs;
  }
}
