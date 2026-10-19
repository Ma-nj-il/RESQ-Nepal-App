import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SectionList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Input, EmptyState, Button } from '../../components/ui';
import { hospitalsService } from '../../services/database/hospitals';
import { savedPlacesService } from '../../services/database/savedPlaces';
import { bookingsService } from '../../services/database/bookings';
import { isSupabaseConfigured } from '../../services/database/client';
import { savedHospitalsService, SavedHospital } from '../../services/hospitals/savedHospitalsService';
import { locationService } from '../../services/location/locationService';
import { useAuthStore } from '../../store/authStore';
import { useBookingStore } from '../../store/bookingStore';
import { isDemoMode } from '../../utils/demoMode';
import { formatDistance } from '../../utils/format';
import { straightLineKm } from '../../utils/geo';
import { Hospital, RoutePoint, SavedPlace } from '../../types';

interface ResultItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  point: () => RoutePoint;
}

interface Section {
  title: string;
  note?: string;
  data: ResultItem[];
}

type SearchTab = 'hospitals' | 'saved' | 'recent';

const TABS: { key: SearchTab; label: string }[] = [
  { key: 'hospitals', label: 'Hospitals' },
  { key: 'saved', label: 'Saved' },
  { key: 'recent', label: 'Recent' },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fallback directory used only when the hospital table cannot be reached and
 * the app is in demo/sample mode. Clearly labelled in the list header.
 */
const SAMPLE_PLACES: { name: string; address: string }[] = [
  { name: 'Norvic International Hospital', address: 'Thapathali, Kathmandu' },
  { name: 'Grande International Hospital', address: 'Dhapasi, Kathmandu' },
  { name: 'Tribhuvan University Teaching Hospital', address: 'Maharajgunj, Kathmandu' },
  { name: 'Bir Hospital', address: 'Kanti Path, Kathmandu' },
  { name: 'Patan Hospital', address: 'Lagankhel, Lalitpur' },
];

const LocationSearchScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const mode: 'pickup' | 'destination' = route.params?.mode === 'destination' ? 'destination' : 'pickup';

  const { user } = useAuthStore();
  const { pickup, destination, setPickup, setDestination } = useBookingStore();

  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SearchTab>('hospitals');
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hospitalsLoading, setHospitalsLoading] = useState(true);
  const [hospitalsError, setHospitalsError] = useState<string | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [savedHospitals, setSavedHospitals] = useState<SavedHospital[]>([]);
  const [recentAddresses, setRecentAddresses] = useState<string[]>([]);
  const [isUsingCurrent, setIsUsingCurrent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const useSampleDirectory = !isSupabaseConfigured || Boolean(hospitalsError);

  const loadHospitals = useCallback(async () => {
    setHospitalsLoading(true);
    try {
      const rows = await hospitalsService.search('', 30);
      setHospitals(rows);
      setHospitalsError(null);
    } catch {
      setHospitals([]);
      setHospitalsError(
        'Could not reach the hospital directory. Check your connection and retry, or type an address below.',
      );
    } finally {
      setHospitalsLoading(false);
    }
  }, []);

  // Starred hospitals live on this device only; the list is available in every
  // mode (including the demo walkthrough) because it never leaves the phone.
  useEffect(() => {
    let active = true;
    savedHospitalsService
      .list()
      .then((rows) => {
        if (active) setSavedHospitals(rows);
      })
      .catch(() => {
        // A corrupted local list simply keeps the Saved tab empty.
      });
    return () => {
      active = false;
    };
  }, []);

  // Saved places and recent destinations need a real signed-in user; the demo
  // session is local-only, so those sections are skipped in demo mode.
  useEffect(() => {
    const userId = user?.id;
    if (!isSupabaseConfigured || !userId || isDemoMode() || !UUID_RE.test(userId)) return;
    let active = true;

    (async () => {
      try {
        const places = await savedPlacesService.getByUser(userId);
        if (active) setSavedPlaces(places);
      } catch {
        // Saved places are optional; the section simply stays empty.
      }
      try {
        const bookings = await bookingsService.getByUser(userId);
        if (!active) return;
        const seen = new Set<string>();
        const recents: string[] = [];
        for (const booking of bookings) {
          const address = booking.destination_address?.trim();
          if (!address || seen.has(address)) continue;
          seen.add(address);
          recents.push(address);
          if (recents.length >= 4) break;
        }
        setRecentAddresses(recents);
      } catch {
        // Recent trips are optional.
      }
    })();

    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadHospitals();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadHospitals]);

  const select = useCallback(
    (point: RoutePoint) => {
      if (mode === 'pickup') {
        setPickup(point);
      } else {
        setDestination(point);
      }
      navigation.goBack();
    },
    [mode, navigation, setDestination, setPickup],
  );

  const applyTypedAddress = useCallback(async () => {
    const address = query.trim();
    if (!address) return;
    setNotice(null);
    try {
      const results = await Location.geocodeAsync(address);
      if (results.length > 0) {
        select({
          address,
          lat: results[0].latitude,
          lng: results[0].longitude,
          source: 'typed',
        });
        return;
      }
      setNotice('Could not find coordinates for this address — it will be used as typed.');
    } catch {
      setNotice('Geocoding unavailable right now — the address will be used as typed.');
    }
    select({ address, lat: null, lng: null, source: 'typed' });
  }, [query, select]);

  const handleUseCurrentLocation = useCallback(async () => {
    setIsUsingCurrent(true);
    setNotice(null);
    try {
      const hasPermission = await locationService.requestPermission();
      if (!hasPermission) {
        setNotice('Location permission was not granted. Search for a place instead.');
        return;
      }
      const loc = await locationService.getCurrentLocation();
      if (!loc) {
        setNotice('Could not read the device location. Search for a place instead.');
        return;
      }
      const address = await locationService.reverseGeocode(loc.lat, loc.lng);
      select({ address, lat: loc.lat, lng: loc.lng, source: 'current' });
    } catch {
      setNotice('Could not read the device location. Search for a place instead.');
    } finally {
      setIsUsingCurrent(false);
    }
  }, [select]);

  const toItem = useCallback((hospital: Hospital): ResultItem => ({
    id: `hospital-${hospital.id}`,
    title: hospital.name,
    subtitle: hospital.address || undefined,
    icon: '🏥',
    point: () => ({
      address: [hospital.name, hospital.address].filter(Boolean).join(', '),
      lat: hospital.lat,
      lng: hospital.lng,
      source: 'search',
    }),
  }), []);

  const queryFilter = query.trim().toLowerCase();
  const matchesQuery = useCallback(
    (...fields: (string | undefined | null)[]) =>
      !queryFilter || fields.some((field) => field && field.toLowerCase().includes(queryFilter)),
    [queryFilter],
  );

  const sections: Section[] = useMemo(() => {
    const out: Section[] = [];

    if (activeTab === 'hospitals') {
      const hospitalRows = hospitals.filter((h) => matchesQuery(h.name, h.address));
      if (hospitalRows.length > 0) {
        out.push({
          title: 'Hospitals',
          note: 'From the RESQ Nepal hospital directory',
          data: hospitalRows.map(toItem),
        });
      }

      if (useSampleDirectory) {
        const sampleRows = SAMPLE_PLACES.filter((s) => matchesQuery(s.name, s.address));
        if (sampleRows.length > 0) {
          out.push({
            title: 'Sample places',
            note: 'Demo directory — approximate locations, not live records',
            data: sampleRows.map((place, index) => ({
              id: `sample-${index}`,
              title: place.name,
              subtitle: place.address,
              icon: '🏥',
              point: () => ({
                address: `${place.name}, ${place.address}`,
                lat: null,
                lng: null,
                source: 'sample' as const,
              }),
            })),
          });
        }
      }
      return out;
    }

    if (activeTab === 'saved') {
      const matchingSavedHospitals = savedHospitals.filter((h) => matchesQuery(h.name, h.address));
      if (matchingSavedHospitals.length > 0) {
        out.push({
          title: 'Saved hospitals',
          note: 'Starred on this device — details may be out of date',
          data: matchingSavedHospitals.map((hospital) => ({
            id: `saved-hospital-${hospital.id}`,
            title: hospital.name,
            subtitle: hospital.address || undefined,
            icon: '⭐',
            point: () => ({
              address: [hospital.name, hospital.address].filter(Boolean).join(', '),
              lat: hospital.lat,
              lng: hospital.lng,
              source: 'saved' as const,
            }),
          })),
        });
      }

      const matchingSaved = savedPlaces.filter((p) => matchesQuery(p.name, p.address));
      if (matchingSaved.length > 0) {
        out.push({
          title: 'Saved places',
          data: matchingSaved.map((place) => ({
            id: `saved-${place.id}`,
            title: place.name,
            subtitle: place.address,
            icon: place.type === 'home' ? '🏠' : place.type === 'work' ? '💼' : '📍',
            point: () => ({
              address: [place.name, place.address].filter(Boolean).join(', '),
              lat: place.lat,
              lng: place.lng,
              source: 'saved' as const,
            }),
          })),
        });
      }
      return out;
    }

    const matchingRecents = recentAddresses.filter((address) => matchesQuery(address));
    if (matchingRecents.length > 0) {
      out.push({
        title: 'Recent destinations',
        data: matchingRecents.map((address, index) => ({
          id: `recent-${index}`,
          title: address,
          subtitle: 'From your previous trips',
          icon: '🕐',
          point: () => ({ address, lat: null, lng: null, source: 'recent' as const }),
        })),
      });
    }
    return out;
  }, [activeTab, hospitals, matchesQuery, recentAddresses, savedHospitals, savedPlaces, toItem, useSampleDirectory]);

  const renderItem = ({ item }: { item: ResultItem }) => {
    const point = item.point();
    // Straight-line distance from the current pickup, only when both points
    // actually have coordinates. Labelled as-distance-on-the-map, never a
    // route length.
    const km =
      pickup?.lat != null && pickup?.lng != null && point.lat != null && point.lng != null
        ? straightLineKm(
            { lat: pickup.lat, lng: pickup.lng },
            { lat: point.lat, lng: point.lng },
          )
        : null;
    return (
      <TouchableOpacity
        style={styles.resultItem}
        onPress={() => select(point)}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <View style={styles.resultIcon}>
          <Text style={styles.resultEmoji}>{item.icon}</Text>
        </View>
        <View style={styles.resultContent}>
          <Text style={styles.resultTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {item.subtitle ? (
            <Text style={styles.resultSubtitle} numberOfLines={1}>
              {item.subtitle}
            </Text>
          ) : null}
        </View>
        {km !== null ? <Text style={styles.resultDistance}>{formatDistance(km)}</Text> : null}
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  };

  const currentValue = mode === 'pickup' ? pickup : destination;
  const showLoadingRow = hospitalsLoading && query.trim().length === 0 && activeTab === 'hospitals';
  const noResults = !showLoadingRow && sections.length === 0;

  const emptyCopy: Record<SearchTab, { icon: string; title: string; message: string }> = {
    hospitals: {
      icon: '🔍',
      title: 'No matching places',
      message: 'Try a different hospital name or address, or use the typed address option above.',
    },
    saved: {
      icon: '🔖',
      title: 'Nothing saved yet',
      message: 'Star a hospital from its details screen or save a place and it will appear here.',
    },
    recent: {
      icon: '🕐',
      title: 'No recent destinations yet',
      message: 'Destinations from trips you book will appear here.',
    },
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Slim header — the search field below is the screen's heading, as in
          the reference layout. */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchSection}>
        <Input
          placeholder={mode === 'pickup' ? 'Search pickup hospital, landmark or address' : 'Search hospital or destination'}
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            setNotice(null);
          }}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => {
            if (query.trim()) void applyTypedAddress();
          }}
          icon={<Text style={styles.searchIcon}>🔍</Text>}
          rightElement={
            query.length > 0 ? (
              <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search">
                <Text style={styles.clearIcon}>✕</Text>
              </TouchableOpacity>
            ) : undefined
          }
        />

        {/* Source tabs: directory, saved-on-device, previous trips. */}
        <View style={styles.tabs}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {mode === 'pickup' && (
          <TouchableOpacity
            style={styles.currentRow}
            onPress={handleUseCurrentLocation}
            disabled={isUsingCurrent}
            activeOpacity={0.7}
          >
            {isUsingCurrent ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.currentIcon}>◎</Text>
            )}
            <Text style={styles.currentText}>Use my current location</Text>
          </TouchableOpacity>
        )}

        {currentValue ? (
          <Text style={styles.currentValue} numberOfLines={1}>
            Current {mode === 'pickup' ? 'pickup' : 'destination'}: {currentValue.address}
          </Text>
        ) : null}

        {query.trim().length > 1 ? (
          <TouchableOpacity style={styles.typedRow} onPress={applyTypedAddress} activeOpacity={0.7}>
            <Text style={styles.typedIcon}>📍</Text>
            <Text style={styles.typedText} numberOfLines={1}>
              Use “{query.trim()}” as the {mode === 'pickup' ? 'pickup' : 'destination'} address
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {notice ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {hospitalsError && activeTab === 'hospitals' ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{hospitalsError}</Text>
          <Button title="Retry" variant="outline" size="sm" onPress={loadHospitals} style={styles.retryButton} />
        </View>
      ) : null}

      {showLoadingRow ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Loading hospital directory…</Text>
        </View>
      ) : null}

      {noResults ? (
        <EmptyState
          icon={emptyCopy[activeTab].icon}
          title={emptyCopy[activeTab].title}
          message={emptyCopy[activeTab].message}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{(section as Section).title}</Text>
              {(section as Section).note ? (
                <Text style={styles.sectionNote}>{(section as Section).note}</Text>
              ) : null}
            </View>
          )}
        />
      )}

      {/* Manual pin selection, matching the reference's bottom row. */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.mapRow}
          onPress={() => navigation.navigate('MapPicker', { mode })}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Choose from map"
        >
          <Text style={styles.mapRowIcon}>📍</Text>
          <Text style={styles.mapRowText}>Choose from map</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
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
    paddingTop: spacing.sm,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { fontSize: 24, color: colors.text },

  searchSection: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  searchIcon: { fontSize: 16 },
  clearIcon: { fontSize: 16, color: colors.textTertiary, padding: spacing.xs },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  currentIcon: { fontSize: 18, color: colors.primary, fontWeight: '700' },
  currentText: { ...typography.body, color: colors.primary, fontWeight: '600' },
  currentValue: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  typedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.input,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  typedIcon: { fontSize: 16 },
  typedText: { ...typography.bodySmall, color: colors.text, flex: 1 },

  tabs: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tab: { paddingBottom: spacing.sm },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { ...typography.bodySmall, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.primary },

  noticeCard: {
    backgroundColor: colors.amberLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  noticeText: { ...typography.bodySmall, color: colors.warning },
  errorCard: {
    backgroundColor: colors.redLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  errorText: { ...typography.bodySmall, color: colors.error },
  retryButton: { marginTop: spacing.sm, alignSelf: 'flex-start' },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  loadingText: { ...typography.bodySmall, color: colors.textSecondary },

  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  sectionHeader: { paddingTop: spacing.lg, paddingBottom: spacing.xs },
  sectionTitle: { ...typography.bodySmall, fontWeight: '700', color: colors.text },
  sectionNote: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },

  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  resultEmoji: { fontSize: 18 },
  resultContent: { flex: 1 },
  resultTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  resultSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  resultDistance: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing.sm },
  chevron: { fontSize: 22, color: colors.textTertiary, marginLeft: spacing.sm },

  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  mapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.input,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  mapRowIcon: { fontSize: 16 },
  mapRowText: { ...typography.bodySmall, fontWeight: '600', color: colors.text, flex: 1 },
});

export default LocationSearchScreen;
