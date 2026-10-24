# RESQ Nepal — Maps & Location Setup

The map is rendered with **OpenStreetMap raster tiles** using Leaflet inside a
`react-native-webview`. There is no Google Maps SDK, no API key and no billing on either
platform. `expo-location` handles permissions, the device position and reverse geocoding.

## 1. What works without any key or extra configuration

| Feature | Status |
|---|---|
| Location permission flow | ✅ works (`expo-location`) |
| Current position + reverse geocode | ✅ works (device geocoder) |
| Address search (saved/recent places) | ✅ works (local data) |
| Ambulance list + booking flow | ✅ works |
| Interactive OpenStreetMap tiles | ✅ works with the default community tile URL |
| Home pickup → destination road preview | ✅ OSRM route geometry, distance and estimate without live traffic |
| Nearby hospital pins | ✅ verified directory entries with coordinates, ranked by straight-line distance |
| Turn-by-turn directions / traffic-aware ETA | ❌ not implemented |

The map HTML, including Leaflet 1.9.4, is bundled into the app. Only the visible tiles are
requested at runtime; nothing is prefetched or downloaded for offline use.

## 2. How the map is put together

| File | Purpose |
|---|---|
| `src/components/map/MapCanvas.tsx` | React Native wrapper, markers, loading/error UI, attribution overlay |
| `src/constants/map.ts` | Tile URL validation, User-Agent, attribution constants, zoom limits |
| `src/services/location/routeService.ts` | OSRM-compatible driving route requests, validation and small in-memory cache |
| `scripts/osm-map-runtime.js` | Browser-side Leaflet runtime (markers, real route geometry, bridge) |
| `scripts/build-osm-map-html.mjs` | Inlines Leaflet CSS/JS + runtime into the generated module |
| `src/components/map/osmMapHtml.generated.ts` | Generated self-contained HTML (committed) |

After editing `scripts/osm-map-runtime.js`, regenerate the HTML:

```bash
npm run map:html
```

The generated file must be committed with the runtime change. Leaflet is a development
dependency because it is only needed at generation time; the shipped app contains the inlined
copy and makes no CDN request.

The Home map and the “Choose from map” picker are interactive (pan, pinch/double-tap zoom and
the +/− buttons). Maps embedded in booking, trip and driver screens are non-interactive by
default so scrolling and taps on surrounding controls keep working. A non-interactive map still
renders real tiles and real markers; it is not a screenshot.

The WebView reports the map centre after a pan/zoom settles. The map picker uses that report to
reverse-geocode the centre pin with the device geocoder and never invents an address — if the
lookup fails it shows the coordinates and says so.

Home shows up to 12 nearest hospitals with valid coordinates from the existing hospital
directory, within 20 km of the selected pickup (or the real device location when no pickup is
selected). It does not infer coordinates for sample directory entries.

## 3. Tile URL configuration

The default is:

```text
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

Override it with `EXPO_PUBLIC_OSM_TILE_URL` in `.env` (or the EAS build profile):

```bash
EXPO_PUBLIC_OSM_TILE_URL=https://your-tile-provider.example/{z}/{x}/{y}.png
```

`src/constants/map.ts` accepts a value only when it is **HTTPS** and contains all of `{z}`,
`{x}` and `{y}`. An invalid value falls back to the community default. Restart the dev server
after editing `.env`; Expo embeds `EXPO_PUBLIC_*` values at bundle time.

The default community service is funded by donations and is intended for development and light,
interactive use. It has no SLA. Before production traffic:

1. Choose an OSM-derived commercial provider or run your own tile server.
2. Confirm the provider permits your expected traffic and requires (or does not require) an
   API key; if it needs a key, put the complete signed URL template in
   `EXPO_PUBLIC_OSM_TILE_URL`. A client-side key is public — restrict it by bundle/package or
   referrer where the provider supports that.
3. Keep the `© OpenStreetMap contributors` attribution and the tile provider's required
   attribution, if it differs.
4. Re-test loading, error and retry states on both platforms.

The map component itself does not change when the provider changes.

## 4. Road-route preview

The Home map requests a driving route only after both selected locations have real
coordinates. It draws the returned road geometry and uses the provider's distance and
duration for the estimate; it does not substitute a straight-line route when the request
fails. The duration is not traffic-aware, and the preview is not turn-by-turn navigation or
dispatch tracking.

The default is the public OSRM demo router at `https://router.project-osrm.org`. It is for
development and light use, has no availability guarantee, and should not be relied on for
production or emergency dispatch. Set `EXPO_PUBLIC_OSRM_BASE_URL` to an HTTPS,
OSRM-compatible endpoint in the build environment to use another provider. Route requests
send the selected pickup and destination coordinates to that provider. Before production,
choose a provider with suitable capacity, privacy terms, and availability for the expected
traffic; alternatives and live traffic are not currently shown.

