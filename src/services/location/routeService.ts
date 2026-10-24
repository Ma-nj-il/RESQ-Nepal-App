export interface RouteCoordinate {
  lat: number;
  lng: number;
}

export interface RoadRoute {
  coordinates: RouteCoordinate[];
  distanceKm: number;
  durationMinutes: number;
}

const DEFAULT_ROUTING_BASE_URL = 'https://router.project-osrm.org';
const configuredBaseUrl = process.env.EXPO_PUBLIC_OSRM_BASE_URL?.trim();

function getRoutingBaseUrl(): string {
  if (!configuredBaseUrl) return DEFAULT_ROUTING_BASE_URL;
  try {
    const url = new URL(configuredBaseUrl);
    if (url.protocol === 'https:' && url.host) {
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    // Use the documented public demo endpoint when configuration is invalid.
  }
  return DEFAULT_ROUTING_BASE_URL;
}

const ROUTING_BASE_URL = getRoutingBaseUrl();
const routeCache = new Map<string, RoadRoute>();
const MAX_CACHED_ROUTES = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Parse only a complete OSRM GeoJSON route; malformed geometry is not drawn. */
export function parseOsrmRoute(payload: unknown): RoadRoute | null {
  if (!isRecord(payload) || payload.code !== 'Ok' || !Array.isArray(payload.routes)) {
    return null;
  }

  const route = payload.routes[0];
  if (!isRecord(route) || !isRecord(route.geometry) || !Array.isArray(route.geometry.coordinates)) {
    return null;
  }

  const distanceMeters = route.distance;
  const durationSeconds = route.duration;
  if (
    typeof distanceMeters !== 'number' ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    typeof durationSeconds !== 'number' ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    return null;
  }

  const coordinates: RouteCoordinate[] = [];
  for (const coordinate of route.geometry.coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
    const [lng, lat] = coordinate;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isValidCoordinate(lat, lng)) {
      return null;
    }
    coordinates.push({ lat, lng });
  }
  if (coordinates.length < 2) return null;

  return {
    coordinates,
    distanceKm: distanceMeters / 1000,
    durationMinutes: Math.ceil(durationSeconds / 60),
  };
}

function cacheKey(start: RouteCoordinate, end: RouteCoordinate): string {
  return [start, end]
    .map(({ lat, lng }) => `${lat.toFixed(6)},${lng.toFixed(6)}`)
    .join(';');
}

/**
 * Get an actual driving route from an OSRM-compatible service. The default
 * public endpoint is for development/light use only; configure a suitable
 * provider before production traffic.
 */
export async function getRoadRoute(
  start: RouteCoordinate,
  end: RouteCoordinate,
  signal?: AbortSignal,
): Promise<RoadRoute | null> {
  if (!isValidCoordinate(start.lat, start.lng) || !isValidCoordinate(end.lat, end.lng)) {
    throw new Error('Route coordinates are invalid.');
  }

  const key = cacheKey(start, end);
  const cached = routeCache.get(key);
  if (cached) return cached;

  const coordinates = `${start.lng},${start.lat};${end.lng},${end.lat}`;
  const url =
    `${ROUTING_BASE_URL}/route/v1/driving/${coordinates}` +
    '?overview=full&geometries=geojson&steps=false&alternatives=false';
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Routing service request failed (${response.status}).`);
  }

  const result = parseOsrmRoute(await response.json());
  if (!result) return null;

  routeCache.set(key, result);
  if (routeCache.size > MAX_CACHED_ROUTES) {
    const oldestKey = routeCache.keys().next().value;
    if (oldestKey) routeCache.delete(oldestKey);
  }
  return result;
}
