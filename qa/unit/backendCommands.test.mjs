import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandIntent } from '../../src/services/api/backend/commandIntent.ts';
import { BackendError } from '../../src/services/api/backend/errors.ts';
import { booking, fareQuote, trip, tracking, incident, createDispatchApi } from '../../src/services/api/backend/dispatch.ts';
import { cursorPage, text } from '../../src/services/api/backend/decoders.ts';
import { bookingJson, fareQuoteJson, tripJson, trackingJson, incidentJson } from '../../backend-v2/src/core-dispatch/application/core-dispatch-json.ts';

const id = '00000000-0000-4000-8000-000000000001';
const date = new Date('2026-11-03T10:00:00Z');
const metadata = { id, version: 1, createdAt: date, updatedAt: date };

test('ambiguous commands preserve body/key/version and coalesce presses; success never resends', async () => {
  const sent = [];
  let ids = 0;
  const input = { score: 4, nested: { value: 'original' } };
  const intent = new CommandIntent(input, async (value, identity) => {
    sent.push({ value: structuredClone(value), identity });
    value.nested.value = 'changed by adapter';
    if (sent.length === 1) throw new Error('response lost after commit');
    return 'confirmed';
  }, () => `key-${++ids}`, 9);
  input.score = 1;
  input.nested.value = 'edited by UI';
  const first = intent.run();
  assert.equal(first, intent.run());
  await assert.rejects(first);
  assert.equal(await intent.run(), 'confirmed');
  assert.equal(await intent.run(), 'confirmed');
  assert.equal(ids, 1);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[0].value.score, 4);
  assert.equal(sent[0].identity.expectedVersion, 9);
});

test('retry retention deadline, clock rollback and Retry-After block dispatch', async () => {
  let now = 1000, calls = 0;
  const intent = new CommandIntent({}, async () => {
    calls++;
    throw new BackendError({ code: 'RATE_LIMIT.EXCEEDED', message: 'Wait.', status: 429, retryAfterSeconds: 15 });
  }, () => id, 0, () => now);
  await assert.rejects(intent.run());
  await assert.rejects(intent.run(), { code: 'CLIENT.RETRY_LATER' });
  now = 0;
  await assert.rejects(intent.run(), { code: 'CLIENT.RECONCILIATION_REQUIRED' });
  now = 1000 + 23 * 60 * 60 * 1000;
  await assert.rejects(intent.run(), { code: 'CLIENT.RECONCILIATION_REQUIRED' });
  assert.equal(calls, 1);
});

test('validation can release a new intent but cannot erase a prior ambiguous attempt', async () => {
  let attempts = 0;
  const reject = () => { throw new BackendError({ code: 'REQUEST.INVALID', message: 'Invalid.', status: 400 }); };
  const rejected = new CommandIntent({}, reject, () => id);
  await assert.rejects(rejected.run());
  assert.equal(rejected.canReplace, true);
  const stale = new CommandIntent({}, async () => {
    throw new BackendError({ code: 'REQUEST.STALE_VERSION', message: 'Refresh first.', status: 409 });
  }, () => id);
  await assert.rejects(stale.run());
  assert.equal(stale.canReplace, true);
  const malformed = new CommandIntent({}, async () => {
    throw new BackendError({ code: 'CLIENT.INVALID_RESPONSE', message: 'Unknown outcome.', status: 400 });
  }, () => id);
  await assert.rejects(malformed.run());
  assert.equal(malformed.canReplace, false);
  const ambiguous = new CommandIntent({}, () => {
    if (++attempts === 1) throw new Error('lost response');
    return reject();
  }, () => id);
  await assert.rejects(ambiguous.run());
  await assert.rejects(ambiguous.run());
  assert.equal(ambiguous.canReplace, false);
});

