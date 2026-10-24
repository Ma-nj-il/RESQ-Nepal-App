import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  LayoutAnimation,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { Button } from '../../components/ui';
import { MapCanvas } from '../../components/map/MapCanvas';
import { SERVICE_CATEGORIES, SERVICE_CATEGORY_LIST } from '../../constants/serviceCategories';
import { estimateFare } from '../../constants/fares';
import { hospitalsService } from '../../services/database';
import { locationService } from '../../services/location/locationService';
import { getRoadRoute, RoadRoute } from '../../services/location/routeService';
import { useAuthStore } from '../../store/authStore';
import { useBookingStore } from '../../store/bookingStore';
import { AmbulanceCategory, Hospital } from '../../types';
import { buildCategoryOption } from '../../utils/categoryOption';
import { formatKm, straightLineKm } from '../../utils/geo';

/**
 * Home-screen labels for the two service categories. The category keys — and
 * everything downstream of them — stay the existing `basic` / `icu` values.
 *
 * Only the icon and label are rendered on the compact cards. The description
 * remains available to assistive technology so the choice is still explained
 * without adding visible copy to the booking screen.
 */
const HOME_CATEGORY_COPY: Record<
  AmbulanceCategory,
  { label: string; description: string }
> = {
  basic: {
    label: 'Patient Delivery',
    description: 'Transport for routine hospital visits and patient transfers.',
  },
  icu: {
    label: 'ICU',
    description: 'For critical patients requiring emergency or ICU support.',
  },
};

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const { pickup, destination, selectedCategory, setPickup, setCategory } = useBookingStore();
  const [isLocating, setIsLocating] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const processingNavigation = useRef(false);
  const [routeResponse, setRouteResponse] = useState<{
    key: string;
    status: 'ready' | 'no-route' | 'unavailable';
    route?: RoadRoute;
  } | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hospitalLoadFailed, setHospitalLoadFailed] = useState(false);
  // The device's own position, only ever set from a real location read.
  const [devicePoint, setDevicePoint] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let active = true;
    hospitalsService
      .search('', 100)
      .then((rows) => {
        if (active) {
          setHospitals(rows);
          setHospitalLoadFailed(false);
        }
      })
      .catch(() => {
        if (active) {
          setHospitals([]);
          setHospitalLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const applyCurrentLocation = useCallback(
    async (silent = false) => {
      setIsLocating(true);
      if (!silent) setHint(null);
      try {
        const hasPermission = await locationService.requestPermission();
        if (!hasPermission) {
          if (!silent) {
            setHint('Location permission is not granted. Tap the pickup field to search manually.');
          }
          return;
        }
        const loc = await locationService.getCurrentLocation();
        if (!loc) {
          if (!silent) setHint('Could not read your current location. Search for a pickup place instead.');
          return;
        }
        setDevicePoint(loc);
        const address = await locationService.reverseGeocode(loc.lat, loc.lng);
        setPickup({ address, lat: loc.lat, lng: loc.lng, source: 'current' });
      } catch {
        if (!silent) setHint('Could not read your location. Search for a pickup place instead.');
      } finally {
        setIsLocating(false);
      }
    },
    [setPickup],
  );

  // Prefill the pickup with the device location on first open when the user
  // has not chosen one yet — the map centres on it, nothing is fabricated.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!pickup) {
        void applyCurrentLocation(true);
      }
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      processingNavigation.current = false;
    }, []),
  );

  const pickupLat = pickup?.lat ?? null;
  const pickupLng = pickup?.lng ?? null;
  const destinationLat = destination?.lat ?? null;
  const destinationLng = destination?.lng ?? null;
  const routeKey =
    pickupLat !== null &&
    pickupLng !== null &&
    destinationLat !== null &&
    destinationLng !== null
      ? `${pickupLat},${pickupLng};${destinationLat},${destinationLng}`
      : null;

  useEffect(() => {
    if (
      routeKey === null ||
      pickupLat === null ||
      pickupLng === null ||
      destinationLat === null ||
      destinationLng === null
    ) return;

    const controller = new AbortController();
    let active = true;

    const debounce = setTimeout(() => {
      const timeout = setTimeout(() => controller.abort(), 12000);
      void getRoadRoute(
        { lat: pickupLat, lng: pickupLng },
        { lat: destinationLat, lng: destinationLng },
        controller.signal,
      )
        .then((result) => {
          clearTimeout(timeout);
          if (!active) return;
          if (result) {
            setRouteResponse({ key: routeKey, status: 'ready', route: result });
          } else {
            setRouteResponse({ key: routeKey, status: 'no-route' });
          }
        })
        .catch(() => {
          clearTimeout(timeout);
          if (active) setRouteResponse({ key: routeKey, status: 'unavailable' });
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(debounce);
      controller.abort();
    };
  }, [destinationLat, destinationLng, pickupLat, pickupLng, routeKey]);

  const currentRouteResponse = routeResponse?.key === routeKey ? routeResponse : null;
  const roadRoute = currentRouteResponse?.route ?? null;
  const routeStatus =
    routeKey === null ? 'idle' : currentRouteResponse?.status ?? 'loading';
  const routeDistanceKm = roadRoute?.distanceKm ?? null;
  const nearbyHospitals = useMemo(() => {
    const origin =
      pickupLat != null && pickupLng != null
        ? { lat: pickupLat, lng: pickupLng }
        : devicePoint;
    if (!origin) return [];

    return hospitals
      .filter((hospital) => hospital.lat != null && hospital.lng != null)
      .map((hospital) => ({
        name: hospital.name,
        lat: Number(hospital.lat),
        lng: Number(hospital.lng),
        distance: straightLineKm(origin, {
          lat: Number(hospital.lat),
          lng: Number(hospital.lng),
        }),
      }))
      .filter(
        (hospital) =>
          Number.isFinite(hospital.lat) &&
          Number.isFinite(hospital.lng) &&
          hospital.distance <= 20,
      )
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 12)
      .map(({ name, lat, lng }) => ({ name, lat, lng }));
  }, [devicePoint, hospitals, pickupLat, pickupLng]);

  const handleSelectCategory = (key: AmbulanceCategory) => {
    if (key === selectedCategory) return;
    // Lightweight state transition for the selected card; a no-op on
    // platforms where layout animation is unavailable.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCategory(key);
  };

  const handleFindAmbulance = () => {
    setHint(null);
    if (!pickup) {
      setHint('Set your pickup location first.');
      navigation.navigate('LocationSearch', { mode: 'pickup' });
      return;
    }
    if (!destination) {
      setHint('Choose the hospital or destination for this trip.');
      navigation.navigate('LocationSearch', { mode: 'destination' });
      return;
    }

    if (processingNavigation.current) return;
    processingNavigation.current = true;

    const ambulance = buildCategoryOption(SERVICE_CATEGORIES[selectedCategory]);
    const fare = estimateFare(selectedCategory, routeDistanceKm);
    navigation.navigate('Processing', {
      bookingData: {
        ambulance,
        pickup,
        destination,
        bookingFor: 'self',
        patientName: user?.full_name?.trim() || undefined,
        patientPhone: user?.phone || undefined,
        paymentMethod: 'cash',
        emergencyLevel: selectedCategory === 'icu' ? 'high' : 'medium',
        fareBreakdown: fare,
        totalFare: fare?.totalFare ?? null,
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.mapArea}>
        <MapCanvas
          pickup={pickup && pickup.lat != null && pickup.lng != null ? { lat: pickup.lat, lng: pickup.lng } : null}
          destination={
            destination && destination.lat != null && destination.lng != null
              ? { lat: destination.lat, lng: destination.lng }
              : null
          }
          current={devicePoint}
          hospitals={nearbyHospitals}
          route={roadRoute?.coordinates}
          pickupLabel={pickup?.address}
          destinationLabel={destination?.address}
          interactive
          style={styles.map}
        />

        {/* Minimal top controls — menu and SOS only, so the map reads first. */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => navigation.navigate('MenuDrawer')}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
          >
            <Text style={styles.menuButtonIcon}>☰</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sosTopButton}
            onPress={() => navigation.navigate('SOS')}
            accessibilityRole="button"
            accessibilityLabel="Emergency SOS"
            accessibilityHint="Opens the SOS screen; arming the alert takes three deliberate taps"
          >
            <Text style={styles.sosTopText}>SOS</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Booking sheet */}
      <View style={styles.sheetWrap}>
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
        >
            <View style={styles.handleBar} />

            <View style={styles.locationCard}>
              <TouchableOpacity
                style={styles.locationRow}
                onPress={() => navigation.navigate('LocationSearch', { mode: 'pickup' })}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Your location. ${pickup ? pickup.address : 'Tap to set pickup location'}`}
              >
                <View style={[styles.locationIconWrap, { backgroundColor: colors.greenLight }]}>
                  <View style={[styles.locationDot, { backgroundColor: colors.success }]} />
                </View>
                <View style={styles.locationTextWrap}>
                  <Text style={styles.locationLabel}>Your location</Text>
                  <Text
                    style={pickup ? styles.locationValue : styles.locationPlaceholder}
                    numberOfLines={2}
                  >
                    {pickup ? pickup.address : 'Tap to set pickup location'}
                  </Text>
                </View>
                <Text style={styles.locationChevron}>›</Text>
              </TouchableOpacity>

              <View style={styles.locationDivider} />

              <TouchableOpacity
                style={styles.locationRow}
                onPress={() => navigation.navigate('LocationSearch', { mode: 'destination' })}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Where to? ${destination ? destination.address : 'Tap to search hospital or destination'}`}
              >
                <View style={[styles.locationIconWrap, { backgroundColor: colors.redLight }]}>
                  <View style={[styles.locationDot, { backgroundColor: colors.primary }]} />
                </View>
                <View style={styles.locationTextWrap}>
                  <Text style={styles.locationLabel}>Where to?</Text>
                  <Text
                    style={destination ? styles.locationValue : styles.locationPlaceholder}
                    numberOfLines={2}
                  >
                    {destination ? destination.address : 'Tap to search hospital or destination'}
                  </Text>
                </View>
                <Text style={styles.locationChevron}>›</Text>
              </TouchableOpacity>
            </View>

            {isLocating ? (
              <Text style={styles.metaLine}>Reading your current location…</Text>
            ) : routeStatus === 'loading' ? (
              <Text style={styles.metaLine}>Calculating road route…</Text>
            ) : roadRoute ? (
              <Text style={styles.metaLine}>
                Road estimate: {formatKm(routeDistanceKm)} · about {roadRoute.durationMinutes} min
                {' '}(no live traffic)
              </Text>
            ) : routeStatus === 'no-route' ? (
              <Text style={styles.metaLine}>No drivable route was found; distance and ETA are unavailable.</Text>
            ) : routeStatus === 'unavailable' ? (
              <Text style={styles.metaLine}>Road route unavailable; distance and ETA are unknown.</Text>
            ) : null}

            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
            {hospitalLoadFailed ? (
              <Text style={styles.metaLine}>
                Nearby hospital pins are unavailable. Search the directory to choose a destination.
              </Text>
            ) : null}

            <Text style={styles.sectionLabel}>Select Ambulance Type</Text>

            <View style={styles.categoryRow}>
              {SERVICE_CATEGORY_LIST.map((category) => {
                const copy = HOME_CATEGORY_COPY[category.key];
                const isSelected = selectedCategory === category.key;
                const accent = category.emergency ? colors.primary : colors.info;
                const soft = category.emergency ? colors.redLight : colors.blueLight;
                const tint = category.emergency ? '#FEF2F2' : '#EFF6FF';
                return (
                  <TouchableOpacity
                    key={category.key}
                    style={[
                      styles.categoryCard,
                      { borderColor: `${accent}40` },
                      isSelected && {
                        borderWidth: 2,
                        borderColor: accent,
                        backgroundColor: tint,
                      },
                    ]}
                    onPress={() => handleSelectCategory(category.key)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${copy.label}. ${copy.description}${
                      isSelected ? '. Selected' : ''
                    }`}
                  >
                    {isSelected ? (
                      <View style={[styles.categoryCheck, { backgroundColor: accent }]}>
                        <Text style={styles.categoryCheckText}>✓</Text>
                      </View>
                    ) : null}
                    <View style={[styles.categoryIconWrap, { backgroundColor: soft }]}>
                      <Text style={styles.categoryIcon}>🚑</Text>
                    </View>
                    <Text style={styles.categoryName} numberOfLines={1}>
                      {copy.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Button
              title="Find Ambulance →"
              onPress={handleFindAmbulance}
              fullWidth
              style={styles.cta}
            />
          </ScrollView>
        </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapArea: { flex: 1, position: 'relative' },
  map: { ...StyleSheet.absoluteFill },

  topBar: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sosTopButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
    ...shadows.md,
  },
  sosTopText: { ...typography.caption, color: colors.surface, fontWeight: '800' },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  menuButtonIcon: { fontSize: 20, color: colors.text, fontWeight: '700' },

  sheetWrap: { flexGrow: 0, flexShrink: 0 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    maxHeight: 510,
    ...shadows.lg,
  },
  sheetContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },

  locationCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
  },
  locationIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationDot: { width: 12, height: 12, borderRadius: 6 },
  locationTextWrap: { flex: 1 },
  locationLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  locationValue: { ...typography.caption, fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  locationPlaceholder: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: 2,
  },
  locationChevron: { fontSize: 22, color: colors.textTertiary },
  locationDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 58,
  },
  metaLine: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  sectionLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: 2,
  },

  hint: {
    ...typography.bodySmall,
    color: colors.warning,
    backgroundColor: colors.amberLight,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  cta: { marginTop: spacing.md },

  categoryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  categoryCard: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radii.lg,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    position: 'relative',
  },
  categoryCheck: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCheckText: { color: colors.surface, fontSize: 11, fontWeight: '800', lineHeight: 14 },
  categoryIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  categoryIcon: { fontSize: 18 },
  categoryName: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
    color: colors.text,
    textAlign: 'center',
  },
});

export default HomeScreen;
