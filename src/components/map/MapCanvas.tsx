import React, {
  Component,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import {
  OSM_ATTRIBUTION,
  OSM_COPYRIGHT_URL,
  OSM_TILE_URL,
  OSM_USER_AGENT,
} from '../../constants/map';
import { KATHMANDU_CENTER } from '../../utils/geo';
import { OSM_MAP_HTML } from './osmMapHtml.generated';

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface HospitalMapPoint extends MapPoint {
  name: string;
}

interface MapCanvasProps {
  pickup?: MapPoint | null;
  destination?: MapPoint | null;
  /**
   * The device's own position, when it is actually available. Callers pass
   * this only from a real location read — it is never simulated.
   */
  current?: MapPoint | null;
   /** Latest fresh ambulance GPS position read from an authorized trip. */
   ambulance?: MapPoint | null;
  /** Verified hospital locations only; missing coordinates are never inferred. */
  hospitals?: HospitalMapPoint[];
  /** Real road geometry returned by the routing service. */
  route?: MapPoint[] | null;
  /** Suppress the illustrative fallback line when a real route is required. */
  showSchematicRoute?: boolean;
  /**
   * A point the viewport should frame but that has no marker of its own
   * (e.g. the location currently being edited in the map picker).
   */
  focus?: MapPoint | null;
  /** Small honesty chip shown on the map, e.g. "Straight-line preview". */
  caption?: string;
  /** Allow panning/zooming. Off by default so lists cannot be dragged. */
  interactive?: boolean;
  /** Reports the map centre after panning/zooming settles. */
  onRegionChangeComplete?: (center: { latitude: number; longitude: number }) => void;
  /** Fallback label used by the offline schematic view. */
  pickupLabel?: string;
  destinationLabel?: string;
  currentLabel?: string;
  style?: ViewStyle;
}

type WebViewHandle = {
  injectJavaScript: (script: string) => void;
};

type MapTileState = 'loading' | 'ready' | 'error';

declare const require: (name: string) => any;

/**
 * The map is rendered with Leaflet inside a WebView and uses OpenStreetMap
 * raster tiles. Unlike react-native-maps, this needs no Google Maps SDK or API
 * key on Android, and it works in Expo Go as well as a native build.
 *
 * The HTML is self-contained (Leaflet is inlined) and only requests tiles for
 * the viewport Leaflet is showing. It never prefetches map areas.
 */
let WebViewComponent: React.ComponentType<any> | null = null;
try {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    const webViewModule = require('react-native-webview') as {
      WebView?: React.ComponentType<any>;
    };
    WebViewComponent = webViewModule?.WebView ?? null;
  }
} catch {
  WebViewComponent = null;
}

/** True when the real OSM map runtime is available in this build. */
export const isOsmMapAvailable = Boolean(WebViewComponent);

const SAFE_TILE_URL = OSM_TILE_URL.replace(/[<>]/g, '');
const MAP_HTML = OSM_MAP_HTML.replace(
  '__RESQ_TILE_URL_JSON__',
  JSON.stringify(SAFE_TILE_URL),
);

class MapErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

const SchematicView: React.FC<MapCanvasProps> = ({
  pickup,
  destination,
  current,
  ambulance,
  caption,
  showSchematicRoute = true,
}) => (
  <View style={styles.schematic}>
    <View style={styles.schematicBase} />
    <View style={[styles.road, styles.roadVertical]} />
    <View style={[styles.road, styles.roadHorizontal]} />
    <View style={[styles.block, styles.blockA]} />
    <View style={[styles.block, styles.blockB]} />
    <View style={[styles.block, styles.blockC]} />

    {pickup && (
      <View style={[styles.pin, styles.pinPickup, { top: '38%', left: '24%' }]}>
        <Text style={styles.pinText}>P</Text>
      </View>
    )}
    {destination && (
      <View style={[styles.pin, styles.pinDest, { top: '56%', left: '62%' }]}>
        <Text style={styles.pinText}>D</Text>
      </View>
    )}
    {current && (
      <View style={[styles.pin, styles.pinCurrent, { top: '46%', left: '46%' }]}>
        <Text style={styles.pinText}>●</Text>
      </View>
    )}
    {ambulance && (
      <View style={[styles.pin, styles.pinAmbulance, { top: '48%', left: '54%' }]}>
        <Text style={styles.pinText}>A</Text>
      </View>
    )}
    {showSchematicRoute && pickup && destination && <View style={styles.schematicRoute} />}

    <View style={styles.chip}>
      <Text style={styles.chipText}>{caption || 'Schematic map preview — not live GPS'}</Text>
    </View>
  </View>
);

function validPoint(lat?: number | null, lng?: number | null): MapPoint | null {
  if (lat == null || lng == null) return null;
  const nextLat = Number(lat);
  const nextLng = Number(lng);
  if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return null;
  if (nextLat < -90 || nextLat > 90 || nextLng < -180 || nextLng > 180) return null;
  return { lat: nextLat, lng: nextLng };
}

