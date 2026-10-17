import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Badge, Button, EmptyState } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { bookingsService } from '../../services/database/bookings';
import { isSupabaseConfigured } from '../../services/database/client';
import { useAuthStore } from '../../store/authStore';
import { Booking, BookingStatus } from '../../types';

type TabKey = 'ongoing' | 'completed' | 'canceled' | 'topup';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'completed', label: 'Completed' },
  { key: 'canceled', label: 'Canceled' },
  { key: 'topup', label: 'Top Up' },
];

const MOCK_BOOKINGS: Booking[] = [
  {
    id: '1',
    user_id: 'user1',
    driver_id: 'driver1',
    ambulance_id: 'amb1',
    category: 'basic',
    pickup_address: 'Thamel, Kathmandu',
    pickup_lat: 27.7172,
    pickup_lng: 85.324,
    destination_address: 'Grande International Hospital, Dhapasi',
    dest_lat: 27.7389,
    dest_lng: 85.3356,
    status: 'started',
    emergency_level: 'medium',
    estimated_fare: 350,
    distance_km: 8.5,
    duration_min: 24,
    payment_method: 'wallet',
    created_at: '2026-10-17T10:30:00Z',
    updated_at: '2026-10-17T10:30:00Z',
  },
  {
    id: '2',
    user_id: 'user1',
    driver_id: 'driver2',
    ambulance_id: 'amb2',
    category: 'icu',
    pickup_address: 'Baneshwor, Kathmandu',
    pickup_lat: 27.6939,
    pickup_lng: 85.3386,
    destination_address: 'Norvic Hospital, Thapathali',
    dest_lat: 27.6967,
    dest_lng: 85.3147,
    status: 'completed',
    emergency_level: 'high',
    estimated_fare: 850,
    final_fare: 820,
    distance_km: 12.3,
    duration_min: 35,
    payment_method: 'card',
    created_at: '2026-10-16T14:20:00Z',
    updated_at: '2026-10-16T15:00:00Z',
  },
  {
    id: '3',
    user_id: 'user1',
    driver_id: 'driver3',
    ambulance_id: 'amb3',
    category: 'basic',
    pickup_address: 'Kupondole, Lalitpur',
    pickup_lat: 27.6789,
    pickup_lng: 85.3256,
    destination_address: 'Patan Hospital, Patan',
    dest_lat: 27.6689,
    dest_lng: 85.3247,
    status: 'cancelled',
    emergency_level: 'low',
    estimated_fare: 280,
    distance_km: 5.2,
    duration_min: 15,
    payment_method: 'cash',
    created_at: '2026-10-15T09:00:00Z',
    updated_at: '2026-10-15T09:05:00Z',
  },
];