test('mobile dispatch decoders consume actual backend quote/booking/trip projections', () => {
  const coordinates = { pickupLatitude: 27.7, pickupLongitude: 85.3, destinationLatitude: 27.8, destinationLongitude: 85.4 };
  const quote = fareQuote(fareQuoteJson({ ...metadata, ...coordinates, serviceCategory: 'AMBULANCE', distanceMeters: 1000,
    durationSeconds: 60, routeSource: 'DEVELOPMENT', routeQuality: 'DEVELOPMENT_ESTIMATE', amountMinor: 9007199254740993n,
    currency: 'NPR', policyVersion: 'phase5-v1', expiresAt: date }));
  assert.equal(quote.policyVersion, 'phase5-v1');
  assert.equal(quote.fare.amountMinor, '9007199254740993');
  const decoded = booking(bookingJson({ ...metadata, ...coordinates, bookingReference: 'RESQ-1', pickupGeographicUnitId: id,
    serviceCategory: 'AMBULANCE', urgency: 'URGENT', paymentMethod: 'CASH', status: 'SEARCHING', searchDeadline: date,
    consentFlags: { emergencyTransport: true, locationSharing: true } }));
  assert.equal(decoded.status, 'SEARCHING');
  assert.equal(decoded.completedAt, undefined);
  const completed = trip(tripJson({ ...metadata, assignmentId: id, bookingId: id, tenantId: id, facilityId: id, driverId: id,
    ambulanceId: id, status: 'COMPLETED', completedAt: date, distanceMeters: 1000n, finalFareMinor: 9007199254740993n,
    finalFareCurrency: 'NPR', finalFareProvenance: 'POLICY_QUOTE' }));
  assert.equal(completed.finalFare.amountMinor, '9007199254740993');
});

test('unavailable tracking and escalated incidents preserve canonical semantics', () => {
  assert.deepEqual(tracking({ tripId: id, freshness: 'UNAVAILABLE' }), { tripId: id, freshness: 'UNAVAILABLE' });
  assert.throws(() => tracking({ tripId: id, freshness: 'LIVE' }), { code: 'CLIENT.INVALID_RESPONSE' });
  const snapshot = tracking(trackingJson({ tripId: id, latitude: 27, longitude: 85, accuracyMeters: 8, quality: 'GOOD',
    sequence: 9007199254740993n, capturedAt: date, receivedAt: new Date(date.getTime() + 60000), version: 1 }, 'STALE', new Date(date.getTime() + 60000)));
  assert.equal(snapshot.ageSeconds, 60);
  assert.equal(snapshot.sequence, '9007199254740993');
  assert.equal(snapshot.freshness, 'STALE');
  assert.equal(incident(incidentJson({ ...metadata, incidentType: 'SOS', severity: 'CRITICAL', status: 'ESCALATED', escalationTier: 2 })).status, 'ESCALATED');
});

test('requester cancellation keeps observed version, key and reason without tenant override', async () => {
  let request;
  const api = createDispatchApi({ request: async (input) => { request = input; return {}; } });
  await api.cancelBooking(id, { reasonCode: 'REQUESTER_REQUESTED', reason: 'No longer needed' }, { idempotencyKey: 'same-key', expectedVersion: 7 });
  assert.equal(request.path, `/api/v1/bookings/${id}/cancellation`);
  assert.equal(request.expectedVersion, 7);
  assert.equal(request.idempotencyKey, 'same-key');
  assert.deepEqual(request.body, { reasonCode: 'REQUESTER_REQUESTED', reason: 'No longer needed' });
  assert.throws(() => api.trip('../other'), { code: 'CLIENT.INVALID_RESPONSE' });
  await api.bookings(id);
  assert.deepEqual(request.query, { afterId: id });
  assert.deepEqual(cursorPage(text)({ items: ['one'], nextCursor: id }), { items: ['one'], nextCursor: id });
  assert.throws(() => cursorPage(text)({ items: [], nextAfterId: id }), { code: 'CLIENT.INVALID_RESPONSE' });
});
