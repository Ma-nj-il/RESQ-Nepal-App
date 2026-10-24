import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildGoogleMapsDirectionsUrl,
  canAdvanceDriverTripPhase,
  getDriverTripDestination,
  isValidTripCoordinate,
  phaseFromBookingStatus,
} from '../../src/utils/driverTrip.ts';
import {
  ARRIVAL_RADIUS_METERS,
  createSimulatedArrivalFixes,
  emptyArrivalDetector,
  isUsableArrivalFix,
  updateArrivalDetection,
} from '../../src/utils/arrivalDetection.ts';

test('driver trip phases map persisted booking statuses without adding status names', () => {
  assert.equal(phaseFromBookingStatus('assigned'), 'pickup');
  assert.equal(phaseFromBookingStatus('arriving'), 'pickup');
  assert.equal(phaseFromBookingStatus('arrived'), 'arrived');
  assert.equal(phaseFromBookingStatus('started'), 'started');
  assert.equal(phaseFromBookingStatus('completed'), 'completed');
  assert.equal(phaseFromBookingStatus('cancelled'), null);
});

test('driver trip phase transitions allow only the next ordered action', () => {
  assert.equal(canAdvanceDriverTripPhase('pickup', 'arrived'), true);
  assert.equal(canAdvanceDriverTripPhase('arrived', 'started'), true);
  assert.equal(canAdvanceDriverTripPhase('started', 'hospital-arrived'), true);
  assert.equal(canAdvanceDriverTripPhase('hospital-arrived', 'completed'), true);
  assert.equal(canAdvanceDriverTripPhase('pickup', 'started'), false);
  assert.equal(canAdvanceDriverTripPhase('completed', 'completed'), false);
});

test('pickup and hospital phases navigate to their own booking coordinates', () => {
  const pickup = { lat: 27.7172, lng: 85.324 };
  const hospital = { lat: 27.7245, lng: 85.3128 };
  assert.deepEqual(getDriverTripDestination('pickup', pickup, hospital), pickup);
  assert.deepEqual(getDriverTripDestination('arrived', pickup, hospital), pickup);
  assert.deepEqual(getDriverTripDestination('started', pickup, hospital), hospital);
  assert.deepEqual(getDriverTripDestination('hospital-arrived', pickup, hospital), hospital);
  assert.equal(
    getDriverTripDestination('pickup', { lat: 91, lng: 85.324 }, hospital),
    null,
  );
});

test('Google Maps directions URL uses valid encoded coordinates and driving navigation', () => {
  assert.equal(
    buildGoogleMapsDirectionsUrl(27.7172, 85.324),
    'https://www.google.com/maps/dir/?api=1&destination=27.7172%2C85.324&travelmode=driving&dir_action=navigate',
  );
  assert.equal(buildGoogleMapsDirectionsUrl(91, 85.324), null);
  assert.equal(buildGoogleMapsDirectionsUrl(27.7172, Number.NaN), null);
  assert.equal(isValidTripCoordinate(27.7172, 85.324), true);
  assert.equal(isValidTripCoordinate(-91, 0), false);
});

test('arrival assistance requires three fresh, accurate samples inside the destination radius', () => {
  const target = { lat: 27.7172, lng: 85.324 };
  const fixes = createSimulatedArrivalFixes(target, 100_000);
  let state = emptyArrivalDetector();
  assert.equal(ARRIVAL_RADIUS_METERS, 100);
  fixes.forEach((fix, index) => {
    const result = updateArrivalDetection(state, fix, target, 100_000);
    state = result.state;
    assert.equal(result.reached, index === 2);
  });
  assert.equal(state.reached, true);
  assert.equal(fixes.every((fix) => fix.source === 'simulated'), true);
});

test('arrival assistance rejects inaccurate, stale, future, and implausible GPS fixes', () => {
  const target = { lat: 27.7172, lng: 85.324 };
  const accurateFix = {
    ...target,
    accuracy: 10,
    timestamp: 100_000,
    source: 'gps',
  };
  assert.equal(isUsableArrivalFix({ ...accurateFix, accuracy: 80 }, 100_000), false);
  assert.equal(isUsableArrivalFix(accurateFix, 120_001), false);
  assert.equal(isUsableArrivalFix({ ...accurateFix, timestamp: 100_001 }, 100_000), false);

  const first = updateArrivalDetection(
    emptyArrivalDetector(),
    accurateFix,
    target,
    100_000,
  );
  const jump = updateArrivalDetection(
    first.state,
    { ...accurateFix, lat: 27.7272, timestamp: 105_000 },
    target,
    105_000,
  );
  assert.equal(jump.valid, false);
  assert.equal(jump.state.consecutiveSamples, 0);
});