const TOPUP_HISTORY = [
  { id: 't1', amount: 500, date: '2026-10-10', method: 'eSewa' },
  { id: 't2', amount: 1000, date: '2026-10-05', method: 'Khalti' },
  { id: 't3', amount: 250, date: '2026-09-28', method: 'Card' },
];

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
      if (!isSupabaseConfigured || !userId) {
        // No database (or signed-out state) — clearly-labelled sample list.
        setUsingSampleData(true);
        setBookings(MOCK_BOOKINGS);
        setError(null);
        return;
      }

      setUsingSampleData(false);
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
      case 'started':
      case 'arriving':
      case 'arrived':
        return <Badge label="Ongoing" variant="info" />;
      case 'completed':
        return <Badge label="Completed" variant="success" />;
      case 'cancelled':
        return <Badge label="Canceled" variant="error" />;
      default:
        return <Badge label={status} variant="neutral" />;
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const filteredBookings = bookings.filter((b) => {
    if (activeTab === 'ongoing') return ['started', 'arriving', 'arrived', 'assigned', 'pending'].includes(b.status);
    if (activeTab === 'completed') return b.status === 'completed';
    if (activeTab === 'canceled') return b.status === 'cancelled';
    return false;
  });

  const renderTripCard = ({ item }: { item: Booking }) => (
    <Card elevation="sm" style={styles.tripCard}>
      <View style={styles.tripHeader}>
        <Text style={styles.ambulanceIcon}>🚑</Text>
        <View style={styles.tripInfo}>
          <Text style={styles.destination} numberOfLines={1}>
            {item.destination_address}
          </Text>
          <Text style={styles.dateTime}>
            {formatDate(item.created_at)} • {formatTime(item.created_at)}
          </Text>
        </View>
        {getStatusBadge(item.status)}
      </View>
      <View style={styles.tripFooter}>
        <Text style={styles.price}>
          NPR {item.final_fare || item.estimated_fare || '---'}
        </Text>
        {item.status === 'started' && (
          <Button
            title="Track Driver"
            size="sm"
            onPress={() => navigation.navigate('TripTracking', { bookingId: item.id })}
          />
        )}
        {item.status === 'completed' && (
          <Button
            title="Share Receipt"
            size="sm"
            variant="outline"
            onPress={() => navigation.navigate('ShareReceipt')}
          />
        )}
      </View>
    </Card>
  );

  const renderTopUpCard = ({ item }: { item: typeof TOPUP_HISTORY[0] }) => (
    <Card elevation="sm" style={styles.tripCard}>
      <View style={styles.tripHeader}>
        <Text style={styles.ambulanceIcon}>💰</Text>
        <View style={styles.tripInfo}>
          <Text style={styles.destination}>Wallet Top Up</Text>
          <Text style={styles.dateTime}>
            {formatDate(item.date)} • {item.method}
          </Text>
        </View>
        <Badge label="Demo" variant="info" />
      </View>
      <View style={styles.tripFooter}>
        <Text style={styles.price}>NPR {item.amount}</Text>
      </View>
    </Card>
  );

  const renderEmptyState = () => {
    const emptyConfig: Record<TabKey, { icon: string; title: string; message: string }> = {
      ongoing: { icon: '🚑', title: 'No Ongoing Trips', message: 'You have no active trips at the moment.' },
      completed: { icon: '✅', title: 'No Completed Trips', message: 'Your completed trips will appear here.' },
      canceled: { icon: '❌', title: 'No Canceled Trips', message: 'Your canceled trips will appear here.' },
      topup: { icon: '💰', title: 'No Top Up History', message: 'Your wallet top-ups will appear here.' },
    };
    const config = emptyConfig[activeTab];
    return <EmptyState icon={config.icon} title={config.title} message={config.message} />;
  };

  const renderNotices = () => (
    <>
      {usingSampleData && (
        <View style={styles.sampleBanner}>
          <Text style={styles.sampleBannerText}>
            ⚠️ Sample mode — database not configured. Showing example bookings.
          </Text>
        </View>
      )}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}
    </>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading activity...</Text>
        </View>
      );
    }

    if (activeTab === 'topup') {
      return (
        <FlatList
          data={TOPUP_HISTORY}
          renderItem={renderTopUpCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          ListHeaderComponent={() => (
            <>
              {renderNotices()}
              <View style={styles.sampleBanner}>
                <Text style={styles.sampleBannerText}>
                  ⚠️ Demo data — wallet top-ups shown here are examples. No real payments are
                  collected or stored in this build.
                </Text>
              </View>
            </>
          )}
          ListEmptyComponent={renderEmptyState}
          showsVerticalScrollIndicator={false}
        />
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
        <Text style={styles.headerTitle}>Activity</Text>
        <TouchableOpacity style={styles.menuButton}>
          <Text style={styles.menuIcon}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.activeTab]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.tabText, activeTab === tab.key && styles.activeTabText]}
            >
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { ...typography.h2 },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: { fontSize: 24, color: colors.text },

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

  listContent: { padding: spacing.md, flexGrow: 1 },
  sampleBanner: {
    backgroundColor: colors.amberLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  sampleBannerText: { ...typography.bodySmall, color: colors.warning },
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
  destination: { ...typography.body, fontWeight: '600' },
  dateTime: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  tripFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  price: { ...typography.h4, color: colors.primary },
});

export default ActivityScreen;
