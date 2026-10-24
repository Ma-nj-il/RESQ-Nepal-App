/**
 * OpenStreetMap tile configuration.
 *
 * The default points at the community-funded OpenStreetMap standard tiles.
 * That service is fine for development and light, interactive use, but it has
 * no SLA and must not be used for bulk downloads or production-scale traffic.
 * Set EXPO_PUBLIC_OSM_TILE_URL to an OSM-derived provider (or your own tile
 * server) before shipping; see docs/maps-setup.md.
 *
 * The URL must remain an HTTPS XYZ template containing {z}, {x} and {y}.
 * No prefetching or offline download is performed by the app.
 */
const FALLBACK_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function configuredTileUrl(): string {
  const candidate = process.env.EXPO_PUBLIC_OSM_TILE_URL?.trim();
  if (!candidate) return FALLBACK_TILE_URL;
  if (!candidate.startsWith('https://')) return FALLBACK_TILE_URL;
  if (!['{z}', '{x}', '{y}'].every((token) => candidate.includes(token))) {
    return FALLBACK_TILE_URL;
  }
  return candidate;
}

/** Raster tile template. Replaceable without changing the map component. */
export const OSM_TILE_URL = configuredTileUrl();

/**
 * A stable, app-identifying User-Agent required by the OSM tile usage policy.
 * Do not replace this with a browser/library default or with another app's
 * identity. Update the version when the app version changes.
 */
export const OSM_USER_AGENT = 'RESQNepal/1.0 (com.resq.nepal)';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const OSM_TILE_POLICY_URL = 'https://operations.osmfoundation.org/policies/tiles/';

export const OSM_MIN_ZOOM = 2;
export const OSM_MAX_ZOOM = 19;
