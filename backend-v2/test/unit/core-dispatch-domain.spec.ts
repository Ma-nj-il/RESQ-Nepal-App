import {
  cancellationRequiresOverride,
  fareAmountMinor,
  straightLineDistanceMeters,
  trackingFreshness,
  transitionIncident,
  transitionTrip,
  type TripCommand,
  type TripStatus,
} from '../../src/core-dispatch/domain/core-dispatch.js';
import { trackingJson } from '../../src/core-dispatch/application/core-dispatch-json.js';

describe('core dispatch domain invariants', () => {
  it('calculates NPR fares in integer minor units and rounds distance charges up', () => {
    expect(fareAmountMinor(10_000n, 2_500n, 1)).toBe(10_003n);
    expect(fareAmountMinor(10_000n, 2_500n, 1_000)).toBe(12_500n);
    expect(() => fareAmountMinor(-1n, 1n, 1_000)).toThrow(/non-negative/);
    expect(() => fareAmountMinor(1n, 1n, 0)).toThrow(/distance/);
  });

  it('uses deterministic geodesic distance with a positive same-point floor', () => {
    expect(
      straightLineDistanceMeters(
        { latitude: 27.7172, longitude: 85.324 },
        { latitude: 27.7172, longitude: 85.324 },
      ),
    ).toBe(1);
    expect(
      straightLineDistanceMeters(
        { latitude: 27.7172, longitude: 85.324 },
        { latitude: 27.672, longitude: 85.4298 },
      ),
    ).toBeGreaterThan(10_000);
  });

  it('allows only the named forward trip lifecycle', () => {
    const allowed: readonly [TripStatus, TripCommand, TripStatus][] = [
      ['ASSIGNED', 'PREPARE', 'PREPARING_TO_DEPART'],
      ['ASSIGNED', 'DEPART_TO_PICKUP', 'EN_ROUTE_TO_PICKUP'],
      ['PREPARING_TO_DEPART', 'DEPART_TO_PICKUP', 'EN_ROUTE_TO_PICKUP'],
      ['EN_ROUTE_TO_PICKUP', 'ARRIVE_AT_PICKUP', 'ARRIVED_AT_PICKUP'],
      ['ARRIVED_AT_PICKUP', 'BOARD_PATIENT', 'PATIENT_ON_BOARD'],
      ['PATIENT_ON_BOARD', 'DEPART_TO_DESTINATION', 'EN_ROUTE_TO_DESTINATION'],
      ['EN_ROUTE_TO_DESTINATION', 'ARRIVE_AT_DESTINATION', 'ARRIVED_AT_DESTINATION'],
      ['ARRIVED_AT_DESTINATION', 'COMPLETE', 'COMPLETED'],
    ];
    for (const [from, command, to] of allowed) expect(transitionTrip(from, command)).toBe(to);

    expect(transitionTrip('ARRIVED_AT_PICKUP', 'DEPART_TO_PICKUP')).toBeUndefined();
    expect(transitionTrip('COMPLETED', 'PREPARE')).toBeUndefined();
    expect(transitionTrip('CANCELLED', 'COMPLETE')).toBeUndefined();
  });

  it('requires override only after the patient has boarded', () => {
    expect(cancellationRequiresOverride('ARRIVED_AT_PICKUP')).toBe(false);
    expect(cancellationRequiresOverride('PATIENT_ON_BOARD')).toBe(true);
    expect(cancellationRequiresOverride('EN_ROUTE_TO_DESTINATION')).toBe(true);
    expect(cancellationRequiresOverride('ARRIVED_AT_DESTINATION')).toBe(true);
  });

  it('evaluates tracking freshness at exact policy boundaries', () => {
    const evaluatedAt = new Date('2026-11-03T12:00:00.000Z');
    expect(trackingFreshness(undefined, evaluatedAt, 30_000, 120_000)).toBe('UNAVAILABLE');
    expect(
      trackingFreshness(new Date('2026-11-03T11:59:30.001Z'), evaluatedAt, 30_000, 120_000),
    ).toBe('LIVE');
    expect(
      trackingFreshness(new Date('2026-11-03T11:59:30.000Z'), evaluatedAt, 30_000, 120_000),
    ).toBe('STALE');
    expect(
      trackingFreshness(new Date('2026-11-03T11:58:00.000Z'), evaluatedAt, 30_000, 120_000),
    ).toBe('UNAVAILABLE');
    expect(
      trackingFreshness(new Date('2026-11-03T12:00:01.000Z'), evaluatedAt, 30_000, 120_000),
    ).toBe('LIVE');
  });

  it('reports tracking age from capture time rather than delayed receipt time', () => {
    const evaluatedAt = new Date('2026-11-03T12:00:00.000Z');
    expect(
      trackingJson(
        {
          tripId: '018f0000-0000-7000-8000-000000000001',
          latitude: 27.7172,
          longitude: 85.324,
          accuracyMeters: 8,
          quality: 'GOOD',
          sequence: 1n,
          capturedAt: new Date('2026-11-03T11:58:30.000Z'),
          receivedAt: new Date('2026-11-03T11:59:55.000Z'),
          version: 1,
        },
        'STALE',
        evaluatedAt,
      ),
    ).toMatchObject({ freshness: 'STALE', ageSeconds: 90 });
  });

  it('keeps resolved safety incidents terminal', () => {
    expect(transitionIncident('OPEN', 'ACKNOWLEDGE')).toBe('ACKNOWLEDGED');
    expect(transitionIncident('ACKNOWLEDGED', 'ESCALATE')).toBe('ESCALATED');
    expect(transitionIncident('ESCALATED', 'RESOLVE')).toBe('RESOLVED');
    expect(transitionIncident('RESOLVED', 'ESCALATE')).toBeUndefined();
  });
});
