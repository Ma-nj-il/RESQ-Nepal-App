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
import { Button, Card,  Toggle } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { Driver, Ambulance} from '../../types';
import { driversService, bookingsService, ambulancesService, isSupabaseConfigured } from '../../services/database';

type TabKey = 'home' | 'requests' | 'earnings' | 'profile';

// Development sample shown ONLY when Supabase is not configured, so the
// driver-mode UI is reviewable without a database. It is clearly labelled
// in the interface and is never presented as live data.
const SAMPLE_DRIVER: Driver = {
  id: 'sample-driver',
  user_id: 'sample-user',
  license_number: 'DL-2024-78542',
  license_expiry: '2027-06-15',
  status: 'verified',
  rating: 4.8,
  total_rides: 1247,
  verified_at: '2024-01-15',
  created_at: '2024-01-10',
};

const SAMPLE_AMBULANCE: Ambulance = {
  id: 'sample-ambulance',
  driver_id: 'sample-driver',
  category: 'icu',
  plate_number: 'BA 2 PA 4521',
  model: 'Force Traveller Ambulance',
  color: 'White',
  status: 'available',
  equipment: ['Oxygen', 'Stretcher', 'Ventilator', 'Defibrillator', 'First Aid Kit'],
  hospital_affiliation: 'Norvic International Hospital',
  created_at: '2024-01-12',
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

  useEffect(() => {
    loadDriverData();
    // Load exactly once on mount — loadDriverData reads fresh state internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDriverData() {
    setLoading(true);
    setError(null);
    try {
      if (!isSupabaseConfigured) {
        // No database configured — show clearly-labelled sample mode.
        setUsingSampleData(true);
        setDriver(SAMPLE_DRIVER);
        setAmbulance(SAMPLE_AMBULANCE);
        setIncomingCount(3);
        setTodayEarnings(4250);
        setTodayTrips(12);
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
            {tab.key === 'requests' && incomingCount > 0 && (
              <View style={styles.badgeDot}>
                <Text style={styles.badgeDotText}>{incomingCount}</Text>
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
        <View style={styles.driverBadge}>
          <Text style={styles.driverBadgeText}>🚨 Driver Mode</Text>
        </View>
        <View style={styles.onlineIndicator}>
          <View
            style={[
              styles.onlineDot,
              { backgroundColor: isOnline ? colors.success : colors.offline },
            ]}
          />
        </View>
      </View>

      {/* Map Placeholder */}
      <View style={styles.mapContainer}>
        <View style={styles.mapPlaceholder}>
          <Text style={styles.mapIcon}>🗺️</Text>
          <Text style={styles.mapText}>Map View</Text>
          <Text style={styles.mapSubtext}>
            {isOnline ? 'Showing nearby requests...' : 'Go online to see requests'}
          </Text>
        </View>
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
              ⚠️ Sample mode — database not configured. Showing example driver data. Add Supabase
              credentials in .env to load real records.
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
              {isOnline ? "You're Online" : "You're Offline"}
            </Text>
            <Toggle value={isOnline} onValueChange={handleOnlineChange} />
          </View>
          <Text style={styles.toggleSubtitle}>
            {isOnline
              ? 'You will receive booking requests from nearby patients.'
              : 'Go online to start receiving booking requests.'}
          </Text>
        </Card>

        {/* Online Status Card */}
        {isOnline ? (
          <Card elevation="sm" style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={styles.statusLeft}>
                <Text style={styles.statusLabel}>Incoming Requests</Text>
                <Text style={styles.statusValue}>{incomingCount}</Text>
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

        {/* Earnings Summary */}
        <Text style={styles.sectionTitle}>Today&apos;s Summary</Text>
        <View style={styles.earningsGrid}>
          <Card elevation="sm" style={styles.earningsCard}>
            <Text style={styles.earningsLabel}>Earnings</Text>
            <Text style={styles.earningsValue}>
              NPR {todayEarnings.toLocaleString('en-IN')}
            </Text>
            <Text style={styles.earningsSubtext}>from completed trips</Text>
          </Card>
          <Card elevation="sm" style={styles.earningsCard}>
            <Text style={styles.earningsLabel}>Trips</Text>
            <Text style={styles.earningsValue}>{todayTrips}</Text>
            <Text style={styles.earningsSubtext}>completed today</Text>
          </Card>
          <Card elevation="sm" style={styles.earningsCard}>
            <Text style={styles.earningsLabel}>Rating</Text>
            <Text style={styles.earningsValue}>★ {driver?.rating ?? 0}</Text>
            <Text style={styles.earningsSubtext}>
              {(driver?.total_rides ?? 0).toLocaleString('en-IN')} rides
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
  mapPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapIcon: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  mapText: {
    ...typography.h3,
    color: colors.text,
  },
  mapSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
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
