import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  Admin,
  Kafka,
  logLevel,
  type IHeaders,
  type Consumer,
  type Producer,
  type RecordMetadata,
  type SASLOptions,
} from 'kafkajs';

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
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly requestTimeoutMs: number;
  private adminConnected = false;
  private producerConnected = false;
  private adminConnecting: Promise<void> | undefined;
  private producerConnecting: Promise<void> | undefined;

  constructor(@Inject(APP_CONFIG) config: ApplicationConfig) {
    this.requestTimeoutMs = config.dependencies.timeoutMs;
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
    this.kafka = kafka;
    this.admin = kafka.admin();
    this.producer = kafka.producer({
      allowAutoTopicCreation: false,
      idempotent: true,
      maxInFlightRequests: 5,
      retry: {
        retries: 5,
        initialRetryTime: 100,
        maxRetryTime: 5_000,
      },
    });
  }

  async check(): Promise<void> {
    await this.connectAdmin();
    await this.admin.describeCluster();
  }

  /** The caller owns consumer connection, failure handling and shutdown. */
  createConsumer(groupId: string): Consumer {
    return this.kafka.consumer({
      groupId,
      allowAutoTopicCreation: false,
      maxBytes: 1048576,
      maxBytesPerPartition: 262144,
      retry: { retries: 3 },
    });
  }

  async publish(input: {
    readonly topic: string;
    readonly key: string;
    readonly value: string;
    readonly headers: IHeaders;
  }): Promise<RecordMetadata> {
    await this.connectProducer();
    const metadata = await this.producer.send({
      topic: input.topic,
      acks: -1,
      timeout: this.requestTimeoutMs,
      messages: [
        {
          key: input.key,
          value: input.value,
          headers: input.headers,
        },
      ],
    });
    const result = metadata[0];
    if (result === undefined || result.errorCode !== 0) {
      throw new Error('Kafka did not acknowledge the outbox event');
    }
    return result;
  }

  async onModuleDestroy(): Promise<void> {
    const disconnects: Promise<void>[] = [];
    if (this.producerConnected) disconnects.push(this.producer.disconnect());
    if (this.adminConnected) disconnects.push(this.admin.disconnect());
    await Promise.allSettled(disconnects);
    this.producerConnected = false;
    this.adminConnected = false;
  }

  private async connectAdmin(): Promise<void> {
    if (this.adminConnected) return;
    if (this.adminConnecting !== undefined) return this.adminConnecting;
    this.adminConnecting = this.admin
      .connect()
      .then(() => {
        this.adminConnected = true;
      })
      .finally(() => {
        this.adminConnecting = undefined;
      });
    return this.adminConnecting;
  }

  private async connectProducer(): Promise<void> {
    if (this.producerConnected) return;
    if (this.producerConnecting !== undefined) return this.producerConnecting;
    this.producerConnecting = this.producer
      .connect()
      .then(() => {
        this.producerConnected = true;
      })
      .finally(() => {
        this.producerConnecting = undefined;
      });
    return this.producerConnecting;
  }
}
