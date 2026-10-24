import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { tripsService } from '../services/database/trips';
import { isSupabaseConfigured } from '../services/database/client';
import {
  ArrivalLocationFix,
  isUsableArrivalFix,
} from '../utils/arrivalDetection';
import {
  canPublishRealTracking,
  isTrackableBookingStatus,
  SECURE_TRIP_TRACKING_ENABLED,
  TrackingCoordinate,
} from '../utils/tracking';

export type DriverLocationState =
  | 'inactive'
  | 'requesting'
  | 'waiting'
  | 'sharing'
  | 'paused'
  | 'stale'
  | 'permission-denied'
  | 'unavailable'
  | 'error';

interface UseDriverTripLocationOptions {
  bookingId?: string | null;
  driverId?: string | null;
  status?: string | null;
  demoMode: boolean;
  onLocationFix?: (fix: ArrivalLocationFix | null) => void;
}

export function useDriverTripLocation({
  bookingId,
  driverId,
  status,
  demoMode,
  onLocationFix,
}: UseDriverTripLocationOptions): {
  state: DriverLocationState;
  currentLocation: TrackingCoordinate | null;
  currentFix: ArrivalLocationFix | null;
} {
  const [state, setState] = useState<DriverLocationState>('inactive');
  const [currentLocation, setCurrentLocation] = useState<TrackingCoordinate | null>(null);
  const [currentFix, setCurrentFix] = useState<ArrivalLocationFix | null>(null);
  const currentFixRef = useRef<ArrivalLocationFix | null>(null);
  const enabled = canPublishRealTracking(
    demoMode,
    isSupabaseConfigured,
    bookingId,
    driverId,
    status,
    SECURE_TRIP_TRACKING_ENABLED,
  );
  const observeOnly = Boolean(
    !demoMode &&
    bookingId &&
      driverId &&
      status &&
      isTrackableBookingStatus(status),
  );

  useEffect(() => {
    if (!observeOnly || !bookingId || !driverId) {
      const reset = setTimeout(() => {
        setState('inactive');
        setCurrentLocation(null);
        setCurrentFix(null);
        currentFixRef.current = null;
        onLocationFix?.(null);
      }, 0);
      return () => clearTimeout(reset);
    }

    let disposed = false;
    let starting = false;
    let appState = AppState.currentState;
    let subscription: Location.LocationSubscription | null = null;
    let writeInFlight = false;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;

    const stopWatching = () => {
      subscription?.remove();
      subscription = null;
    };

    const receivePosition = (position: Location.LocationObject) => {
      if (disposed) return;
      const { latitude, longitude, heading, speed, accuracy } = position.coords;
      const point = { lat: latitude, lng: longitude };
      if (
        !Number.isFinite(point.lat) ||
        !Number.isFinite(point.lng) ||
        point.lat < -90 ||
        point.lat > 90 ||
        point.lng < -180 ||
        point.lng > 180
      ) {
        setState('error');
        return;
      }
      const fix: ArrivalLocationFix = {
        ...point,
        accuracy,
        timestamp: position.timestamp,
        source: 'gps',
      };
      currentFixRef.current = fix;
      setCurrentLocation(point);
      setCurrentFix(fix);
      onLocationFix?.(fix);
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        if (disposed) return;
        setCurrentLocation(null);
        setCurrentFix(null);
        currentFixRef.current = null;
        onLocationFix?.(null);
        setState('stale');
      }, 15_001);
      if (!enabled || !isUsableArrivalFix(fix)) {
        setState('waiting');
        return;
      }
      if (writeInFlight) return;
      writeInFlight = true;
      void tripsService
        .recordLocation({
          booking_id: bookingId!,
          driver_id: driverId!,
          lat: point.lat,
          lng: point.lng,
          heading: Number.isFinite(heading) ? heading ?? undefined : undefined,
          speed_kmh:
            speed != null && Number.isFinite(speed) && speed >= 0
              ? speed * 3.6
              : undefined,
        })
        .then(() => {
          if (!disposed) setState('sharing');
        })
        .catch(() => {
          if (!disposed) setState('error');
        })
        .finally(() => {
          writeInFlight = false;
        });
    };

    const startWatching = async () => {
      if (disposed || starting || subscription || appState !== 'active') return;
      starting = true;
      setState('requesting');
      try {
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (disposed) return;
        if (!servicesEnabled) {
          onLocationFix?.(null);
          setState('unavailable');
          return;
        }

        const permission = await Location.requestForegroundPermissionsAsync();
        if (disposed) return;
        if (permission.status !== 'granted') {
          onLocationFix?.(null);
          setState('permission-denied');
          return;
        }

        const nextSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5_000,
            distanceInterval: 5,
          },
          receivePosition,
        );
        if (disposed || appState !== 'active') {
          nextSubscription.remove();
        } else {
          subscription = nextSubscription;
          setState('waiting');
          void Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          })
            .then(receivePosition)
            .catch(() => {
              if (!disposed && !currentFixRef.current) setState('unavailable');
            });
        }
      } catch {
        if (!disposed) setState('error');
      } finally {
        starting = false;
      }
    };

    const deferredStart = setTimeout(() => {
      void startWatching();
    }, 0);
    const clearPreviousFix = setTimeout(() => {
      setCurrentLocation(null);
      setCurrentFix(null);
      currentFixRef.current = null;
      onLocationFix?.(null);
    }, 0);
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      appState = nextState;
      if (nextState === 'active') {
        void startWatching();
      } else {
        stopWatching();
        if (!disposed) setState('paused');
      }
    });

    return () => {
      disposed = true;
      clearTimeout(deferredStart);
      clearTimeout(clearPreviousFix);
      appStateSubscription.remove();
      stopWatching();
      if (staleTimer) clearTimeout(staleTimer);
    };
  }, [bookingId, driverId, enabled, observeOnly, onLocationFix]);

  return { state, currentLocation, currentFix };
}