export const MapCanvas: React.FC<MapCanvasProps> = ({
  pickup,
  destination,
  current,
  ambulance,
  hospitals,
  route,
  showSchematicRoute = true,
  focus,
  caption,
  interactive = false,
  onRegionChangeComplete,
  pickupLabel,
  destinationLabel,
  currentLabel,
  style,
}) => {
  const pickupPoint = useMemo(() => validPoint(pickup?.lat, pickup?.lng), [pickup?.lat, pickup?.lng]);
  const destinationPoint = useMemo(
    () => validPoint(destination?.lat, destination?.lng),
    [destination?.lat, destination?.lng],
  );
  const currentPoint = useMemo(() => validPoint(current?.lat, current?.lng), [current?.lat, current?.lng]);
  const ambulancePoint = useMemo(
    () => validPoint(ambulance?.lat, ambulance?.lng),
    [ambulance?.lat, ambulance?.lng],
  );
  const focusPoint = useMemo(() => validPoint(focus?.lat, focus?.lng), [focus?.lat, focus?.lng]);
  const hospitalPoints = useMemo(
    () =>
      (hospitals ?? []).flatMap((hospital) => {
        const point = validPoint(hospital.lat, hospital.lng);
        return point ? [{ ...point, name: hospital.name }] : [];
      }),
    [hospitals],
  );
  const routePoints = useMemo(
    () => (route ?? []).flatMap((point) => {
      const valid = validPoint(point.lat, point.lng);
      return valid ? [valid] : [];
    }),
    [route],
  );

  const webViewRef = useRef<WebViewHandle | null>(null);
  const tileLoadedRef = useRef(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [tileState, setTileState] = useState<MapTileState>('loading');
  const [showLoading, setShowLoading] = useState(false);

  const mapState = useMemo(
    () =>
      JSON.stringify({
        pickup: pickupPoint,
        destination: destinationPoint,
        current: currentPoint,
        ambulance: ambulancePoint,
        hospitals: hospitalPoints,
        route: routePoints,
        focus: focusPoint,
        pickupLabel: pickupLabel ?? null,
        destinationLabel: destinationLabel ?? null,
        currentLabel: currentLabel ?? null,
        interactive,
      }),
    [
      pickupPoint,
      destinationPoint,
      currentPoint,
      ambulancePoint,
      hospitalPoints,
      routePoints,
      focusPoint,
      pickupLabel,
      destinationLabel,
      currentLabel,
      interactive,
    ],
  );

  const fallback = (
    <SchematicView
      pickup={pickupPoint}
      destination={destinationPoint}
      current={currentPoint}
      ambulance={ambulancePoint}
      caption={caption}
      showSchematicRoute={showSchematicRoute}
      style={style}
    />
  );

  const handleRetry = useCallback(() => {
    tileLoadedRef.current = false;
    setMapReady(false);
    setTileState('loading');
    setShowLoading(false);
    setWebViewKey((key) => key + 1);
  }, []);

  const handleMessage = useCallback(
    (event: { nativeEvent?: { data?: unknown } }) => {
      const raw = event?.nativeEvent?.data;
      if (typeof raw !== 'string') return;

      let message: any;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      if (message?.type === 'map-ready') {
        setMapReady(true);
        setTileState((previous) => (previous === 'ready' ? previous : 'loading'));
        return;
      }

      if (message?.type === 'tile-ready') {
        tileLoadedRef.current = true;
        setTileState('ready');
        return;
      }

      if (message?.type === 'tile-error') {
        if (!tileLoadedRef.current) setTileState('error');
        return;
      }

      if (
        message?.type === 'region' &&
        onRegionChangeComplete &&
        Number.isFinite(message.latitude) &&
        Number.isFinite(message.longitude)
      ) {
        onRegionChangeComplete({
          latitude: message.latitude,
          longitude: message.longitude,
        });
      }
    },
    [onRegionChangeComplete],
  );

  const handleLoadFailure = useCallback(() => {
    setMapReady(false);
    setTileState('error');
  }, []);

  const handleShouldStartLoad = useCallback((request: { url?: string }) => {
    const url = request?.url || '';
    if (!url || url === 'about:blank' || url.startsWith('about:')) return true;
    if (url.startsWith('data:')) return true;
    // No in-map links are used; if one is added later, open it outside the
    // map WebView instead of replacing the map document.
    Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  const openAttribution = useCallback(() => {
    Linking.openURL(OSM_COPYRIGHT_URL).catch(() => {});
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const handle = webViewRef.current;
    if (!handle) return;
    try {
      handle.injectJavaScript(
        `(function(){try{if(window.__resqSetState){window.__resqSetState(${mapState});}}catch(e){}})();true;`,
      );
    } catch {
      // The bridge can be gone while the screen is unmounting. Tile loading
      // failures are reported separately by the in-page loader.
    }
  }, [mapReady, mapState]);

  useEffect(() => {
    if (tileState !== 'loading') return;
    const timer = setTimeout(() => setShowLoading(true), 800);
    return () => clearTimeout(timer);
  }, [tileState]);

  useEffect(() => {
    if (tileState !== 'loading') return;
    const timer = setTimeout(
      () => {
        if (!tileLoadedRef.current) setTileState('error');
      },
      mapReady ? 15000 : 20000,
    );
    return () => clearTimeout(timer);
  }, [mapReady, tileState]);

  if (!WebViewComponent) {
    return fallback;
  }

  const NativeMapWebView = WebViewComponent;

  return (
    <MapErrorBoundary fallback={fallback}>
      <View style={[styles.wrapper, style]}>
        <NativeMapWebView
          key={webViewKey}
          ref={webViewRef}
          source={{ html: MAP_HTML }}
          style={styles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled
          incognito={false}
          cacheMode="LOAD_DEFAULT"
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          setBuiltInZoomControls={false}
          setDisplayZoomControls={false}
          mixedContentMode="never"
          pointerEvents={interactive ? 'auto' : 'none'}
          userAgent={OSM_USER_AGENT}
          textInteractionEnabled={false}
          allowsLinkPreview={false}
          onMessage={handleMessage}
          onError={handleLoadFailure}
          onHttpError={handleLoadFailure}
          onContentProcessDidTerminate={handleLoadFailure}
          onRenderProcessGone={handleLoadFailure}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
        />

        {caption ? (
          <View style={styles.chip} pointerEvents="none">
            <Text style={styles.chipText}>{caption}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={openAttribution}
          style={styles.attribution}
          accessibilityRole="link"
          accessibilityLabel="Map data by OpenStreetMap contributors. Opens the OpenStreetMap copyright page."
        >
          <Text style={styles.attributionText}>{OSM_ATTRIBUTION}</Text>
        </Pressable>

        {showLoading && tileState === 'loading' ? (
          <View style={styles.loadingPill} pointerEvents="none">
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Loading OpenStreetMap…</Text>
          </View>
        ) : null}

        {tileState === 'error' ? (
          <View style={styles.errorPill} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>
              Map tiles could not load. Check your connection.
            </Text>
            <Pressable
              onPress={handleRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry loading map tiles"
            >
              <Text style={styles.errorRetry}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </MapErrorBoundary>
  );
};

const styles = StyleSheet.create({
  wrapper: { flex: 1, overflow: 'hidden', backgroundColor: '#E9E7E1' },
  webview: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#E9E7E1' },

  chip: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(24, 33, 47, 0.78)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.sm,
    maxWidth: '70%',
    zIndex: 4,
    elevation: 4,
  },
  chipText: { ...typography.caption, color: colors.surface },

  attribution: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    zIndex: 6,
    elevation: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(26, 26, 46, 0.14)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    maxWidth: '62%',
  },
  attributionText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    color: '#3F4A5A',
  },

  loadingPill: {
    position: 'absolute',
    top: spacing.sm,
    left: 64,
    right: 64,
    zIndex: 5,
    elevation: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: radii.full,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  loadingText: { fontSize: 11, lineHeight: 15, color: colors.textSecondary },

  errorPill: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: 28,
    zIndex: 7,
    elevation: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: 'rgba(255, 251, 235, 0.97)',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  errorText: { flex: 1, fontSize: 10, lineHeight: 14, color: colors.text },
  errorRetry: { fontSize: 11, lineHeight: 15, fontWeight: '700', color: colors.primary },

  schematic: { flex: 1, backgroundColor: '#E9E7E1', overflow: 'hidden' },
  schematicBase: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#E9E7E1' },
  road: { position: 'absolute', backgroundColor: '#FBFAF6', borderColor: '#DAD7CC', borderWidth: 1 },
  roadVertical: { top: 0, bottom: 0, left: '38%', width: '18%' },
  roadHorizontal: { left: 0, right: 0, top: '52%', height: 14 },
  block: { position: 'absolute', backgroundColor: '#DFDCD2', borderRadius: 6 },
  blockA: { top: '12%', left: '6%', width: '26%', height: '22%' },
  blockB: { top: '12%', right: '6%', width: '26%', height: '30%' },
  blockC: { bottom: '10%', left: '8%', width: '44%', height: '24%' },
  schematicRoute: {
    position: 'absolute',
    top: '40%',
    left: '26%',
    width: '40%',
    height: 0,
    borderTopWidth: 3,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    transform: [{ rotate: '18deg' }],
  },
  pin: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinPickup: { backgroundColor: colors.success },
  pinDest: { backgroundColor: colors.primary },
  pinCurrent: { backgroundColor: '#2563EB' },
  pinAmbulance: { backgroundColor: '#1D4ED8' },
  pinText: { color: colors.surface, fontWeight: '800', fontSize: 12 },
});

export const KATHMANDU = KATHMANDU_CENTER;
