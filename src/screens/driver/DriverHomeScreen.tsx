import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Badge, Button, Card, Toggle } from '../../components/ui';
import { MapCanvas } from '../../components/map/MapCanvas';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { useDriverDemoStore } from '../../store/driverDemoStore';
import { Driver, Ambulance } from '../../types';
import { driversService, bookingsService, ambulancesService, isSupabaseConfigured } from '../../services/database';
import { locationService } from '../../services/location/locationService';
import { isDemoMode } from '../../utils/demoMode';

type TabKey = 'home' | 'requests' | 'earnings' | 'profile';

// Fictional driver identity used ONLY by the Driver Mode demo walkthrough
// (demo builds or a build without Supabase credentials). Every screen that
// shows it labels it as sample data, nothing is ever written to a database,
// and the plate is not a real registration. The patient-side demo uses the
// same fictional crew so both sides tell one consistent story.
const WALKTHROUGH_DRIVER: Driver = {
  id: 'walkthrough-driver',
  user_id: 'walkthrough-user',
  license_number: 'WALKTHROUGH-LIC',
  license_expiry: '2030-12-31',
  status: 'verified',
  rating: 0,
  total_rides: 0,
  verified_at: '2026-01-01',
  created_at: '2026-01-01',
};

const WALKTHROUGH_AMBULANCE: Ambulance = {
  id: 'walkthrough-ambulance',
  driver_id: 'walkthrough-driver',
  category: 'icu',
  plate_number: 'BA 2 KHA 4321',
  model: 'Force Traveller',
  color: 'White',
  status: 'available',
  equipment: ['Oxygen', 'Stretcher', 'Ventilator', 'Defibrillator', 'First Aid Kit'],
  hospital_affiliation: 'Walkthrough sample',
  created_at: '2026-01-01',
};

const DriverHomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();

  const [isOnline, setIsOnline] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [driver, setDriver] = useState<Driver | null>(null);
  const [ambulance, setAmbulance] = useState<Ambulance | null>(null);
  const [incomingCount, setIncomingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingSampleData, setUsingSampleData] = useState(false);
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [todayTrips, setTodayTrips] = useState(0);

  // Demo walkthrough runs only in demo/sample builds (never production) and
  // is fully in-memory: sample requests come from the isolated store, and
  // the online toggle never touches real availability.
  const walkthrough = isDemoMode() || !isSupabaseConfigured;
  const demoRequests = useDriverDemoStore((s) => s.requests);
  const demoCompletedTrips = useDriverDemoStore((s) => s.completedTrips);
  const demoOnline = useDriverDemoStore((s) => s.isOnline);
  const setDemoOnline = useDriverDemoStore((s) => s.setOnline);

  // Walkthrough availability is session state in the demo store so it
  // survives navigation; real mode uses the local state it always had.
  const online = walkthrough ? demoOnline : isOnline;

  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationState, setLocationState] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );

  const incomingRequests = walkthrough ? demoRequests.length : incomingCount;

  useEffect(() => {
    loadDriverData();
    // Load exactly once on mount — loadDriverData reads fresh state internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The dashboard map shows the device's own position only when the OS
  // actually provides one — never a simulated feed, and never a claim of
  // live trip tracking.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const granted = await locationService.requestPermission();
        if (!granted) {
          if (!cancelled) setLocationState('unavailable');
          return;
        }
        const point = await locationService.getCurrentLocation();
        if (cancelled) return;
        if (point) {
          setMyLocation(point);
          setLocationState('ready');
        } else {
          setLocationState('unavailable');
        }
      } catch {
        if (!cancelled) setLocationState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadDriverData() {
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode() || !isSupabaseConfigured) {
        // Walkthrough mode — fictional sample data so the whole driver
        // journey is reviewable without touching the database. Every screen
        // labels it as sample data.
        setUsingSampleData(!isDemoMode());
        setDriver(WALKTHROUGH_DRIVER);
        setAmbulance(WALKTHROUGH_AMBULANCE);
        setTodayEarnings(0);
        setTodayTrips(0);
        return;
      }

      setUsingSampleData(false);
      const userId = user?.id;
      if (!userId) {
        setDriver(null);
        setAmbulance(null);
        return;
      }

      const record = await driversService.getByUserId(userId);
      setDriver(record);
      if (record) {
        const vehicles = await driversService.getAmbulances(record.id);
        setAmbulance(vehicles[0] ?? null);

        const driverBookings = await bookingsService.getByDriver(record.id);
        const today = new Date().toDateString();
        const completedToday = driverBookings.filter(
          (b) =>
            b.status === 'completed' &&
            new Date(b.created_at).toDateString() === today,
        );
        setTodayTrips(completedToday.length);
        setTodayEarnings(
          completedToday.reduce(
            (sum, b) => sum + Number(b.final_fare ?? b.estimated_fare ?? 0),
            0,
          ),
        );
        setIncomingCount(driverBookings.filter((b) => b.status === 'pending').length);
      } else {
        setAmbulance(null);
        setIncomingCount(0);
        setTodayEarnings(0);
        setTodayTrips(0);
      }
    } catch {
      setError('Failed to load driver data. Pull to refresh.');
    } finally {
      setLoading(false);
    }
  }

  const handleOnlineChange = async (value: boolean) => {
    if (walkthrough) {
      // Walkthrough availability is session state in the demo store — it
      // never changes a real ambulance status and survives navigation.
      setDemoOnline(value);
      return;
    }
    setIsOnline(value);
    if (!isSupabaseConfigured || !ambulance) return;
    const nextStatus = value ? ('available' as const) : ('offline' as const);
    try {
      await ambulancesService.update(ambulance.id, { status: nextStatus });
      setAmbulance((prev) => (prev ? { ...prev, status: nextStatus } : prev));
    } catch {
      // Revert the toggle if the server update failed.
      setIsOnline(!value);
      Alert.alert(
        'Status not saved',
        'Could not update your availability. Please check your connection and try again.',
      );
    }
  };

  const handleGoOnline = () => {
    void handleOnlineChange(true);
  };

  const handleRestartWalkthrough = () => {
    useDriverDemoStore.getState().restart();
  };

  const handleHamburgerPress = () => {
    navigation.navigate('DriverSettings');
  };

  const renderBottomNav = () => {
    const tabs: { key: TabKey; label: string; icon: string }[] = [
      { key: 'home', label: 'Home', icon: '🏠' },
      { key: 'requests', label: 'Requests', icon: '📋' },
      { key: 'earnings', label: 'Earnings', icon: '💰' },
      { key: 'profile', label: 'Profile', icon: '👤' },
    ];

    return (
      <View style={styles.bottomNav}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={styles.bottomNavItem}
            onPress={() => {
              if (tab.key === 'home') {
                setActiveTab('home');
              } else {
                navigation.navigate(
                  tab.key === 'requests'
                    ? 'DriverRequests'
                    : tab.key === 'earnings'
                    ? 'DriverEarnings'
                    : 'DriverProfile'
                );
              }
            }}
          >
            <Text style={styles.bottomNavIcon}>{tab.icon}</Text>
            <Text
              style={[
                styles.bottomNavLabel,
                activeTab === tab.key && styles.bottomNavLabelActive,
              ]}
            >
              {tab.label}
            </Text>
            {tab.key === 'requests' && incomingRequests > 0 && (
              <View style={styles.badgeDot}>
                <Text style={styles.badgeDotText}>{incomingRequests}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading driver data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Registered-driver gate: with a real database connected but no driver
  // record, the user must apply before any driver features are usable.
  if (isSupabaseConfigured && !driver) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleHamburgerPress} style={styles.menuButton}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
          <View style={styles.driverBadge}>
            <Text style={styles.driverBadgeText}>🚨 Driver Mode</Text>
          </View>
          <View style={styles.onlineIndicator} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.gateIcon}>🚑</Text>
          <Text style={styles.gateTitle}>Become a RESQ Driver</Text>
          <Text style={styles.gateMessage}>
            You are not registered as an ambulance driver yet. Submit your license and vehicle
            details to apply. Applications are reviewed before you can receive bookings.
          </Text>
          <Button
            title="Register as Driver"
            onPress={() => navigation.navigate('DriverRegistration')}
            fullWidth
            style={{ marginTop: spacing.lg }}
          />
          <Button
            title="Switch to User Mode"
            variant="ghost"
            onPress={() => useAuthStore.getState().setMode('user')}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleHamburgerPress} style={styles.menuButton}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <View style={styles.driverBadgeRow}>
          <View style={styles.driverBadge}>
            <Text style={styles.driverBadgeText}>🚨 Driver Mode</Text>
          </View>
          {walkthrough && <Badge label="DEMO" variant="info" />}
        </View>
        <View style={styles.onlineIndicator}>
          <View
            style={[
              styles.onlineDot,
              { backgroundColor: online ? colors.success : colors.offline },
            ]}
          />
        </View>
      </View>

      {/* Position map — the device's own GPS only, never a simulated feed */}
      <View style={styles.mapContainer}>
        <MapCanvas
          current={myLocation}
          currentLabel="Your position"
          caption={
            locationState === 'ready'
              ? "Your position from this device's GPS"
              : locationState === 'loading'
              ? 'Checking your location…'
              : 'Location unavailable — showing the Kathmandu default view'
          }
        />
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {error && (
          <Card style={styles.errorCard} elevation="sm">
            <Text style={styles.errorText}>{error}</Text>
            <Button title="Retry" variant="outline" size="sm" onPress={loadDriverData} />
          </Card>
        )}

        {usingSampleData && (
          <Card elevation="sm" style={styles.sampleCard}>
            <Text style={styles.sampleText}>
              ⚠️ Sample build — database not configured. Showing example driver data. Add
              Supabase credentials in .env to load real records.
            </Text>
          </Card>
        )}

        {driver && driver.status !== 'verified' && (
          <Card elevation="sm" style={styles.verifyCard}>
            <Text style={styles.verifyTitle}>
              {driver.status === 'pending'
                ? '⏳ Verification Pending'
                : '❌ Verification Rejected'}
            </Text>
            <Text style={styles.verifyText}>
              {driver.status === 'pending'
                ? 'Your driver application is being reviewed. You will be able to accept bookings once verified by an administrator.'
                : driver.rejection_reason ||
                  'Your driver application was not approved. Contact support for details.'}
            </Text>
          </Card>
        )}

        {/* Online/Offline Toggle */}
        <Card elevation="sm" style={styles.toggleCard}>
          <View style={styles.toggleHeader}>
            <Text style={styles.toggleTitle}>
              {online ? "You're Online" : "You're Offline"}
            </Text>
            <Toggle value={online} onValueChange={handleOnlineChange} />
          </View>
          <Text style={styles.toggleSubtitle}>
            {online
              ? walkthrough
                ? 'Walkthrough open — sample requests are listed below. No real patient is notified.'
                : 'You will receive booking requests from nearby patients.'
              : walkthrough
              ? 'Go online to open the walkthrough and see the sample requests.'
              : 'Go online to start receiving booking requests.'}
          </Text>
        </Card>

        {/* Online Status Card */}
        {online ? (
          <Card elevation="sm" style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={styles.statusLeft}>
                <Text style={styles.statusLabel}>Incoming Requests</Text>
                <Text style={styles.statusValue}>{incomingRequests}</Text>
              </View>
              <Button
                title="View"
                variant="outline"
                size="sm"
                onPress={() => navigation.navigate('DriverRequests')}
              />
            </View>
          </Card>
        ) : (
          <Card elevation="sm" style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={styles.statusLeft}>
                <Text style={styles.statusLabel}>Status</Text>
                <Text style={[styles.statusValue, { color: colors.offline }]}>
                  Not receiving requests
                </Text>
              </View>
              <Button title="Go Online" size="sm" onPress={handleGoOnline} />
            </View>
          </Card>
        )}

        {/* Walkthrough controls — demo/sample builds only */}
        {walkthrough && (
          <Card elevation="sm" style={styles.walkthroughCard}>
            <Text style={styles.walkthroughTitle}>Driver walkthrough</Text>
            <Text style={styles.walkthroughText}>
              Sample requests and a sample trip for trying Driver Mode end-to-end. Nothing is
              saved and no real patient or driver is involved.
            </Text>
            <Button
              title="Restart walkthrough"
              variant="outline"
              size="sm"
              fullWidth
              onPress={handleRestartWalkthrough}
              style={styles.walkthroughButton}
            />
          </Card>
        )}

        {/* Earnings Summary */}
        <Text style={styles.sectionTitle}>Today&apos;s Summary</Text>
        <View style={styles.earningsGrid}>
          <Card elevation="sm" style={styles.earningsCard}>
            <Text style={styles.earningsLabel}>Earnings</Text>
            <Text style={styles.earningsValue}>
              NPR {walkthrough ? '0' : todayEarnings.toLocaleString('en-IN')}
            </Text>
            <Text style={styles.earningsSubtext}>
              {walkthrough ? 'walkthrough — no real earnings' : 'from completed trips'}
            </Text>
          </Card>
          <Card elevation="sm" style={styles.earningsCard}>
            <Text style={styles.earningsLabel}>Trips</Text>
            <Text style={styles.earningsValue}>
              {walkthrough ? demoCompletedTrips : todayTrips}
            </Text>
            <Text style={styles.earningsSubtext}>
              {walkthrough ? 'walkthrough trips completed' : 'completed today'}
            </Text>
          </Card>
          <Card elevation="sm" style={styles.earningsCard}>
            <Text style={styles.earningsLabel}>Rating</Text>
            <Text style={styles.earningsValue}>
              {walkthrough ? '—' : `★ ${driver?.rating ?? 0}`}
            </Text>
            <Text style={styles.earningsSubtext}>
              {walkthrough
                ? 'available after real trips'
                : `${(driver?.total_rides ?? 0).toLocaleString('en-IN')} rides`}
            </Text>
          </Card>
        </View>

        {/* Ambulance Info */}
        {ambulance && (
          <Card elevation="sm" style={styles.ambulanceCard}>
            <View style={styles.ambulanceRow}>
              <Text style={styles.ambulanceIcon}>🚑</Text>
              <View style={styles.ambulanceInfo}>
                <Text style={styles.ambulanceName}>
                  {ambulance.model} · {ambulance.plate_number}
                </Text>
                <Text style={styles.ambulanceMeta}>
                  {ambulance.category === 'icu' ? 'ICU / Emergency' : 'Basic Ambulance'}
                  {ambulance.hospital_affiliation
                    ? ` · ${ambulance.hospital_affiliation}`
                    : ''}
                </Text>
              </View>
              {walkthrough && <Badge label="SAMPLE" variant="info" />}
              <Button
                title="Manage"
                variant="outline"
                size="sm"
                onPress={() => navigation.navigate('VehicleManagement')}
              />
            </View>
          </Card>
        )}

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => navigation.navigate('DriverRequests')}
          >
            <Text style={styles.quickActionIcon}>📋</Text>
            <Text style={styles.quickActionLabel}>View Requests</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => navigation.navigate('DriverEarnings')}
          >
            <Text style={styles.quickActionIcon}>💰</Text>
            <Text style={styles.quickActionLabel}>Earnings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => navigation.navigate('VehicleManagement')}
          >
            <Text style={styles.quickActionIcon}>🚑</Text>
            <Text style={styles.quickActionLabel}>My Ambulance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => navigation.navigate('DriverProfile')}
          >
            <Text style={styles.quickActionIcon}>👤</Text>
            <Text style={styles.quickActionLabel}>Profile</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bottom Navigation */}
      {renderBottomNav()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: {
    fontSize: 24,
    color: colors.text,
  },
  driverBadge: {
    backgroundColor: colors.redLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  driverBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  driverBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  onlineIndicator: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  mapContainer: {
    height: 180,
    backgroundColor: '#E8EAF6',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  errorCard: {
    backgroundColor: colors.redLight,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  gateIcon: { fontSize: 52, marginBottom: spacing.md },
  gateTitle: { ...typography.h3, textAlign: 'center', marginBottom: spacing.sm },
  gateMessage: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  sampleCard: {
    backgroundColor: colors.amberLight,
    marginBottom: spacing.lg,
  },
  sampleText: { ...typography.bodySmall, color: colors.warning },
  walkthroughCard: {
    marginBottom: spacing.lg,
  },
  walkthroughTitle: { ...typography.body, fontWeight: '600' },
  walkthroughText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  walkthroughButton: { marginTop: spacing.md },
  verifyCard: {
    backgroundColor: colors.amberLight,
    marginBottom: spacing.lg,
  },
  verifyTitle: { ...typography.body, fontWeight: '600', color: colors.warning, marginBottom: spacing.xs },
  verifyText: { ...typography.bodySmall, color: colors.textSecondary },
  ambulanceCard: { marginTop: spacing.lg },
  ambulanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ambulanceIcon: { fontSize: 26 },
  ambulanceInfo: { flex: 1 },
  ambulanceName: { ...typography.body, fontWeight: '600' },
  ambulanceMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  toggleCard: {
    marginBottom: spacing.lg,
  },
  toggleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  toggleTitle: {
    ...typography.h3,
    color: colors.text,
  },
  toggleSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  statusCard: {
    marginBottom: spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusLeft: {
    flex: 1,
  },
  statusLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  statusValue: {
    ...typography.h2,
    color: colors.text,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.text,
    marginBottom: spacing.md,
  },
  earningsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  earningsCard: {
    flex: 1,
    alignItems: 'center',
  },
  earningsLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  earningsValue: {
    ...typography.h3,
    color: colors.primary,
    marginTop: spacing.xs,
  },
  earningsSubtext: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: 2,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  quickActionCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickActionIcon: {
    fontSize: 28,
    marginBottom: spacing.sm,
  },
  quickActionLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.text,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    position: 'relative',
  },
  bottomNavIcon: {
    fontSize: 20,
  },
  bottomNavLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  bottomNavLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: 16,
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeDotText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: '700',
  },
});

export default DriverHomeScreen;
