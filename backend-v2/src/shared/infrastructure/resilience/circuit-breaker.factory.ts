import { Inject, Injectable } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { PinoLogger } from 'nestjs-pino';

import { MetricsService } from '../observability/metrics.service.js';

export interface CircuitPolicy {
  readonly timeoutMs: number;
  readonly resetTimeoutMs: number;
  readonly errorThresholdPercentage: number;
  readonly volumeThreshold: number;
  readonly capacity: number;
}

const boundedLabel = /^[a-z][a-z0-9-]{0,62}$/;

@Injectable()
export class CircuitBreakerFactory {
  constructor(
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CircuitBreakerFactory.name);
  }

  create<Arguments extends unknown[], Result>(
    provider: string,
    operation: string,
    action: (...arguments_: Arguments) => Promise<Result>,
    policy: CircuitPolicy,
  ): CircuitBreaker<Arguments, Result> {
    this.assertBoundedLabel(provider, 'provider');
    this.assertBoundedLabel(operation, 'operation');
    const labels = { provider, operation };
    const breaker = new CircuitBreaker(action, {
      timeout: policy.timeoutMs,
      resetTimeout: policy.resetTimeoutMs,
      errorThresholdPercentage: policy.errorThresholdPercentage,
      volumeThreshold: policy.volumeThreshold,
      capacity: policy.capacity,
      name: `${provider}.${operation}`,
    });

    this.metrics.circuitState.set(labels, 0);
    breaker.on('open', () => this.transition(labels, 'open', 2));
    breaker.on('halfOpen', () => this.transition(labels, 'half_open', 1));
    breaker.on('close', () => this.transition(labels, 'closed', 0));
    breaker.on('timeout', () => {
      this.logger.warn(
        { ...labels, errorCode: 'PROVIDER.TIMEOUT' },
        'Provider operation timed out',
      );
    });
    return breaker;
  }

  private transition(
    labels: { readonly provider: string; readonly operation: string },
    state: 'open' | 'half_open' | 'closed',
    value: number,
  ): void {
    this.metrics.circuitState.set(labels, value);
    this.metrics.circuitTransitions.inc({ ...labels, state });
    this.logger.warn({ ...labels, circuitState: state }, 'Provider circuit changed state');
  }

  private assertBoundedLabel(value: string, name: string): void {
    if (!boundedLabel.test(value)) {
      throw new Error(`${name} must be a bounded configuration label`);
    }
  }
}
