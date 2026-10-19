import React, { Component, ReactNode, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { KATHMANDU_CENTER, regionForPoints } from '../../utils/geo';

export interface MapPoint {
  lat: number;
  lng: number;
}

interface MapCanvasProps {
  pickup?: MapPoint | null;
  destination?: MapPoint | null;
  /**
   * The device's own position, when it is actually available. Callers pass
   * this only from a real location read — it is never simulated.
   */
  current?: MapPoint | null;
  /**
   * A point the viewport should frame but that has no marker of its own
   * (e.g. the location currently being edited in the map picker).
   */
  focus?: MapPoint | null;
  /** Small honesty chip shown on the map, e.g. "Straight-line preview". */
  caption?: string;
  /** Allow panning/zooming. Off by default so lists cannot be dragged. */
  interactive?: boolean;
  /** Reports the map centre after panning/zooming settles (native map only). */
  onRegionChangeComplete?: (center: { latitude: number; longitude: number }) => void;
  /** Fallback label used by the offline schematic view. */
  pickupLabel?: string;
  destinationLabel?: string;
  currentLabel?: string;
  style?: ViewStyle;
}

/**
 * react-native-maps ships inside Expo Go (verified for SDK 58), so on a device
 * the app gets a real interactive map with real geography. Everywhere the
 * native module is unavailable the component renders its own schematic view —
 * rendered from real coordinates when they exist, and clearly labelled either
 * way. No vehicle movement or route geometry is ever fabricated.
 */
type MapsModule = {
  default: React.ComponentType<any>;
  Marker: React.ComponentType<any>;
  Polyline: React.ComponentType<any>;
};

declare const require: (name: string) => any;

let maps: MapsModule | null = null;
try {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    const mod = require('react-native-maps') as MapsModule;
    maps = mod?.default ? mod : null;
  }
} catch {
  maps = null;
}

/** True when the real native map module is available in this runtime. */
export const isNativeMapAvailable = Boolean(maps);

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

const SchematicView: React.FC<MapCanvasProps> = ({ pickup, destination, current, caption }) => (
  <View style={styles.schematic}>
    <View style={styles.schematicBase} />
    <View style={[styles.road, styles.roadVertical]} />
    <View style={[styles.road, styles.roadHorizontal]} />
    <View style={[styles.block, styles.blockA]} />
    <View style={[styles.block, styles.blockB]} />
    <View style={[styles.block, styles.blockC]} />

    {pickup && <View style={[styles.pin, styles.pinPickup, { top: '38%', left: '24%' }]}><Text style={styles.pinText}>P</Text></View>}
    {destination && <View style={[styles.pin, styles.pinDest, { top: '56%', left: '62%' }]}><Text style={styles.pinText}>D</Text></View>}
    {current && <View style={[styles.pin, styles.pinCurrent, { top: '46%', left: '46%' }]}><Text style={styles.pinText}>●</Text></View>}
    {pickup && destination && <View style={styles.schematicRoute} />}

    <View style={styles.chip}>
      <Text style={styles.chipText}>{caption || 'Schematic map preview — not live GPS'}</Text>
    </View>
  </View>
);

