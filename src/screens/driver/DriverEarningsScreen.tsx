import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Header, EmptyState } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { driversService, bookingsService, isSupabaseConfigured } from '../../services/database';
import { Booking } from '../../types';

interface TripHistoryItem {
  id: string;
  date: string;
  pickup: string;
  destination: string;
  fare: number;
  distance: number;
  duration: number;
  rating: number;
}

// Development sample history — only shown when Supabase is not configured
// (clearly labelled in the UI).
const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

const SAMPLE_TRIPS: TripHistoryItem[] = [
  {
    id: 't1',
    date: daysAgo(0),
    pickup: 'Thamel, Kathmandu',
    destination: 'Norvic International Hospital',
    fare: 2500,
    distance: 4.2,
    duration: 18,
    rating: 5,
  },
  {
    id: 't2',
    date: daysAgo(0),
    pickup: 'Boudha, Kathmandu',
    destination: 'Grande International Hospital',
    fare: 1200,
    distance: 6.5,
    duration: 25,
    rating: 4,
  },
  {
    id: 't3',
    date: daysAgo(1),
    pickup: 'Lazimpat, Kathmandu',
    destination: 'Medicare Hospital',
    fare: 1800,
    distance: 3.8,
    duration: 15,
    rating: 5,
  },
];

const DriverEarningsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [usingSampleData, setUsingSampleData] = useState(false);

  const [todayEarnings, setTodayEarnings] = useState(0);
  const [weeklyEarnings, setWeeklyEarnings] = useState(0);
  const [monthlyEarnings, setMonthlyEarnings] = useState(0);

  const [tripHistory, setTripHistory] = useState<TripHistoryItem[]>([]);

  useEffect(() => {
    loadEarnings();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildHistory(bookings: Booking[]): TripHistoryItem[] {
    return bookings.map((b) => ({
      id: b.id,
      date: b.created_at,
      pickup: b.pickup_address,
      destination: b.destination_address,
      fare: Number(b.final_fare ?? b.estimated_fare ?? 0),
      distance: Number(b.distance_km ?? 0),
      duration: b.duration_min ?? 0,
      rating: 0,
    }));
  }

  async function loadEarnings() {
    setLoading(true);
    setError(null);
    try {
      if (!isSupabaseConfigured) {
        setUsingSampleData(true);
        setTodayEarnings(4250);
        setWeeklyEarnings(28750);
        setMonthlyEarnings(98500);
        setTripHistory(SAMPLE_TRIPS);
        return;
      }

      setUsingSampleData(false);
      const userId = user?.id;
      if (!userId) {
        setTripHistory([]);
        return;
      }

      const driver = await driversService.getByUserId(userId);
      if (!driver) {
        setTripHistory([]);
        return;
      }

      const bookings = await bookingsService.getByDriver(driver.id);
      const completed = bookings.filter((b) => b.status === 'completed');
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(startOfDay);
      startOfWeek.setDate(startOfWeek.getDate() - 6);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const sumSince = (since: Date) =>
        completed
          .filter((b) => new Date(b.created_at) >= since)
          .reduce((sum, b) => sum + Number(b.final_fare ?? b.estimated_fare ?? 0), 0);

      setTodayEarnings(sumSince(startOfDay));
      setWeeklyEarnings(sumSince(startOfWeek));
      setMonthlyEarnings(sumSince(startOfMonth));
      setTripHistory(buildHistory(completed));
    } catch {
      setError('Failed to load earnings. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const handleWithdraw = async () => {
    setWithdrawing(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      Alert.alert(
        'Withdrawals',
        'Payouts require a payout provider and server-side verification, which are not part of this build. Your earnings remain recorded against your driver account.',
      );
    } finally {
      setWithdrawing(false);
    }
  };

  const getCurrentEarnings = () => {
    switch (period) {
      case 'today':
        return todayEarnings;
      case 'week':
        return weeklyEarnings;
      case 'month':
        return monthlyEarnings;
    }
  };

  const getPeriodStart = () => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'today') return startOfDay;
    if (period === 'week') {
      const startOfWeek = new Date(startOfDay);
      startOfWeek.setDate(startOfWeek.getDate() - 6);
      return startOfWeek;
    }
    return new Date(now.getFullYear(), now.getMonth(), 1);
  };

  const getTripCount = () =>
    tripHistory.filter((t) => new Date(t.date) >= getPeriodStart()).length;

  const getAverageFare = () => {
    const inPeriod = tripHistory.filter((t) => new Date(t.date) >= getPeriodStart());
    if (inPeriod.length === 0) return 0;
    return Math.round(
      inPeriod.reduce((sum, t) => sum + t.fare, 0) / inPeriod.length,
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Earnings" showBack onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading earnings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Earnings" showBack onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Retry" variant="outline" onPress={loadEarnings} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Earnings" showBack onBack={() => navigation.goBack()} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {usingSampleData && (
          <Card elevation="sm" style={styles.sampleCard}>
            <Text style={styles.sampleText}>
              ⚠️ Sample mode — database not configured. Showing example earnings.
            </Text>
          </Card>
        )}

        {/* Today's Earnings Card */}
        <Card elevation="md" style={styles.todayCard}>
          <Text style={styles.todayLabel}>Today&apos;s Earnings</Text>
          <Text style={styles.todayAmount}>NPR {todayEarnings.toLocaleString('en-IN')}</Text>
          <View style={styles.todayStats}>
            <View style={styles.todayStatItem}>
              <Text style={styles.todayStatValue}>
                {tripHistory.filter((t) => new Date(t.date).toDateString() === new Date().toDateString()).length}
              </Text>
              <Text style={styles.todayStatLabel}>Trips</Text>
            </View>
            <View style={styles.todayStatDivider} />
            <View style={styles.todayStatItem}>
              <Text style={styles.todayStatValue}>
                {tripHistory
                  .filter((t) => new Date(t.date).toDateString() === new Date().toDateString())
                  .reduce((sum, t) => sum + t.distance, 0)
                  .toFixed(1)} km
              </Text>
              <Text style={styles.todayStatLabel}>Distance</Text>
            </View>
            <View style={styles.todayStatDivider} />
            <View style={styles.todayStatItem}>
              <Text style={styles.todayStatValue}>
                {(() => {
                  // Ratings arrive once passengers rate completed trips.
                  const rated = tripHistory.filter((t) => t.rating > 0);
                  if (rated.length === 0) return '—';
                  return `★ ${(rated.reduce((sum, t) => sum + t.rating, 0) / rated.length).toFixed(1)}`;
                })()}
              </Text>
              <Text style={styles.todayStatLabel}>Rating</Text>
            </View>
          </View>
        </Card>

        {/* Period Selector */}
        <View style={styles.periodSelector}>
          {(['today', 'week', 'month'] as const).map((p) => (
            <TouchableOpacity
              key={p}
              style={[
                styles.periodButton,
                period === p && styles.periodButtonActive,
              ]}
              onPress={() => setPeriod(p)}
            >
              <Text
                style={[
                  styles.periodButtonText,
                  period === p && styles.periodButtonTextActive,
                ]}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Period Summary */}
        <Card elevation="sm" style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>
            {period === 'today' ? "Today's Summary" : period === 'week' ? 'Weekly Summary' : 'Monthly Summary'}
          </Text>
          <Text style={styles.summaryAmount}>NPR {getCurrentEarnings().toLocaleString()}</Text>
          <View style={styles.summaryStats}>
            <View style={styles.summaryStatItem}>
              <Text style={styles.summaryStatLabel}>Total Trips</Text>
              <Text style={styles.summaryStatValue}>{getTripCount()}</Text>
            </View>
            <View style={styles.summaryStatItem}>
              <Text style={styles.summaryStatLabel}>Avg. Fare</Text>
              <Text style={styles.summaryStatValue}>
                NPR {getAverageFare().toLocaleString('en-IN')}
              </Text>
            </View>
          </View>
        </Card>

        {/* Withdraw Button */}
        <Button
          title="Withdraw Earnings"
          fullWidth
          size="lg"
          onPress={handleWithdraw}
          loading={withdrawing}
          disabled={withdrawing}
          style={styles.withdrawButton}
        />

        {/* Trip History */}
        <Text style={styles.sectionTitle}>Trip History</Text>
        {tripHistory.length === 0 ? (
          <EmptyState
            icon="🚗"
            title="No Trips Yet"
            message="Your completed trips will appear here."
          />
        ) : (
          tripHistory.map((trip) => (
            <Card key={trip.id} elevation="sm" style={styles.tripCard}>
              <View style={styles.tripHeader}>
                <Text style={styles.tripDate}>{formatDate(trip.date)}</Text>
                <Text style={styles.tripFare}>NPR {trip.fare.toLocaleString()}</Text>
              </View>
              <View style={styles.tripRoute}>
                <Text style={styles.tripLocation} numberOfLines={1}>
                  {trip.pickup}
                </Text>
                <Text style={styles.tripArrow}>→</Text>
                <Text style={styles.tripLocation} numberOfLines={1}>
                  {trip.destination}
                </Text>
              </View>
              <View style={styles.tripDetails}>
                <Text style={styles.tripDetail}>{trip.distance} km</Text>
                <Text style={styles.tripDetail}>•</Text>
                <Text style={styles.tripDetail}>{trip.duration} min</Text>
                <Text style={styles.tripDetail}>•</Text>
                <Text style={styles.tripRating}>★ {trip.rating}</Text>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
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
    padding: spacing.xxl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  sampleCard: {
    backgroundColor: colors.amberLight,
    marginBottom: spacing.lg,
  },
  sampleText: { ...typography.bodySmall, color: colors.warning },
  todayCard: {
    backgroundColor: colors.primary,
    marginBottom: spacing.lg,
  },
  todayLabel: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.9,
  },
  todayAmount: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.surface,
    marginTop: spacing.xs,
  },
  todayStats: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  todayStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  todayStatDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  todayStatValue: {
    ...typography.h4,
    color: colors.surface,
  },
  todayStar: {
    fontSize: 20,
    color: colors.warning,
  },
  todayStatLabel: {
    ...typography.caption,
    color: colors.surface,
    opacity: 0.8,
    marginTop: 2,
  },
  periodSelector: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: 4,
    marginBottom: spacing.lg,
  },
  periodButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radii.sm,
  },
  periodButtonActive: {
    backgroundColor: colors.primary,
  },
  periodButtonText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  periodButtonTextActive: {
    color: colors.surface,
  },
  summaryCard: {
    marginBottom: spacing.lg,
  },
  summaryTitle: {
    ...typography.h4,
    color: colors.text,
  },
  summaryAmount: {
    ...typography.h1,
    color: colors.primary,
    marginTop: spacing.xs,
  },
  summaryStats: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  summaryStatItem: {
    flex: 1,
  },
  summaryStatLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  summaryStatValue: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  withdrawButton: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.text,
    marginBottom: spacing.md,
  },
  tripCard: {
    marginBottom: spacing.md,
  },
  tripHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  tripDate: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  tripFare: {
    ...typography.body,
    fontWeight: '700',
    color: colors.primary,
  },
  tripRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  tripLocation: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.text,
  },
  tripArrow: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    marginHorizontal: spacing.sm,
  },
  tripDetails: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tripDetail: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  tripRating: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '600',
  },
});

export default DriverEarningsScreen;
