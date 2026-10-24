import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FARE_RATE_CARD } from '../../src/constants/fares.ts';
import { createDemoTripReceipt } from '../../src/utils/demoTrip.ts';

test('demo completion is unavailable unless explicit demo mode is enabled', () => {
  assert.equal(
    createDemoTripReceipt({ demoModeEnabled: false, category: 'basic' }),
    null,
  );
});

test('demo receipt uses the existing rate card and labels estimates without claiming measurement', () => {
  const trip = createDemoTripReceipt(
    {
      demoModeEnabled: true,
      category: 'basic',
      pickupAddress: 'Bir Hospital',
      destinationAddress: 'Norvic Hospital',
      routeEstimateDistanceKm: 10,
    },
    '2026-10-24T08:00:00.000Z',
  );

  assert.equal(trip?.id, 'DEMO-TRIP-001');
  assert.equal(trip?.estimatedDistanceKm, 10);
  assert.equal(trip?.fare?.baseFare, FARE_RATE_CARD.basic.base);
  assert.equal(trip?.fare?.distanceCharge, FARE_RATE_CARD.basic.perKm * 10);
  assert.equal(trip?.fare?.serviceFee, FARE_RATE_CARD.basic.serviceFee);
  assert.equal(
    trip?.fare?.totalFare,
    FARE_RATE_CARD.basic.base + FARE_RATE_CARD.basic.perKm * 10 + FARE_RATE_CARD.basic.serviceFee,
  );
  assert.equal(trip?.paymentMethod, 'cash');
});

test('ICU demo fare uses the existing ICU rate card', () => {
  const trip = createDemoTripReceipt({
    demoModeEnabled: true,
    category: 'icu',
    routeEstimateDistanceKm: 2,
  });
  assert.equal(
    trip?.fare?.totalFare,
    FARE_RATE_CARD.icu.base + FARE_RATE_CARD.icu.perKm * 2 + FARE_RATE_CARD.icu.serviceFee,
  );
});

test('missing or invalid route distance yields unavailable distance and fare', () => {
  for (const routeEstimateDistanceKm of [undefined, null, Number.NaN, -1]) {
    const trip = createDemoTripReceipt({
      demoModeEnabled: true,
      category: 'icu',
      routeEstimateDistanceKm,
    });
    assert.equal(trip?.estimatedDistanceKm, null);
    assert.equal(trip?.fare, null);
  }
});
