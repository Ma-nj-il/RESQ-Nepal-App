import * as Location from 'expo-location';

export const locationService = {
  async requestPermission(): Promise<boolean> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  },
  async getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
    try {
      const location = await Location.getCurrentPositionAsync({});
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
