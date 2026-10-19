import * as Location from 'expo-location';

export const locationService = {
  async requestPermission(): Promise<boolean> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  },
  async getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
    try {
      // Last known position first: it is effectively instant and avoids
      // leaving the user (or the UI) waiting on a fresh GPS fix. A fix older
      // than five minutes is treated as stale and a fresh read is attempted.
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
      if (last) {
        return { lat: last.coords.latitude, lng: last.coords.longitude };
      }
    } catch {
      // Fall through to a live fix.
    }
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return { lat: location.coords.latitude, lng: location.coords.longitude };
    } catch {
      return null;
    }
  },
  async reverseGeocode(lat: number, lng: number): Promise<string> {
    try {
      const addresses = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (addresses.length > 0) {
        const addr = addresses[0];
        return [addr.name, addr.city, addr.region].filter(Boolean).join(', ');
      }
    } catch {}
    return 'Unknown location';
  },
};