export const MapCanvas: React.FC<MapCanvasProps> = ({
  pickup,
  destination,
  current,
  focus,
  caption,
  interactive = false,
  onRegionChangeComplete,
  pickupLabel,
  destinationLabel,
  currentLabel,
  style,
}) => {
  const hasPickup = Boolean(pickup && Number.isFinite(pickup.lat) && Number.isFinite(pickup.lng));
  const hasDestination = Boolean(
    destination && Number.isFinite(destination.lat) && Number.isFinite(destination.lng),
  );
  const hasCurrent = Boolean(
    current && Number.isFinite(current.lat) && Number.isFinite(current.lng),
  );
  const hasFocus = Boolean(focus && Number.isFinite(focus.lat) && Number.isFinite(focus.lng));

  const region = useMemo(
    () =>
      regionForPoints([
        hasPickup ? pickup! : null,
        hasDestination ? destination! : null,
        hasCurrent ? current! : null,
        hasFocus ? focus! : null,
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPickup, hasDestination, hasCurrent, hasFocus, pickup?.lat, pickup?.lng, destination?.lat, destination?.lng, current?.lat, current?.lng, focus?.lat, focus?.lng],
  );

  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!maps) return;
    mapRef.current?.animateToRegion(region, 500);
  }, [region]);

  const fallback = (
    <SchematicView
      pickup={hasPickup ? pickup : null}
      destination={hasDestination ? destination : null}
      current={hasCurrent ? current : null}
      caption={caption}
      style={style}
    />
  );

  if (!maps) {
    return fallback;
  }

  const MapView = maps.default;
  const Marker = maps.Marker;
  const Polyline = maps.Polyline;

  return (
    <MapErrorBoundary fallback={fallback}>
      <View style={[styles.wrapper, style]}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={region}
          scrollEnabled={interactive}
          zoomEnabled={interactive}
          rotateEnabled={false}
          pitchEnabled={false}
          showsCompass={false}
          showsPointsOfInterest={false}
          showsUserLocation={false}
          toolbarEnabled={false}
          onRegionChangeComplete={
            onRegionChangeComplete
              ? (r: { latitude: number; longitude: number }) =>
                  onRegionChangeComplete({ latitude: r.latitude, longitude: r.longitude })
              : undefined
          }
        >
          {hasPickup && (
            <Marker
              coordinate={{ latitude: pickup!.lat, longitude: pickup!.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              title={pickupLabel || 'Pickup'}
            >
              <View style={[styles.marker, styles.markerPickup]}>
                <Text style={styles.markerText}>P</Text>
              </View>
            </Marker>
          )}
          {hasDestination && (
            <Marker
              coordinate={{ latitude: destination!.lat, longitude: destination!.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              title={destinationLabel || 'Destination'}
            >
              <View style={[styles.marker, styles.markerDest]}>
                <Text style={styles.markerText}>D</Text>
              </View>
            </Marker>
          )}
          {hasCurrent && (
            <Marker
              coordinate={{ latitude: current!.lat, longitude: current!.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              title={currentLabel || 'Your position'}
            >
              <View style={[styles.marker, styles.markerCurrent]}>
                <Text style={styles.markerText}>●</Text>
              </View>
            </Marker>
          )}
          {hasPickup && hasDestination && (
            <Polyline
              coordinates={[
                { latitude: pickup!.lat, longitude: pickup!.lng },
                { latitude: destination!.lat, longitude: destination!.lng },
              ]}
              strokeColor={colors.primary}
              strokeWidth={3}
              lineDashPattern={[8, 8]}
            />
          )}
        </MapView>

        {caption ? (
          <View style={styles.chip}>
            <Text style={styles.chipText}>{caption}</Text>
          </View>
        ) : null}
      </View>
    </MapErrorBoundary>
  );
};

const styles = StyleSheet.create({
  wrapper: { flex: 1, overflow: 'hidden' },
  map: { ...StyleSheet.absoluteFill },

  marker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
  },
  markerPickup: { backgroundColor: colors.success },
  markerDest: { backgroundColor: colors.primary },
  markerCurrent: { backgroundColor: '#2563EB' },
  markerText: { color: colors.surface, fontWeight: '800', fontSize: 13 },

  chip: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(24, 33, 47, 0.78)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.sm,
    maxWidth: '70%',
  },
  chipText: { ...typography.caption, color: colors.surface },

  schematic: { flex: 1, backgroundColor: '#E9E7E1', overflow: 'hidden' },
  schematicBase: { ...StyleSheet.absoluteFill, backgroundColor: '#E9E7E1' },
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
  pinText: { color: colors.surface, fontWeight: '800', fontSize: 12 },
});

export const KATHMANDU = KATHMANDU_CENTER;
