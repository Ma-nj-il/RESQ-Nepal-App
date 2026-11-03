import { Module } from '@nestjs/common';

import { AUDIT_WRITER, type AuditWriter } from '../shared/application/audit/audit-writer.js';
import {
  IDEMPOTENCY_EXECUTOR,
  type IdempotencyExecutor,
} from '../shared/application/idempotency/idempotency.js';
import {
  DELIVERY_WRITER,
  type DeliveryWriter,
} from '../shared/application/messaging/delivery-writer.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../shared/application/persistence/unit-of-work.js';
import { CLOCK, type Clock } from '../shared/domain/clock.js';
import { ID_GENERATOR, type IdGenerator } from '../shared/domain/id-generator.js';
import { PostgresJobIntentRelay } from '../shared/infrastructure/messaging/postgres-job-intent-relay.js';
import { BookingDispatchService } from './application/booking-dispatch.service.js';
import { DispatchRecoveryService } from './application/dispatch-recovery.service.js';
import { CoreDispatchJobProcessor } from './application/core-dispatch-job.processor.js';
import {
  CORE_DISPATCH_POLICY,
  type CoreDispatchPolicy,
} from './application/core-dispatch.policy.js';
import {
  CORE_DISPATCH_REPOSITORY,
  type CoreDispatchRepository,
} from './application/ports/core-dispatch.repository.js';
import {
  PATIENT_DATA_PROTECTOR,
  type PatientDataProtector,
} from './application/ports/patient-data-protector.js';
import { ROUTING_PROVIDER, type RoutingProvider } from './application/ports/routing-provider.js';
import {
  SAFETY_ALERT_DELIVERY,
  type SafetyAlertDelivery,
} from './application/ports/safety-alert-delivery.js';
import { SafetyService } from './application/safety.service.js';
import { TripTrackingService } from './application/trip-tracking.service.js';
import {
  BOOKING_DISPATCH_SERVICE,
  CORE_DISPATCH_JOB_PROCESSOR,
  SAFETY_SERVICE,
  TRIP_TRACKING_SERVICE,
} from './core-dispatch.tokens.js';
import { CoreDispatchWorkerRuntime } from './infrastructure/messaging/core-dispatch-worker.runtime.js';
import { PostgresCoreDispatchRepository } from './infrastructure/persistence/postgres-core-dispatch.repository.js';
import { AesPatientDataProtector } from './infrastructure/providers/aes-patient-data.protector.js';
import { DevelopmentRoutingProvider } from './infrastructure/providers/development-routing.provider.js';
import { UnavailableSafetyAlertDelivery } from './infrastructure/providers/unavailable-safety-alert.delivery.js';
import { AuthorityDispatchController } from './presentation/http/authority-dispatch.controller.js';
import { RequesterDispatchController } from './presentation/http/requester-dispatch.controller.js';
import { TenantDispatchController } from './presentation/http/tenant-dispatch.controller.js';

const DISPATCH_POLICY: CoreDispatchPolicy = Object.freeze({
  quoteTtlMs: 5 * 60_000,
  searchTtlMs: 5 * 60_000,
  offerTtlMs: 90_000,
  trackingStaleAfterMs: 30_000,
  trackingUnavailableAfterMs: 120_000,
  firstSafetyEscalationDelayMs: 30_000,
  subsequentSafetyEscalationDelayMs: 2 * 60_000,
});

const persistenceProviders = [
  PostgresCoreDispatchRepository,
  {
    provide: CORE_DISPATCH_REPOSITORY,
    useExisting: PostgresCoreDispatchRepository,
  },
  { provide: CORE_DISPATCH_POLICY, useValue: DISPATCH_POLICY },
] as const;

