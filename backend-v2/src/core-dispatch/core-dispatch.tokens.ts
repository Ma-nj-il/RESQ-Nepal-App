import type { BookingDispatchService } from './application/booking-dispatch.service.js';
import type { CoreDispatchJobProcessor } from './application/core-dispatch-job.processor.js';
import type { SafetyService } from './application/safety.service.js';
import type { TripTrackingService } from './application/trip-tracking.service.js';

export const BOOKING_DISPATCH_SERVICE = Symbol('BOOKING_DISPATCH_SERVICE');
export const TRIP_TRACKING_SERVICE = Symbol('TRIP_TRACKING_SERVICE');
export const SAFETY_SERVICE = Symbol('SAFETY_SERVICE');
export const CORE_DISPATCH_JOB_PROCESSOR = Symbol('CORE_DISPATCH_JOB_PROCESSOR');

export type BookingDispatchServiceToken = BookingDispatchService;
export type TripTrackingServiceToken = TripTrackingService;
export type SafetyServiceToken = SafetyService;
export type CoreDispatchJobProcessorToken = CoreDispatchJobProcessor;