test('leaving the geofence resets the consecutive-sample suggestion without changing trip state', () => {
  const target = { lat: 27.7172, lng: 85.324 };
  const fixes = createSimulatedArrivalFixes(target, 100_000);
  let state = emptyArrivalDetector();
  for (const fix of fixes.slice(0, 2)) {
    state = updateArrivalDetection(state, fix, target, 100_000).state;
  }
  const outside = updateArrivalDetection(
    state,
    {
      lat: target.lat + 0.01,
      lng: target.lng,
      accuracy: 10,
      timestamp: 100_000,
      source: 'gps',
    },
    target,
    100_000,
  );
  assert.equal(outside.reached, false);
  assert.equal(outside.state.consecutiveSamples, 0);
  assert.equal(canAdvanceDriverTripPhase('started', 'completed'), false);
});

test('hospital proximity remains a suggestion and the onboard phase targets the hospital', () => {
  const hospital = { lat: 27.7245, lng: 85.3128 };
  const fixes = createSimulatedArrivalFixes(hospital, 100_000);
  let state = emptyArrivalDetector();
  let reached = false;
  for (const fix of fixes) {
    const result = updateArrivalDetection(state, fix, hospital, 100_000);
    state = result.state;
    reached = result.reached;
  }
  assert.equal(reached, true);
  assert.equal(getDriverTripDestination('started', { lat: 27.7, lng: 85.3 }, hospital), hospital);
  assert.equal(phaseFromBookingStatus('started'), 'started');
  assert.equal(canAdvanceDriverTripPhase('started', 'completed'), false);
});

test('demo arrival simulation is isolated from real GPS and the hosted tracking write gate', async () => {
  const src = new URL('../../src/', import.meta.url);
  const [hook, screen] = await Promise.all([
    readFile(new URL('hooks/useDriverTripLocation.ts', src), 'utf8'),
    readFile(new URL('screens/driver/DriverTripScreen.tsx', src), 'utf8'),
  ]);
  assert.match(hook, /!demoMode/);
  assert.match(screen, /createSimulatedArrivalFixes/);
  assert.match(screen, /walkthrough && arrivalPhase/);
  assert.match(screen, /Simulated location — device GPS is not used/);
});

test('the User tracking screen refreshes the same booking and exposes completion actions', async () => {
  const source = new URL('../../src/screens/user/TripTrackingScreen.tsx', import.meta.url);
  const screen = await readFile(source, 'utf8');
  assert.match(screen, /bookingsService\.getById\(trackingBookingId\)/);
  assert.match(screen, /isAssignedDriverLocation\(location, data\.driver_id\)/);
  assert.match(screen, /booking\.status === 'completed'/);
  assert.match(screen, /navigation\.navigate\('ShareReceipt', \{ booking \}\)/);
  assert.match(screen, /navigation\.navigate\('Rating', \{ bookingId, booking \}\)/);
});

test('Driver screens use the hamburger drawer without persistent demo labels or bottom tabs', async () => {
  const source = new URL('../../src/', import.meta.url);
  const [home, profile, trip, navigator, drawer] = await Promise.all([
    readFile(new URL('screens/driver/DriverHomeScreen.tsx', source), 'utf8'),
    readFile(new URL('screens/driver/DriverProfileScreen.tsx', source), 'utf8'),
    readFile(new URL('screens/driver/DriverTripScreen.tsx', source), 'utf8'),
    readFile(new URL('navigation/DriverNavigator.tsx', source), 'utf8'),
    readFile(new URL('screens/driver/DriverDrawerScreen.tsx', source), 'utf8'),
  ]);
  assert.doesNotMatch(home, /bottomNav|DEMO DRIVER|DEMO MODE/i);
  assert.doesNotMatch(profile, /DEMO DRIVER|DEMO MODE/i);
  assert.doesNotMatch(trip, /DEMO DRIVER|DEMO MODE/i);
  assert.match(home, /DriverNavigationHeader/);
  assert.match(trip, /DriverNavigationHeader/);
  assert.match(navigator, /name="DriverDrawer"/);
  assert.match(drawer, /Requests & Alerts/);
  assert.match(drawer, /Switch to User Mode/);
  assert.match(drawer, /Log Out/);
});
