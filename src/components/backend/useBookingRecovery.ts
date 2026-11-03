import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { BookingRecovery } from '../../services/api/backend/bookingRecovery';
import type { NativeBackendRuntime } from '../../services/api/backend/nativeRuntime';

export function useBookingRecovery(runtime: NativeBackendRuntime) {
  const recovery = useMemo(() => new BookingRecovery(async (id, signal) => (await runtime.dispatch.recovery(id, signal)).data), [runtime]);
  const state = useSyncExternalStore(recovery.subscribe, recovery.getSnapshot, recovery.getSnapshot);
  useEffect(() => {
    let active = AppState.currentState === 'active';
    let transportOwner: string | undefined, stopTransport: (() => void) | undefined;
    const syncTransport = () => {
      const auth = runtime.auth.store.getState(), current = recovery.getSnapshot();
      const owner = active && auth.status === 'authenticated' && auth.identity && current.bookingId && current.status !== 'blocked'
        ? `${auth.identity.userId}:${auth.identity.sessionId}:${current.bookingId}` : undefined;
      if (owner === transportOwner) return;
      stopTransport?.(); stopTransport = undefined; transportOwner = owner;
      if (owner && current.bookingId) {
        let connection = -1;
        stopTransport = runtime.realtime.subscribe(current.bookingId, {
          connected: () => { connection = recovery.reconnect(); },
          hint: value => recovery.receiveHint(connection, value),
          disconnected: () => { recovery.disconnect(); void recovery.refresh(); },
        });
      }
    };
    const syncOwner = () => {
      const auth = runtime.auth.store.getState();
      recovery.activate(auth.status === 'authenticated' ? auth.identity : null);
      syncTransport();
    };
    const stopRecovery = recovery.subscribe(syncTransport);
    syncOwner();
    const stopAuth = runtime.auth.store.subscribe(syncOwner);
    const setActive = (value: boolean) => { active = value; recovery.setActive(value); syncTransport(); };
    setActive(active);
    const change = AppState.addEventListener('change', value => setActive(value === 'active'));
    const blur = AppState.addEventListener('blur', () => setActive(false));
    const focus = AppState.addEventListener('focus', () => setActive(AppState.currentState === 'active'));
    return () => { stopRecovery(); stopAuth(); stopTransport?.(); change.remove(); blur.remove(); focus.remove(); recovery.dispose(); };
  }, [recovery, runtime]);
  return { recovery, state };
}
