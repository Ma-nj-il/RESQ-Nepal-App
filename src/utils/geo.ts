/**
 * Small geometry helpers for the map and route display.
 *
 * Everything here works on real coordinates only — no positions are invented.
 */

/** Kathmandu city centre — the default map view for RESQ Nepal. */
export const KATHMANDU_CENTER = { lat: 27.7172, lng: 85.324 };

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle (straight-line) distance in kilometres. */
export function straightLineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A region that comfortably contains the given points (used to fit the map to
 * the current route). Falls back to Kathmandu when no points are available.
 */
export function regionForPoints(
  points: (LatLng | null | undefined)[],
  paddingFactor = 2.2,
): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } {
  const valid = points.filter((p): p is LatLng => Boolean(p));
  if (valid.length === 0) {
    // Street-level view of the city centre — matching the reference layouts.
    // This is only the viewport; no point or marker is invented.
    return {
      latitude: KATHMANDU_CENTER.lat,
      longitude: KATHMANDU_CENTER.lng,
      latitudeDelta: 0.035,
      longitudeDelta: 0.035,
    };
  }
  const latMin = Math.min(...valid.map((p) => p.lat));
  const latMax = Math.max(...valid.map((p) => p.lat));
  const lngMin = Math.min(...valid.map((p) => p.lng));
  const lngMax = Math.max(...valid.map((p) => p.lng));
  const latDelta = Math.max(0.01, (latMax - latMin) * paddingFactor);
  const lngDelta = Math.max(0.01, (lngMax - lngMin) * paddingFactor);
  return {
    latitude: (latMin + latMax) / 2,
    longitude: (lngMin + lngMax) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

/** "12.4 km" style label, or null when there is nothing real to show. */
export function formatKm(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km)) return null;
  return `${km.toFixed(1)} km`;
}
