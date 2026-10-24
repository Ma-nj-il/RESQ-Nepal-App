import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Badge, EmptyState } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { bookingsService } from '../../services/database/bookings';
import { isSupabaseConfigured } from '../../services/database/client';
import { useAuthStore } from '../../store/authStore';
import { isDemoMode } from '../../utils/demoMode';
import { SAMPLE_BOOKINGS } from '../../constants/demoSamples';
import { Booking, BookingStatus } from '../../types';

type TabKey = 'ongoing' | 'completed' | 'canceled';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'completed', label: 'Completed' },
  { key: 'canceled', label: 'Canceled' },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ActivityScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { user } = useAuthStore();

  const [activeTab, setActiveTab] = useState<TabKey>('ongoing');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingSampleData, setUsingSampleData] = useState(false);

  const userId = user?.id;

  const loadBookings = useCallback(async () => {
    try {
      if (isDemoMode() || !isSupabaseConfigured) {
        setUsingSampleData(true);
        setBookings(SAMPLE_BOOKINGS);
        setError(null);
        return;
      }

      setUsingSampleData(false);
      if (!userId || !UUID_RE.test(userId)) {
        setBookings([]);
        setError('Sign in to view your trip history.');
        return;
      }
      const data = await bookingsService.getByUser(userId);
      setError(null);
      setBookings(data);
    } catch {
      setError('Could not load your bookings. Pull to refresh to try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadBookings();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadBookings]);

  const onRefresh = () => {
    setRefreshing(true);
    loadBookings();
  };

  const getStatusBadge = (status: BookingStatus) => {
    switch (status) {
      case 'pending':
      case 'assigned':
      case 'started':
      case 'arriving':
      case 'arrived':
        return <Badge label="Ongoing" variant="info" />;
      case 'completed':
        return <Badge label="Completed" variant="success" />;
      case 'cancelled':
      case 'rejected':
        return <Badge label="Canceled" variant="error" />;
      default:
        return <Badge label={status} variant="neutral" />;
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (!dateStr || !Number.isFinite(date.getTime())) return 'Date not recorded';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    if (!dateStr || !Number.isFinite(date.getTime())) return '';
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatCategory = (category: Booking['category']) =>
    category === 'icu' ? 'ICU / Emergency Ambulance' : 'Basic Patient Delivery';

  const formatFare = (booking: Booking) => {
    const fare = booking.final_fare ?? booking.estimated_fare;
    if (fare === null || fare === undefined) return 'Fare pending';
    const amount = Number(fare);
    return Number.isFinite(amount) ? `NPR ${amount.toLocaleString('en-IN')}` : 'Fare pending';
  };

  const openTrip = (item: Booking) => {
    if (usingSampleData) {
      navigation.navigate('TripTracking', { booking: item, bookingId: item.id });
    } else {
      navigation.navigate('TripTracking', { bookingId: item.id });
    }
  };

  const filteredBookings = bookings.filter((b) => {
    if (activeTab === 'ongoing')
      return ['started', 'arriving', 'arrived', 'assigned', 'pending'].includes(b.status);
    if (activeTab === 'completed') return b.status === 'completed';
    if (activeTab === 'canceled') return ['cancelled', 'rejected'].includes(b.status);
    return false;
  });

  const renderTripCard = ({ item }: { item: Booking }) => (
    <TouchableOpacity activeOpacity={0.85} onPress={() => openTrip(item)} accessibilityRole="button">
      <Card elevation="sm" style={styles.tripCard}>
        <View style={styles.tripHeader}>
          <Text style={styles.ambulanceIcon}>🚑</Text>
          <View style={styles.tripInfo}>
            <Text style={styles.dateTime}>
              {formatDate(item.created_at)}
              {formatTime(item.created_at) ? ` · ${formatTime(item.created_at)}` : ''}
            </Text>
            <Text style={styles.category}>{formatCategory(item.category)}</Text>
          </View>
          {getStatusBadge(item.status)}
        </View>

        {/* Pickup → destination */}
        <View style={styles.routeBlock}>
          <View style={styles.rail}>
            <View style={[styles.dot, styles.dotPickup]} />
            <View style={styles.railLine} />
            <View style={[styles.dot, styles.dotDest]} />
          </View>
          <View style={styles.routeFields}>
            <Text style={styles.routeValue} numberOfLines={1}>
              {item.pickup_address || 'Pickup not recorded'}
            </Text>
            <Text style={[styles.routeValue, styles.routeValueDest]} numberOfLines={1}>
              {item.destination_address || 'Destination not recorded'}
            </Text>
          </View>
        </View>

        <View style={styles.tripFooter}>
          <View>
            <Text style={styles.fareLabel}>
              {item.final_fare != null ? 'Final fare' : item.estimated_fare != null ? 'Indicative fare' : 'Fare'}
            </Text>
            <Text style={styles.price}>{formatFare(item)}</Text>
          </View>
          <View style={styles.footerActions}>
            {item.payment_method ? (
              <Text style={styles.paymentTag}>{item.payment_method.toUpperCase()}</Text>
            ) : null}
            <Text style={styles.chevron}>›</Text>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );

  const renderEmptyState = () => {
    const emptyConfig: Record<TabKey, { icon: string; title: string; message: string }> = {
      ongoing: { icon: '🚑', title: 'No ongoing trips', message: 'Active trips appear here while an ambulance is on the way.' },
      completed: { icon: '✅', title: 'No completed trips', message: 'Your completed trips will appear here.' },
      canceled: { icon: '❌', title: 'No canceled trips', message: 'Trips you cancel will appear here.' },
    };
    const config = emptyConfig[activeTab];
    const hasNoHistory = bookings.length === 0;
    return (
      <EmptyState
        icon={config.icon}
        title={hasNoHistory ? 'No trip history yet' : config.title}
        message={
          hasNoHistory
            ? 'Your ambulance bookings will appear here once you request a trip.'
            : config.message
        }
        action={
          hasNoHistory ? (
            <Button
              title="Return to Home"
              onPress={() => navigation.navigate('Home')}
              style={styles.homeButton}
            />
          ) : undefined
        }
      />
    );
  };

  const renderNotices = () => (
    <>
      {usingSampleData && (
        <Text style={styles.demoNote}>
          {isDemoMode()
            ? 'Demo mode — sample trips, not your real history.'
            : 'Sample mode — database not configured. Showing example bookings.'}
        </Text>
      )}
    </>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading your trips…</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.errorState}>
          <Text style={styles.errorTitle}>Trip history unavailable</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <Button
            title="Try again"
            onPress={() => {
              setRefreshing(true);
              void loadBookings();
            }}
            loading={refreshing}
          />
          <Button
            title="Return to Home"
            variant="ghost"
            onPress={() => navigation.navigate('Home')}
            style={styles.homeButton}
          />
        </View>
      );
    }

    return (
      <FlatList
        data={filteredBookings}
        renderItem={renderTripCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        ListHeaderComponent={renderNotices}
        ListEmptyComponent={renderEmptyState}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Trips History</Text>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.activeTab]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.key }}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.activeTabText]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <View style={styles.content}>{renderContent()}</View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.md,
  },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h2 },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: { borderBottomColor: colors.primary },
  tabText: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '500' },
  activeTabText: { color: colors.primary, fontWeight: '700' },

  content: { flex: 1 },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  errorTitle: { ...typography.h3, color: colors.text, textAlign: 'center' },
  errorMessage: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  homeButton: { marginTop: spacing.sm },

  // Bottom padding keeps the last trip card clear of the fixed tab bar.
  listContent: { padding: spacing.md, paddingBottom: spacing.xxxl, flexGrow: 1 },
  demoNote: {
    ...typography.caption,
    color: colors.textTertiary,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  errorBanner: {
    backgroundColor: colors.redLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  errorBannerText: { ...typography.bodySmall, color: colors.error },

  tripCard: { marginBottom: spacing.md },
  tripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  ambulanceIcon: { fontSize: 24 },
  tripInfo: { flex: 1 },
  dateTime: { ...typography.caption, color: colors.textSecondary },
  category: { ...typography.caption, color: colors.text, fontWeight: '600', marginTop: 2 },

  routeBlock: { flexDirection: 'row', marginBottom: spacing.md },
  rail: { alignItems: 'center', width: 16, paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotPickup: { backgroundColor: colors.success },
  dotDest: { backgroundColor: colors.primary },
  railLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  routeFields: { flex: 1, marginLeft: spacing.sm, justifyContent: 'space-between' },
  routeValue: { ...typography.body, color: colors.text, paddingVertical: 2 },
  routeValueDest: { color: colors.text, marginTop: spacing.sm },

  tripFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  fareLabel: { ...typography.caption, color: colors.textTertiary },
  price: { ...typography.h4, color: colors.text },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  paymentTag: {
    ...typography.caption,
    color: colors.textSecondary,
    backgroundColor: colors.input,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chevron: { fontSize: 22, color: colors.textTertiary },
});

export default ActivityScreen;
