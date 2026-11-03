import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { loadApplicationConfig, type RuntimeRole } from '../config/application-config.js';

let telemetrySdk: NodeSDK | undefined;

function exporterUrl(base: string, signal: 'traces' | 'metrics'): string {
  return `${base.replace(/\/$/, '')}/v1/${signal}`;
}

export async function startTelemetry(role: RuntimeRole): Promise<void> {
  const config = loadApplicationConfig(process.env, role);
  if (!config.telemetry.enabled || telemetrySdk !== undefined) return;

  const endpoint = config.telemetry.exporterEndpoint;
  if (endpoint === undefined)
    throw new Error('Telemetry exporter endpoint is required when enabled');

  telemetrySdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': 'resq-platform',
      'service.version': config.release,
      'deployment.environment.name': config.environment,
      'service.instance.role': config.role,
    }),
    traceExporter: new OTLPTraceExporter({ url: exporterUrl(endpoint, 'traces') }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: exporterUrl(endpoint, 'metrics') }),
        exportIntervalMillis: config.telemetry.exportIntervalMs,
      }),
    ],
    // Keep instrumentation allowlisted. SQL, Redis commands, headers, and payloads are deliberately
    // excluded until their attributes receive a data-classification review.
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
    ],
  });

  await Promise.resolve(telemetrySdk.start());
}

export async function stopTelemetry(): Promise<void> {
  const sdk = telemetrySdk;
  telemetrySdk = undefined;
  if (sdk !== undefined) await sdk.shutdown();
}
