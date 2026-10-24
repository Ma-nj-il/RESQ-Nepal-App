import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canPublishRealTracking,
  isAssignedDriverLocation,
  isFreshTrackingLocation,
  isTrackableBookingStatus,
  shouldRefreshTrackingRoute,
} from '../../src/utils/tracking.ts';

test('only configured, non-demo drivers can publish for an active assigned trip', () => {
  assert.equal(canPublishRealTracking(false, true, 'booking-1', 'driver-1', 'assigned', true), true);
  assert.equal(canPublishRealTracking(false, true, 'booking-1', 'driver-1', 'assigned', false), false);
  assert.equal(canPublishRealTracking(true, true, 'booking-1', 'driver-1', 'assigned', true), false);
  assert.equal(canPublishRealTracking(false, false, 'booking-1', 'driver-1', 'started', true), false);
  assert.equal(canPublishRealTracking(false, true, 'booking-1', 'driver-1', 'completed', true), false);
  assert.equal(canPublishRealTracking(false, true, 'booking-1', null, 'started', true), false);
});

test('missing, invalid, stale and future GPS fixes are not displayable', () => {
  const now = Date.parse('2026-10-24T12:00:00.000Z');
  assert.equal(isFreshTrackingLocation(null, now), false);
  assert.equal(
    isFreshTrackingLocation({ lat: 0, lng: 0, recorded_at: '2026-10-24T11:58:29.000Z' }, now),
    false,
  );
  assert.equal(
    isFreshTrackingLocation({ lat: 91, lng: 0, recorded_at: '2026-10-24T11:59:59.000Z' }, now),
    false,
  );
  assert.equal(
    isFreshTrackingLocation({ lat: 27, lng: 85, recorded_at: '2026-10-24T12:00:01.000Z' }, now),
    false,
  );
  assert.equal(
    isFreshTrackingLocation({ lat: 27, lng: 85, recorded_at: '2026-10-24T11:59:59.000Z' }, now),
    true,
  );
});

test('tracking eligibility ends after cancellation and completion', () => {
  for (const status of ['assigned', 'arriving', 'arrived', 'started']) {
    assert.equal(isTrackableBookingStatus(status), true);
  }
  for (const status of ['completed', 'cancelled', 'rejected', 'pending']) {
    assert.equal(isTrackableBookingStatus(status), false);
  }
});

test('patient display accepts only the assigned driver location record', () => {
  assert.equal(isAssignedDriverLocation({ driver_id: 'driver-1' }, 'driver-1'), true);
  assert.equal(isAssignedDriverLocation({ driver_id: 'driver-2' }, 'driver-1'), false);
  assert.equal(isAssignedDriverLocation(null, 'driver-1'), false);
  assert.equal(isAssignedDriverLocation({ driver_id: 'driver-1' }, null), false);
});

test('ambulance road-route refresh is rate-limited unless movement is meaningful', () => {
  const first = {
    lat: 27.7172,
    lng: 85.324,
    targetKey: 'booking-1:pickup',
    requestedAt: 1000,
  };
  assert.equal(
    shouldRefreshTrackingRoute(first, { lat: 27.7173, lng: 85.324 }, first.targetKey, 2000),
    false,
  );
  assert.equal(
    shouldRefreshTrackingRoute(first, { lat: 27.7172, lng: 85.3252 }, first.targetKey, 2000),
    false,
  );
  assert.equal(
    shouldRefreshTrackingRoute(first, { lat: 27.7172, lng: 85.3252 }, first.targetKey, 46_001),
    true,
  );
  assert.equal(
    shouldRefreshTrackingRoute(first, { lat: 27.7172, lng: 85.324 }, first.targetKey, 46_001),
    false,
  );
  assert.equal(
    shouldRefreshTrackingRoute(first, { lat: 27.7172, lng: 85.324 }, first.targetKey, 91_001),
    true,
  );
  assert.equal(
    shouldRefreshTrackingRoute(first, { lat: 27.7172, lng: 85.324 }, 'booking-1:destination', 2000),
    true,
  );
});

test('local migration limits trip locations to active booking participants and assigned drivers', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20261024_secure_active_trip_tracking.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /b\.id = trip_locations\.booking_id/);
  assert.match(migration, /trip_locations\.driver_id = b\.driver_id/);
  assert.match(migration, /b\.user_id = auth\.uid\(\)/);
  assert.match(migration, /d\.user_id = auth\.uid\(\)/);
  assert.match(migration, /trip_locations\.driver_id = d\.id/);
  assert.match(migration, /b\.status in \('assigned', 'arriving', 'arrived', 'started'\)/);
  assert.match(migration, /drop policy if exists "trip_locations_select_involved"/);
  assert.match(migration, /drop policy if exists "trip_locations_insert_driver"/);
});
