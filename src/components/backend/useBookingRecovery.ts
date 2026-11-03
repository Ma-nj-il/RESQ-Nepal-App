import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { BookingRecovery } from '../../services/api/backend/bookingRecovery';
import type { NativeBackendRuntime } from '../../services/api/backend/nativeRuntime';

export function useBookingRecovery(runtime: NativeBackendRuntime) {
  const recovery = useMemo(() => new BookingRecovery(async (id, signal) => (await runtime.dispatch.recovery(id, signal)).data), [runtime]);
  const state = useSyncExternalStore(recovery.subscribe, recovery.getSnapshot, recovery.getSnapshot);
  useEffect(() => {
    const syncOwner = () => {
      const auth = runtime.auth.store.getState();
      recovery.activate(auth.status === 'authenticated' ? auth.identity : null);
    };
    syncOwner();
    const stopAuth = runtime.auth.store.subscribe(syncOwner);
    recovery.setActive(AppState.currentState === 'active');
    const change = AppState.addEventListener('change', value => recovery.setActive(value === 'active'));
    const blur = AppState.addEventListener('blur', () => recovery.setActive(false));
    const focus = AppState.addEventListener('focus', () => recovery.setActive(AppState.currentState === 'active'));
    return () => { stopAuth(); change.remove(); blur.remove(); focus.remove(); recovery.dispose(); };
  }, [recovery, runtime]);
  return { recovery, state };
}
