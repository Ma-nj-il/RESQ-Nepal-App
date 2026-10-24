import { useEffect, useRef, useState } from 'react';
import { getRoadRoute, RoadRoute } from '../services/location/routeService';
import {
  RouteRefreshPoint,
  shouldRefreshTrackingRoute,
  TrackingCoordinate,
} from '../utils/tracking';

interface RouteResult {
  key: string;
  route: RoadRoute | null;
  failed: boolean;
}

export function useTrackingRoute(
  start: TrackingCoordinate | null,
  end: TrackingCoordinate | null,
  targetKey: string,
  enabled: boolean,
): { route: RoadRoute | null; loading: boolean; unavailable: boolean } {
  const [result, setResult] = useState<RouteResult | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const lastRequestRef = useRef<RouteRefreshPoint | null>(null);
  const requestRef = useRef<{ key: string; controller: AbortController } | null>(null);
  const mountedRef = useRef(false);
  const startLat = start?.lat ?? null;
  const startLng = start?.lng ?? null;
  const endLat = end?.lat ?? null;
  const endLng = end?.lng ?? null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.controller.abort();
    };
  }, []);

  useEffect(() => {
    if (
      !enabled ||
      startLat === null ||
      startLng === null ||
      endLat === null ||
      endLng === null
    ) {
      requestRef.current?.controller.abort();
      requestRef.current = null;
      lastRequestRef.current = null;
      return;
    }

    const nextStart = { lat: startLat, lng: startLng };
    if (
      !shouldRefreshTrackingRoute(
        lastRequestRef.current,
        nextStart,
        targetKey,
      )
    ) {
      return;
    }

    lastRequestRef.current = {
      ...nextStart,
      targetKey,
      requestedAt: Date.now(),
    };
    requestRef.current?.controller.abort();
    const controller = new AbortController();
    const request = { key: targetKey, controller };
    requestRef.current = request;
    setPendingKey(targetKey);
    void getRoadRoute(nextStart, { lat: endLat, lng: endLng }, controller.signal)
      .then((route) => {
        if (mountedRef.current && requestRef.current === request) {
          setResult({ key: targetKey, route, failed: !route });
        }
      })
      .catch(() => {
        if (mountedRef.current && requestRef.current === request) {
          setResult({ key: targetKey, route: null, failed: true });
        }
      })
      .finally(() => {
        if (requestRef.current === request) {
          requestRef.current = null;
          if (mountedRef.current) setPendingKey(null);
        }
      });
  }, [enabled, endLat, endLng, startLat, startLng, targetKey]);

  const currentResult = result?.key === targetKey ? result : null;

  return {
    route: currentResult?.route ?? null,
    loading: enabled && Boolean(start && end) && pendingKey === targetKey,
    unavailable: currentResult?.failed ?? false,
  };
}
