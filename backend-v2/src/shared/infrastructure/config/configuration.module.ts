import { DynamicModule, Global, Module } from '@nestjs/common';

import { APP_CONFIG, loadApplicationConfig, type RuntimeRole } from './application-config.js';

@Global()
@Module({})
export class ConfigurationModule {
  static forRole(role: RuntimeRole): DynamicModule {
    return {
      module: ConfigurationModule,
      providers: [
        {
          provide: APP_CONFIG,
          useFactory: () => loadApplicationConfig(process.env, role),
        },
      ],
      exports: [APP_CONFIG],
    };
  }
}
