import { useCallback, useEffect, useState } from 'react';
import { bookingsService } from '../services/database/bookings';
import { isSupabaseConfigured } from '../services/database/client';
import { useAuthStore } from '../store/authStore';
import { isDemoMode } from '../utils/demoMode';
import { SAMPLE_BOOKINGS } from '../constants/demoSamples';
import { countTrips, EMPTY_TRIP_COUNTS, TripCounts } from '../services/stats/tripCounts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TripCountsState {
  counts: TripCounts;
  loading: boolean;
  error: string | null;
  /** True when the numbers come from the clearly-labelled sample trips. */
  usingSampleData: boolean;
  reload: () => void;
}

/**
 * Trip counters for the signed-in user, derived from real booking records.
 * Demo mode (or a database that is not configured) falls back to the
 * clearly-labelled sample trips — the same source the Activity screen uses —
 * and reports it via `usingSampleData` so callers can say so.
 */
export const useTripCounts = (): TripCountsState => {
  const { user } = useAuthStore();
  const userId = user?.id;

  const [counts, setCounts] = useState<TripCounts>(EMPTY_TRIP_COUNTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingSampleData, setUsingSampleData] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isSupabaseConfigured || !userId || isDemoMode() || !UUID_RE.test(userId)) {
        setCounts(countTrips(SAMPLE_BOOKINGS));
        setUsingSampleData(true);
      } else {
        const bookings = await bookingsService.getByUser(userId);
        setCounts(countTrips(bookings));
        setUsingSampleData(false);
      }
    } catch {
      setError('Could not load your trip summary.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    // Deferred like the other loaders in the app so the effect never sets
    // state synchronously during the same render pass.
    const timer = setTimeout(() => {
      run();
    }, 0);
    return () => clearTimeout(timer);
  }, [run, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { counts, loading, error, usingSampleData, reload };
};
