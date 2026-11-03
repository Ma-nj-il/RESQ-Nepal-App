import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Admin, Kafka, logLevel, type SASLOptions } from 'kafkajs';

import { APP_CONFIG, type ApplicationConfig } from '../config/application-config.js';

function kafkaSasl(config: ApplicationConfig): SASLOptions | undefined {
  const sasl = config.dependencies.kafka.sasl;
  if (sasl === undefined) return undefined;

  const credentials = { username: sasl.username, password: sasl.password };
  switch (sasl.mechanism) {
    case 'plain':
      return { mechanism: 'plain', ...credentials };
    case 'scram-sha-256':
      return { mechanism: 'scram-sha-256', ...credentials };
    case 'scram-sha-512':
      return { mechanism: 'scram-sha-512', ...credentials };
  }
}

@Injectable()
export class KafkaService implements OnModuleDestroy {
  private readonly admin: Admin;
  private connected = false;
  private connecting: Promise<void> | undefined;

  constructor(@Inject(APP_CONFIG) config: ApplicationConfig) {
    const sasl = kafkaSasl(config);
    const kafka = new Kafka({
      clientId: `${config.dependencies.kafka.clientId}-${config.role}`,
      brokers: [...config.dependencies.kafka.brokers],
      ssl: config.dependencies.kafka.ssl,
      ...(sasl === undefined ? {} : { sasl }),
      connectionTimeout: config.dependencies.timeoutMs,
      requestTimeout: config.dependencies.timeoutMs,
      retry: { retries: 0 },
      logLevel: logLevel.NOTHING,
    });
    this.admin = kafka.admin();
  }

  async check(): Promise<void> {
    await this.connect();
    await this.admin.describeCluster();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) await this.admin.disconnect();
    this.connected = false;
  }

  private async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting !== undefined) return this.connecting;
    this.connecting = this.admin
      .connect()
      .then(() => {
        this.connected = true;
      })
      .finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }
}
