import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { Button } from '../../components/ui';
import { MapCanvas, isOsmMapAvailable } from '../../components/map/MapCanvas';
import { locationService } from '../../services/location/locationService';
import { useBookingStore } from '../../store/bookingStore';
import { RoutePoint } from '../../types';

/**
 * Manual location picker ("Choose from map").
 *
 * The user pans the real map; the pin always marks the centre of the
 * viewport. The address is resolved with the device's own reverse geocoder —
 * when that lookup fails the coordinates themselves are used, clearly
 * labelled, and nothing is invented.
 */
const MapPickerScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const mode: 'pickup' | 'destination' = route.params?.mode === 'destination' ? 'destination' : 'pickup';
  const { pickup, destination, setPickup, setDestination } = useBookingStore();

  const initialPoint = mode === 'pickup' ? pickup : destination;

  const [center, setCenter] = useState<{ latitude: number; longitude: number } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [resolving, setResolving] = useState(false);

  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const handleRegionChange = useCallback((next: { latitude: number; longitude: number }) => {
    setCenter(next);
    setAddress(null);
    setLookupFailed(false);
    setResolving(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const seq = ++seqRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const text = await locationService.reverseGeocode(next.latitude, next.longitude);
        if (seqRef.current !== seq) return;
        if (!text || text === 'Unknown location') {
          setLookupFailed(true);
        } else {
          setAddress(text);
        }
      } catch {
        if (seqRef.current === seq) setLookupFailed(true);
      } finally {
        if (seqRef.current === seq) setResolving(false);
      }
    }, 500);
  }, []);

  const confirm = useCallback(() => {
    if (!center) return;
    const label =
      address?.trim() ||
      `Dropped pin (${center.latitude.toFixed(4)}, ${center.longitude.toFixed(4)})`;
    const point: RoutePoint = {
      address: label,
      lat: center.latitude,
      lng: center.longitude,
      source: 'map',
    };
    if (mode === 'pickup') {
      setPickup(point);
    } else {
      setDestination(point);
    }
    // Return to Home with the selection applied.
    navigation.popToTop();
  }, [address, center, mode, navigation, setDestination, setPickup]);

  const addressLine = resolving
    ? 'Looking up the address…'
    : address
      ? address
      : lookupFailed
        ? 'Address lookup is not available right now — the pin’s coordinates will be used.'
        : 'Move the map to choose a location.';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose from map</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.mapArea}>
        <MapCanvas
          focus={
            initialPoint && initialPoint.lat != null && initialPoint.lng != null
              ? { lat: initialPoint.lat, lng: initialPoint.lng }
              : null
          }
          interactive
          onRegionChangeComplete={handleRegionChange}
          style={styles.map}
        />

        {/* Centre pin — marks the exact point the map is centred on. */}
        <View pointerEvents="none" style={styles.pinWrap}>
          <View style={styles.pin} />
          <View style={styles.pinStem} />
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelLabel}>
          {mode === 'pickup' ? 'Pickup location' : 'Destination'}
        </Text>
        <Text style={styles.panelAddress} numberOfLines={2}>
          {addressLine}
        </Text>
        {!isOsmMapAvailable ? (
          <Text style={styles.panelWarning}>
            The interactive map is unavailable in this build. Choose a location with search instead.
          </Text>
        ) : null}
        <Button
          title={mode === 'pickup' ? 'Use this pickup point' : 'Use this destination'}
          onPress={confirm}
          fullWidth
          disabled={!center || !isOsmMapAvailable}
          style={styles.confirmButton}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h4, flex: 1, textAlign: 'center', color: colors.text },
  headerSpacer: { width: 40 },

  mapArea: { flex: 1, position: 'relative' },
  map: { ...StyleSheet.absoluteFill },
  pinWrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    alignItems: 'center',
    marginLeft: -9,
    marginTop: -30,
  },
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.surface,
    ...shadows.md,
  },
  pinStem: { width: 2, height: 12, backgroundColor: colors.primary },

  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    ...shadows.lg,
  },
  panelLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  panelAddress: { ...typography.body, color: colors.text, marginTop: 4 },
  panelWarning: { ...typography.caption, color: colors.warning, marginTop: spacing.sm },
  confirmButton: { marginTop: spacing.md },
});

export default MapPickerScreen;
