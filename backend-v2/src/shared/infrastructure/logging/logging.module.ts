import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { APP_CONFIG, type ApplicationConfig } from '../config/application-config.js';
import { RequestContextStorage } from '../context/request-context.storage.js';
import { createPinoHttpOptions } from './pino-options.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG, RequestContextStorage],
      useFactory: (config: ApplicationConfig, contexts: RequestContextStorage) => ({
        pinoHttp: createPinoHttpOptions(config, contexts),
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
