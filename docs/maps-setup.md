# RESQ Nepal — Maps & Location Setup

The app is built on `react-native-maps` (Google Maps provider on Android, Apple Maps/Google on
iOS) plus `expo-location` for permissions, GPS and reverse geocoding.

## 1. What works without any key

| Feature | Status without key |
|---|---|
| Location permission flow | ✅ works (expo-location) |
| Current position + reverse geocode | ✅ works |
| Address search (saved/recent places) | ✅ works (local data) |
| Ambulance list + booking flow | ✅ works |
| Interactive map tiles | ❌ needs platform maps key (see below) |

When a native maps key is not configured, the map area renders the app's own styled map
placeholder with pins/route lines (clearly not a live tile map). It never presents a static
image as a functioning map.

## 2. Android — Google Maps key

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → API key**.
2. Enable **Maps SDK for Android**.
3. Restrict the key to Android apps: package `com.resq.nepal` + your release SHA-1.
4. Add to `app.json`:

```json
"android": {
  "config": {
    "googleMaps": { "apiKey": "YOUR_ANDROID_MAPS_KEY" }
  }
}
```

5. Rebuild the native app (`npx expo run:android` or `eas build`) — config changes do not apply
   in Expo Go.

## 3. iOS

iOS uses the built-in Apple Maps provider with **no key required**. To switch iOS to Google Maps:

1. Enable **Maps SDK for iOS** in Google Cloud, create an iOS-restricted key
   (bundle id `com.resq.nepal`).
2. Add to `app.json`:

```json
"ios": {
  "config": {
    "googleMapsApiKey": "YOUR_IOS_MAPS_KEY"
  }
}
```

## 4. Location permissions (already configured)

`app.json` declares:

- iOS: `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`
- Android: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `FOREGROUND_SERVICE`
- Expo plugin: `expo-location` with a custom permission message

Runtime flow: `src/screens/auth/LocationPermissionScreen.tsx` → `locationService.requestPermission()`
→ `getCurrentLocation()` → `reverseGeocode()`.

## 5. API-key restriction guidance

| Platform | Restriction |
|---|---|
| Android | Package name + SHA-1 fingerprint |
| iOS | Bundle identifier |
| Never | Leave "unrestricted" in production |
| Never | Commit real keys — use `.env` / EAS secrets |

`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env` is reserved for future JS-side geocoding usage.
Native map keys belong in the build configuration above.

## 6. Background tracking honesty

The app implements **foreground** location only. Continuous background tracking would require
`expo-task-manager` + background location permissions plus a review process on both stores. Per
the project's honesty requirement, the app does not claim continuous background tracking; driver
breadcrumbs are recorded while the driver trip screen is open (foreground service on Android is
declared for future use).

## 7. Driver location display

Driver position on passenger screens renders only from genuine `trip_locations` rows written by
the assigned driver. When no breadcrumb exists, the screen shows "waiting for driver location"
instead of inventing a position.
