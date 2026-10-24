import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorizedDriverStatus } from '../../src/utils/homeBooking.ts';

test('Driver Mode authorization requires an actually verified driver profile', () => {
  assert.equal(isAuthorizedDriverStatus('verified'), true);
  assert.equal(isAuthorizedDriverStatus('pending'), false);
  assert.equal(isAuthorizedDriverStatus('rejected'), false);
  assert.equal(isAuthorizedDriverStatus(null), false);
});

test('Find Ambulance keeps searching and assigned tracking on the existing Processing screen', () => {
  const homeSource = readFileSync(
    new URL('../../src/screens/user/HomeScreen.tsx', import.meta.url),
    'utf8',
  );
  const processingSource = readFileSync(
    new URL('../../src/screens/user/ProcessingScreen.tsx', import.meta.url),
    'utf8',
  );
  const arrivalSource = readFileSync(
    new URL('../../src/screens/user/ArrivalScreen.tsx', import.meta.url),
    'utf8',
  );
  const receiptSource = readFileSync(
    new URL('../../src/screens/user/ShareReceiptScreen.tsx', import.meta.url),
    'utf8',
  );
  const ratingSource = readFileSync(
    new URL('../../src/screens/user/RatingScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.match(homeSource, /navigation\.navigate\(['"]Processing['"]/);
  assert.doesNotMatch(homeSource, /navigation\.(?:navigate|replace)\(['"]BookingStatus['"]/);
  assert.match(homeSource, /processingNavigation\.current/);
  assert.match(homeSource, /accessibilityLabel="Open menu"/);
  assert.match(homeSource, /<MapCanvas/);
  assert.match(homeSource, /Select Ambulance Type/);
  assert.match(homeSource, /Find Ambulance/);
  assert.match(processingSource, /creatingRef\.current/);
  assert.doesNotMatch(processingSource, /navigation\.(?:navigate|replace)\(['"]BookingStatus['"]/);
  assert.match(processingSource, /<SearchRadar active=\{isFocused\}/);
  assert.match(processingSource, /accessibilityLabel="Open menu"/);
  assert.match(processingSource, /navigation\.navigate\('MenuDrawer'\)/);
  assert.match(processingSource, /DEMO_ASSIGNMENT_TRANSITION_MS = 8000/);
  assert.match(processingSource, /Preview Assigned Ambulance/);
  assert.match(processingSource, /buildDemoAssignmentPreview\(demoRun && demoAssigned, pickupPoint\)/);
  assert.match(processingSource, /DEMO PREVIEW/);
  assert.match(processingSource, /if \(demoRun && demoAssigned\)[\s\S]*?Driver calling is not connected[\s\S]*?return;[\s\S]*?openNativeDialer/);
  assert.match(processingSource, /SECURE_TRIP_TRACKING_ENABLED && isLiveBooking/);
  assert.match(processingSource, /if \(!demoRun \|\| !demoAssigned\) return/);
  assert.match(processingSource, /navigation\.navigate\('Arrival', \{ demoTrip \}\)/);
  assert.match(processingSource, /isFocused &&/);
  assert.match(processingSource, /bookingsService\.getById\(booking\.id\)/);
  assert.match(processingSource, /assignedCrewService[\s\S]*?getForBooking\(assignedBookingId\)/);
  assert.match(processingSource, /isAssignedDriverLocation\(latestLocation, booking\.driver_id\)/);
  assert.match(processingSource, /isFreshTrackingLocation\(latestLocation, trackingNow\)/);
  assert.match(processingSource, /openNativeDialer\(crew\?\.driverPhone/);
  assert.match(processingSource, /useTrackingRoute\(/);
  assert.match(arrivalSource, /if \(demoTrip\)[\s\S]*?navigation\.navigate\('Rating', \{ demoTrip \}\)/);
  assert.match(arrivalSource, /if \(!canPersist \|\| !bookingId\)[\s\S]*?real completed booking is required/);
  assert.match(receiptSource, /isDemoMode\(\).*route\.params\?\.demoTrip/);
  assert.match(receiptSource, /Continue to Rating/);
  assert.match(receiptSource, /Unavailable · final fare not recorded/);
  assert.match(receiptSource, /booking\.distance_km == null[\s\S]*?Unavailable/);
  assert.match(ratingSource, /if \(demoRun\)[\s\S]*?saveDemoRating/);
  assert.match(ratingSource, /An authorized assigned driver and completed booking are required/);
  assert.match(ratingSource, /navigation\.popTo\('Home'\)/);
});
