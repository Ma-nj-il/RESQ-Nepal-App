import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { Button, Badge } from '../../components/ui';
import { MapCanvas } from '../../components/map/MapCanvas';
import { RouteSummary } from '../../components/booking/RouteSummary';
import { ServiceCategoryCard } from '../../components/booking/ServiceCategoryCard';
import { SERVICE_CATEGORY_LIST, ServiceCategory } from '../../constants/serviceCategories';
import { estimateFare, startingPrice } from '../../constants/fares';
import { ambulancesService } from '../../services/database/ambulances';
import { isSupabaseConfigured } from '../../services/database/client';
import { useBookingStore } from '../../store/bookingStore';
import { isDemoMode } from '../../utils/demoMode';
import { buildCategoryOption } from '../../utils/categoryOption';
import { formatKm, straightLineKm } from '../../utils/geo';
import { Ambulance, AmbulanceStatus } from '../../types';

export interface AmbulanceOption extends Ambulance {
  /** True when the row comes from the labelled demo/sample list. */
  isSample?: boolean;
  /** True when the option represents a whole service category, not a vehicle. */
  isCategoryOption?: boolean;
}

/**
 * Labelled demo vehicles. Shown only in demo mode or when no database is
 * configured — never mixed with real rows. No driver names, ratings or plate
 * numbers are attached to sample entries.
 */
const SAMPLE_VEHICLES: AmbulanceOption[] = [
  {
    id: 'demo-basic',
    driver_id: '',
    category: 'basic',
    plate_number: '',
    model: 'Toyota Hiace (sample)',
    color: 'White',
    status: 'available',
    equipment: ['Stretcher', 'Oxygen Cylinder', 'First Aid Kit'],
    created_at: '',
    isSample: true,
  },
  {
    id: 'demo-icu',
    driver_id: '',
    category: 'icu',
    plate_number: '',
    model: 'Force Traveller (sample)',
    color: 'White',
    status: 'available',
    equipment: ['Stretcher', 'Oxygen Cylinder', 'Ventilator', 'Defibrillator', 'Cardiac Monitor'],
    created_at: '',
    isSample: true,
  },
];

const AmbulanceListScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { pickup, destination } = useBookingStore();

  const [ambulances, setAmbulances] = useState<AmbulanceOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingSampleData, setUsingSampleData] = useState(false);

  const routeDistanceKm = useMemo(() => {
    if (pickup?.lat == null || pickup?.lng == null || destination?.lat == null || destination?.lng == null) {
      return null;
    }
    return straightLineKm(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: destination.lat, lng: destination.lng },
    );
  }, [pickup, destination]);

  const fetchAmbulances = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!isSupabaseConfigured || isDemoMode()) {
        // No database, or an explicit demo run — clearly-labelled samples.
        setUsingSampleData(true);
        setError(null);
        setAmbulances(SAMPLE_VEHICLES);
        return;
      }
      setUsingSampleData(false);
      const data = await ambulancesService.getAll();
      setAmbulances(data);
      setError(null);
    } catch {
      setAmbulances([]);
      setError('Could not load ambulances. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchAmbulances();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchAmbulances]);

  const availableByCategory = useMemo(() => {
    const count: Record<string, number> = { basic: 0, icu: 0 };
    for (const item of ambulances) {
      if (item.status === 'available') count[item.category] = (count[item.category] ?? 0) + 1;
    }
    return count;
  }, [ambulances]);

  const handleSelectVehicle = (ambulance: AmbulanceOption) => {
    navigation.navigate('AmbulanceDetails', { ambulance });
  };

  const handleSelectCategory = (category: ServiceCategory) => {
    navigation.navigate('AmbulanceDetails', { ambulance: buildCategoryOption(category) });
  };

  const statusLabel = (status: AmbulanceStatus) =>
    status === 'available' ? 'Available now' : status === 'busy' ? 'Currently on duty' : 'Offline';

  const routeReady = Boolean(pickup && destination);

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
          caption={routeDistanceKm ? `Straight-line · ${formatKm(routeDistanceKm)}` : undefined}
          style={styles.map}
        />

        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <View style={styles.titlePill}>
            <Text style={styles.titleText}>Choose ambulance</Text>
          </View>
          <TouchableOpacity
            style={styles.backButton}
            onPress={fetchAmbulances}
            accessibilityRole="button"
            accessibilityLabel="Refresh available ambulances"
          >
            <Text style={styles.refreshIcon}>⟳</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.sheetWrap}>
          <ScrollView
            style={styles.sheet}
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.handleBar} />

            <RouteSummary
              pickup={pickup}
              destination={destination}
              onEditPickup={() => navigation.navigate('LocationSearch', { mode: 'pickup' })}
              onEditDestination={() => navigation.navigate('LocationSearch', { mode: 'destination' })}
              meta={routeDistanceKm ? `Approx. ${formatKm(routeDistanceKm)} straight line between the two points` : null}
            />

            {!routeReady && (
              <View style={styles.hintCard}>
                <Text style={styles.hintText}>
                  Set the pickup and destination to see an indicative fare. You can still request a
                  service without them, but the crew will call to confirm.
                </Text>
              </View>
            )}

            {usingSampleData && (
              <Text style={styles.demoNote}>
                {isDemoMode()
                  ? 'Demo mode — sample ambulances, no real drivers are attached.'
                  : 'Sample mode — database not configured. Showing example ambulances.'}
              </Text>
            )}

            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{error}</Text>
                <Button title="Retry" variant="outline" size="sm" onPress={fetchAmbulances} />
              </View>
            ) : null}

            <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>Book by service</Text>
            <Text style={styles.sectionNote}>
              {usingSampleData
                ? 'Demo availability — real requests depend on the live fleet.'
                : Object.values(availableByCategory).some((n) => n > 0)
                  ? 'Fare estimate uses the straight-line distance between your two points.'
                  : 'No verified ambulance is listed as available right now; requests are queued for the next crew that comes online.'}
            </Text>

            {SERVICE_CATEGORY_LIST.map((category) => {
              const count = availableByCategory[category.key] ?? 0;
              const availability =
                count > 0
                  ? usingSampleData
                    ? `${count} sample vehicle${count === 1 ? '' : 's'}`
                    : `${count} listed as available`
                  : usingSampleData
                    ? 'Sample availability — demo only'
                    : 'None listed as available right now';
              return (
                <ServiceCategoryCard
                  key={category.key}
                  category={category}
                  estimate={estimateFare(category.key, routeDistanceKm)}
                  startingPrice={startingPrice(category.key)}
                  availability={availability}
                  available={count > 0 || usingSampleData}
                  onPress={() => handleSelectCategory(category)}
                />
              );
            })}

            {isLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.loadingText}>Looking for available ambulances…</Text>
              </View>
            ) : ambulances.length > 0 ? (
              <>
                <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
                  {usingSampleData ? 'Sample vehicles' : 'Ambulances listed as available'}
                </Text>
                {ambulances.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.vehicleCard}
                    onPress={() => handleSelectVehicle(item)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.model || 'Ambulance'}, ${
                      item.isSample ? 'sample vehicle, availability not confirmed' : statusLabel(item.status)
                    }`}
                  >
                    <View style={styles.vehicleIconWrap}>
                      <Text style={styles.vehicleIcon}>🚑</Text>
                    </View>
                    <View style={styles.vehicleInfo}>
                      <View style={styles.vehicleTitleRow}>
                        <Text style={styles.vehicleModel} numberOfLines={1}>
                          {item.model || 'Ambulance'}
                        </Text>
                        <Badge
                          label={item.category === 'icu' ? 'ICU' : 'Basic'}
                          variant={item.category === 'icu' ? 'error' : 'success'}
                        />
                      </View>
                      <Text style={styles.vehicleMeta} numberOfLines={1}>
                        {item.isSample
                          ? 'Sample vehicle — availability not confirmed'
                          : `${statusLabel(item.status)}${item.plate_number ? ` · ${item.plate_number}` : ''}`}
                      </Text>
                      <Text style={styles.vehicleEquipment} numberOfLines={1}>
                        {item.equipment.slice(0, 3).join(' · ')}
                        {item.equipment.length > 3 ? ` +${item.equipment.length - 3}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </>
            ) : !error ? (
              <Text style={styles.emptyNote}>
                No verified ambulance is listed right now. You can still send a request — it becomes
                visible to ambulance crews as soon as one is online.
              </Text>
            ) : null}

            <Text style={styles.disclaimer}>
              RESQ Nepal never shows invented vehicles or arrival times. What you see here is the
              live database — or a clearly-labelled sample.
            </Text>
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
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  backArrow: { fontSize: 22, color: colors.text },
  refreshIcon: { fontSize: 20, color: colors.text },
  titlePill: {
    backgroundColor: colors.surface,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.md,
  },
  titleText: { ...typography.bodySmall, fontWeight: '700', color: colors.text },

  // The sheet is a normal flex column sibling of the map. The height cap must
  // live here (percentage of the definite-height screen), NOT on the ScrollView:
  // a percentage maxHeight on a child of an auto-height wrapper is resolved
  // twice by Yoga (72% x 72%) and silently clips the sheet content.
  sheetWrap: {
    marginTop: -spacing.lg,
    height: '64%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    ...shadows.lg,
  },
  sheet: { flex: 1 },
  sheetContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },

  hintCard: {
    backgroundColor: colors.amberLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  hintText: { ...typography.bodySmall, color: colors.warning },

  demoNote: {
    ...typography.caption,
    color: colors.textTertiary,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  errorBanner: {
    backgroundColor: colors.redLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  errorBannerText: { ...typography.bodySmall, color: colors.error },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  loadingText: { ...typography.bodySmall, color: colors.textSecondary },

  sectionTitle: { ...typography.h4, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionTitleFirst: { marginTop: spacing.sm },
  sectionTitleSpaced: { marginTop: spacing.lg },
  sectionNote: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },

  vehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  vehicleIconWrap: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  vehicleIcon: { fontSize: 24 },
  vehicleInfo: { flex: 1 },
  vehicleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  vehicleModel: { ...typography.body, fontWeight: '600', color: colors.text, flexShrink: 1 },
  vehicleMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  vehicleEquipment: { ...typography.caption, color: colors.textTertiary, marginTop: 1 },
  chevron: { fontSize: 22, color: colors.textTertiary, marginLeft: spacing.sm },

  emptyNote: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    backgroundColor: colors.input,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  disclaimer: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.md },
});

export default AmbulanceListScreen;
