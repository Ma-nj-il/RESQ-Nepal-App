import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';

import { APP_CONFIG, type ApplicationConfig } from '../config/application-config.js';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly registry = new Registry();
  readonly httpRequests: Counter<'method' | 'route' | 'status_code'>;
  readonly httpDuration: Histogram<'method' | 'route' | 'status_code'>;
  readonly dependencyChecks: Counter<'dependency' | 'result'>;
  readonly circuitState: Gauge<'provider' | 'operation'>;
  readonly circuitTransitions: Counter<'provider' | 'operation' | 'state'>;

  constructor(@Inject(APP_CONFIG) config: ApplicationConfig) {
    this.registry.setDefaultLabels({ service: 'resq-platform', runtime_role: config.role });
    if (config.metrics.enabled) collectDefaultMetrics({ register: this.registry });

    this.httpRequests = new Counter({
      name: 'resq_http_requests_total',
      help: 'HTTP requests by bounded route template and status',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'resq_http_request_duration_seconds',
      help: 'HTTP request duration by bounded route template and status',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.dependencyChecks = new Counter({
      name: 'resq_dependency_checks_total',
      help: 'Bounded dependency readiness check outcomes',
      labelNames: ['dependency', 'result'],
      registers: [this.registry],
    });
    this.circuitState = new Gauge({
      name: 'resq_provider_circuit_state',
      help: 'Circuit state: 0 closed, 1 half-open, 2 open',
      labelNames: ['provider', 'operation'],
      registers: [this.registry],
    });
    this.circuitTransitions = new Counter({
      name: 'resq_provider_circuit_transitions_total',
      help: 'Provider circuit state transitions',
      labelNames: ['provider', 'operation', 'state'],
      registers: [this.registry],
    });
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }
}