@Module({
  controllers: [RequesterDispatchController, TenantDispatchController, AuthorityDispatchController],
  providers: [
    ...persistenceProviders,
    {
      provide: DispatchRecoveryService,
      inject: [CORE_DISPATCH_REPOSITORY, UNIT_OF_WORK, CLOCK],
      useFactory: (
        repository: CoreDispatchRepository,
        unit: UnitOfWork,
        clock: Clock,
      ): DispatchRecoveryService => new DispatchRecoveryService(repository, unit, clock),
    },
    DevelopmentRoutingProvider,
    { provide: ROUTING_PROVIDER, useExisting: DevelopmentRoutingProvider },
    AesPatientDataProtector,
    { provide: PATIENT_DATA_PROTECTOR, useExisting: AesPatientDataProtector },
    {
      provide: BOOKING_DISPATCH_SERVICE,
      inject: [
        CORE_DISPATCH_REPOSITORY,
        ROUTING_PROVIDER,
        PATIENT_DATA_PROTECTOR,
        CORE_DISPATCH_POLICY,
        IDEMPOTENCY_EXECUTOR,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        DELIVERY_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: CoreDispatchRepository,
        routing: RoutingProvider,
        patientData: PatientDataProtector,
        policy: CoreDispatchPolicy,
        idempotency: IdempotencyExecutor,
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        delivery: DeliveryWriter,
        clock: Clock,
        ids: IdGenerator,
      ): BookingDispatchService =>
        new BookingDispatchService(
          repository,
          routing,
          patientData,
          policy,
          idempotency,
          unitOfWork,
          audit,
          delivery,
          clock,
          ids,
        ),
    },
    {
      provide: TRIP_TRACKING_SERVICE,
      inject: [
        CORE_DISPATCH_REPOSITORY,
        CORE_DISPATCH_POLICY,
        IDEMPOTENCY_EXECUTOR,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        DELIVERY_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: CoreDispatchRepository,
        policy: CoreDispatchPolicy,
        idempotency: IdempotencyExecutor,
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        delivery: DeliveryWriter,
        clock: Clock,
        ids: IdGenerator,
      ): TripTrackingService =>
        new TripTrackingService(
          repository,
          policy,
          idempotency,
          unitOfWork,
          audit,
          delivery,
          clock,
          ids,
        ),
    },
    {
      provide: SAFETY_SERVICE,
      inject: [
        CORE_DISPATCH_REPOSITORY,
        PATIENT_DATA_PROTECTOR,
        CORE_DISPATCH_POLICY,
        IDEMPOTENCY_EXECUTOR,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        DELIVERY_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: CoreDispatchRepository,
        patientData: PatientDataProtector,
        policy: CoreDispatchPolicy,
        idempotency: IdempotencyExecutor,
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        delivery: DeliveryWriter,
        clock: Clock,
        ids: IdGenerator,
      ): SafetyService =>
        new SafetyService(
          repository,
          patientData,
          policy,
          idempotency,
          unitOfWork,
          audit,
          delivery,
          clock,
          ids,
        ),
    },
  ],
  exports: [BOOKING_DISPATCH_SERVICE, TRIP_TRACKING_SERVICE, SAFETY_SERVICE],
})
export class CoreDispatchApiModule {}

@Module({
  providers: [
    ...persistenceProviders,
    UnavailableSafetyAlertDelivery,
    { provide: SAFETY_ALERT_DELIVERY, useExisting: UnavailableSafetyAlertDelivery },
    {
      provide: CORE_DISPATCH_JOB_PROCESSOR,
      inject: [
        CORE_DISPATCH_REPOSITORY,
        SAFETY_ALERT_DELIVERY,
        CORE_DISPATCH_POLICY,
        UNIT_OF_WORK,
        AUDIT_WRITER,
        DELIVERY_WRITER,
        CLOCK,
        ID_GENERATOR,
      ],
      useFactory: (
        repository: CoreDispatchRepository,
        alertDelivery: SafetyAlertDelivery,
        policy: CoreDispatchPolicy,
        unitOfWork: UnitOfWork,
        audit: AuditWriter,
        delivery: DeliveryWriter,
        clock: Clock,
        ids: IdGenerator,
      ): CoreDispatchJobProcessor =>
        new CoreDispatchJobProcessor(
          repository,
          alertDelivery,
          policy,
          unitOfWork,
          audit,
          delivery,
          clock,
          ids,
        ),
    },
    PostgresJobIntentRelay,
    CoreDispatchWorkerRuntime,
  ],
})
export class CoreDispatchWorkerModule {}
