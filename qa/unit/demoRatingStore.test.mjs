import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useDemoRatingStore } from '../../src/store/demoRatingStore.ts';

test('demo rating stays local and rejects a second submission for the same trip', () => {
  const tripId = 'DEMO-RATING-TEST-001';
  const record = { rating: 5, feedback: 'Kind crew', submittedAt: '2026-10-24T08:00:00.000Z' };
  const save = useDemoRatingStore.getState().saveDemoRating;

  assert.equal(save(tripId, record), true);
  assert.equal(save(tripId, { ...record, rating: 1 }), false);
  assert.deepEqual(useDemoRatingStore.getState().ratingsByTripId[tripId], record);
});