Routing can fail or have no valid road path. In that case the map omits the route and the UI
shows that distance/ETA are unknown; booking remains available without a route-based fare
estimate.

## 5. OpenStreetMap tile usage policy

The app follows the [OSM Foundation tile usage policy](https://operations.osmfoundation.org/policies/tiles/):

- **Identifying User-Agent:** every WebView uses
  `RESQNepal/1.0 (com.resq.nepal)` (`OSM_USER_AGENT` in `src/constants/map.ts`). Do not replace
  it with a generic browser string or another app's identity.
- **Attribution:** “© OpenStreetMap contributors” is a React Native overlay above the map, not
  part of the WebView canvas, and opens
  [the OSM copyright page](https://www.openstreetmap.org/copyright) when tapped.
- **No bulk downloading or prefetching:** Leaflet requests tiles only for the current viewport
  and its small `keepBuffer`; there is no offline download feature.
- **Caching:** the WebView uses its normal HTTP cache (`cacheEnabled`, `LOAD_DEFAULT`). Tile
  responses are not stripped of cache headers.
- **No heavy or systematic use:** production traffic must move to a provider sized for it (see
  §3).

## 6. Location permissions (already configured)

`app.json` declares:

- iOS: `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`
- Android: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `FOREGROUND_SERVICE`
- Expo plugin: `expo-location` with a custom permission message

Runtime flow: `src/screens/auth/LocationPermissionScreen.tsx` → `locationService.requestPermission()`
→ `getCurrentLocation()` → `reverseGeocode()`.

The map only shows the device position when a real location read succeeded. It never places a
“current location” marker at a guessed or demo coordinate.

## 7. Native configuration

`react-native-webview` is the only native dependency added for the map. It is included in Expo
Go for SDK 58 and in development/production builds; no extra Android or iOS map SDK setup is
needed. Android's `INTERNET` permission is provided by Expo's default manifest. No Google Maps
key belongs in `app.json`.

If a build reports that the map falls back to the schematic surface, check that the WebView
module is present (the component exposes `isOsmMapAvailable`) and rebuild:

```bash
npx expo run:ios
npx expo run:android
```

## 8. Background tracking honesty

The app implements **foreground** location only. Continuous background tracking would require
`expo-task-manager` + background location permissions plus a review process on both stores. Per
the project's honesty requirement, the app does not claim continuous background tracking; driver
breadcrumbs are recorded while the driver trip screen is open (foreground service on Android is
declared for future use).

## 9. Driver location display

Driver position on passenger screens renders only from genuine `trip_locations` rows written by
the assigned driver. When no breadcrumb exists, the screen shows “waiting for driver location”
instead of inventing a position.

## 10. What is intentionally not implemented

- Turn-by-turn directions, traffic-aware ETA, and route alternatives are not implemented.
- Other booking screens may show explicitly labelled straight-line distances; those are not road
  distances.
- OSM/Nominatim geocoding is **not** used. Address lookup goes through the device geocoder
  (`expo-location`), so it works offline only as far as the OS allows.
- Live ambulance movement is not shown (see `known-limitations.md` §12).
- Offline maps and bulk tile downloads are deliberately unsupported.
