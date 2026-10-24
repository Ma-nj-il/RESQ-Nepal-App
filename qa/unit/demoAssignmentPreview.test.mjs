import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoAssignmentPreview } from '../../src/utils/demoAssignmentPreview.ts';

test('demo assignment stays absent unless explicit demo mode is enabled', () => {
  assert.equal(
    buildDemoAssignmentPreview(false, { lat: 27.7172, lng: 85.324 }),
    null,
  );
});

test('demo assignment uses deterministic local sample data and leaves pickup unchanged', () => {
  const pickup = { lat: 27.7172, lng: 85.324 };
  const preview = buildDemoAssignmentPreview(true, pickup);

  assert.deepEqual(preview, {
    driverName: 'Maya Demo',
    vehicleRegistration: 'DEMO-AMB-001',
    vehicleModel: 'Sample ambulance · demonstration only',
    etaLabel: 'Approx. 5 min',
    distanceLabel: 'Approx. 1.2 km',
    ambulanceLocation: { lat: 27.7212, lng: 85.328 },
  });
  assert.deepEqual(pickup, { lat: 27.7172, lng: 85.324 });
  assert.equal('driverPhone' in preview, false);
});

test('demo ambulance marker is omitted when pickup coordinates are invalid', () => {
  const preview = buildDemoAssignmentPreview(true, { lat: 91, lng: 85.324 });
  assert.equal(preview?.ambulanceLocation, null);
});
