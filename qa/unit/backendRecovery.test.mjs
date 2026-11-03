import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookingRecovery } from '../../src/services/api/backend/bookingRecovery.ts';
import { recoverySnapshot, createDispatchApi } from '../../src/services/api/backend/dispatch.ts';
import { BackendError } from '../../src/services/api/backend/errors.ts';
import { bookingJson, assignmentJson, tripJson } from '../../backend-v2/src/core-dispatch/application/core-dispatch-json.ts';

const id = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const date = new Date('2026-11-03T10:00:00Z');
const identity = { userId: id, sessionId: id, assurance: 'AAL1' };
const metadata = { id, version: 1, createdAt: date, updatedAt: date };
function snapshot(version = 1, bookingId = id) {
  return recoverySnapshot({ observedAt: date.toISOString(), booking: bookingJson({ ...metadata, id: bookingId, version,
    bookingReference: 'RESQ-1', pickupGeographicUnitId: id, serviceCategory: 'AMBULANCE', urgency: 'URGENT',
    paymentMethod: 'CASH', status: 'SEARCHING', searchDeadline: date, consentFlags: { emergencyTransport: true, locationSharing: true },
    pickupLatitude: 27, pickupLongitude: 85, destinationLatitude: 27.1, destinationLongitude: 85.1 }),
    timeline: { items: [], truncated: false } });
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, loader = async () => snapshot()) {
  let now = date.getTime();
  const recovery = new BookingRecovery(loader, () => now);
  t.after(() => recovery.dispose()); recovery.activate(identity);
  return { recovery, advance: (ms) => { now += ms; } };
}

test('recovery decodes canonical projections and rejects cross-booking or inconsistent assignment graphs', () => {
  const data = snapshot();
  const assignment = assignmentJson({ ...metadata, bookingId: id, offerId: id, tenantId: id, facilityId: id, driverId: id, ambulanceId: id, acceptedAt: date });
  const trip = tripJson({ ...metadata, assignmentId: id, bookingId: id, tenantId: id, facilityId: id, driverId: id, ambulanceId: id, status: 'ASSIGNED' });
  assert.equal(recoverySnapshot({ ...data, assignment, trip }).trip.status, 'ASSIGNED');
  for (const broken of [{ assignment }, { trip }, { assignment, trip: { ...trip, bookingId: other } },
    { assignment, trip: { ...trip, driverId: other } }]) {
    assert.throws(() => recoverySnapshot({ ...data, ...broken }), { code: 'CLIENT.INVALID_RESPONSE' });
  }
});

test('refresh uses a cancelable GET without command identity', async () => {
  let input; const signal = new AbortController().signal;
  await createDispatchApi({ request: async value => { input = value; } }).recovery(id, signal);
  assert.equal(input.path, `/api/v1/bookings/${id}/recovery`); assert.equal(input.signal, signal);
  assert.equal(input.method, undefined); assert.equal(input.idempotencyKey, undefined);
});

test('session replacement and selection changes reject late responses even if cancellation is ignored', async t => {
  const first = deferred(), second = deferred(); let calls = 0;
  const { recovery } = fixture(t, () => ++calls === 1 ? first.promise : second.promise);
  const old = recovery.select(id); await turn();
  const next = recovery.select(other); await turn();
  first.resolve(snapshot()); await old;
  assert.equal(recovery.getState().bookingId, other); assert.equal(recovery.getState().snapshot, undefined);
  recovery.activate({ ...identity, sessionId: other }); second.resolve(snapshot(1, other)); await next;
  assert.deepEqual(recovery.getState(), { status: 'idle' });
});

test('coalesces an invalidation burst during a read into one follow-up and rejects old connection hints', async t => {
  const first = deferred(); let calls = 0;
  const { recovery } = fixture(t, () => ++calls === 1 ? first.promise : Promise.resolve(snapshot(3)));
  const initial = recovery.select(id); await turn();
  const connection = recovery.reconnect();
  for (let n = 1; n <= 20; n++) recovery.receiveHint(connection, { sequence: n, resource: { type: 'booking', id, version: 3 } });
  first.resolve(snapshot()); await initial;
  // The first response is behind a known version; no endless immediate retry on lag.
  assert.equal(recovery.getState().status, 'stale');
  await recovery.refresh(); assert.equal(calls, 2); assert.equal(recovery.getState().snapshot.booking.version, 3);
  recovery.receiveHint(connection - 1, { sequence: 99, resource: { type: 'booking', id, version: 99 } });
  await turn(); assert.equal(calls, 2);
});

test('gaps invalidate even when resource version is unchanged; duplicates and unrelated resources do not refetch', async t => {
  let calls = 0;
  const { recovery } = fixture(t, async () => { calls++; return snapshot(3); });
  await recovery.select(id); const connection = recovery.reconnect(); await recovery.refresh();
  const hint = { sequence: 1, resource: { type: 'booking', id, version: 3 } };
  recovery.receiveHint(connection, hint); await turn(); const baseline = calls;
  recovery.receiveHint(connection, hint);
  recovery.receiveHint(connection, { ...hint, resource: { ...hint.resource, id: other } });
  await turn(); assert.equal(calls, baseline);
  recovery.receiveHint(connection, { ...hint, sequence: 9 }); await turn();
  assert.equal(calls, baseline + 1);
});

test('backgrounding aborts reads; foreground refetches, and read freshness expires or fails on clock rollback', async t => {
  const first = deferred(); let calls = 0, aborted = false;
  const { recovery, advance } = fixture(t, async (_id, signal) => {
    if (++calls !== 1) return snapshot();
    signal.addEventListener('abort', () => { aborted = true; }); return first.promise;
  });
  const initial = recovery.select(id); await turn(); recovery.setActive(false);
  assert.equal(aborted, true); first.resolve(snapshot()); await initial;
  assert.notEqual(recovery.getState().status, 'ready');
  recovery.setActive(true); await turn(); assert.equal(recovery.getState().status, 'ready');
  advance(15000); assert.equal(recovery.getState().status, 'stale');
  await recovery.refresh(); advance(-1); assert.equal(recovery.getState().status, 'stale');
});

test('forbidden or revoked resources drop displayed data and require explicit re-selection', async t => {
  let rejected = false;
  const { recovery } = fixture(t, async () => { if (rejected) throw new BackendError({ code: 'RESOURCE.NOT_FOUND', message: 'Unavailable.', status: 404 }); return snapshot(); });
  await recovery.select(id); rejected = true; await recovery.refresh();
  assert.equal(recovery.getState().status, 'blocked'); assert.equal(recovery.getState().snapshot, undefined);
  rejected = false; await recovery.select(id); assert.equal(recovery.getState().status, 'ready');
});

test('confirmed commands prevent rollback to an older HTTP snapshot', async t => {
  let version = 1;
  const { recovery } = fixture(t, async () => snapshot(version));
  await recovery.select(id); recovery.observeBookingVersion(id, 2); await turn();
  assert.equal(recovery.getState().status, 'stale');
  version = 2; await recovery.refresh(); assert.equal(recovery.getState().snapshot.booking.version, 2);
  version = 1; await recovery.refresh(); assert.equal(recovery.getState().snapshot.booking.version, 2);
  assert.equal(recovery.getState().status, 'stale');
});
