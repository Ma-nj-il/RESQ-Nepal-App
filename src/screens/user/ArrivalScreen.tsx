import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card } from '../../components/ui';
import { MapCanvas } from '../../components/map/MapCanvas';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { useBookingStore } from '../../store/bookingStore';
import { bookingsService } from '../../services/database/bookings';
import { isSupabaseConfigured } from '../../services/database/client';
import { isDemoMode } from '../../utils/demoMode';
import { Booking } from '../../types';

type RouteParams = {
  Arrival: { bookingId?: string; booking?: Booking };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ArrivalScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'Arrival'>>();
  const bookingId = route.params?.bookingId;
  const paramBooking = route.params?.booking;
  const { setBookingStatus } = useBookingStore();

  const demoRun = isDemoMode();
  const canPersist = Boolean(
    bookingId && UUID_RE.test(bookingId) && isSupabaseConfigured && !demoRun,
  );
  const canFetch = Boolean(!paramBooking && canPersist && bookingId);

  const [booking, setBooking] = useState<Booking | null>(paramBooking ?? null);
  const [loading, setLoading] = useState(canFetch);
  const [error, setError] = useState<string | null>(
    !paramBooking && !canFetch ? 'No trip summary is available for this booking.' : null,
  );
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!canFetch || !bookingId) return;
    let active = true;
    (async () => {
      try {
        const data = await bookingsService.getById(bookingId);
        if (!active) return;
        if (data) {
          setBooking(data);
          setError(null);
        } else {
          setError('Booking not found');
        }
      } catch {
        if (active) setError('Failed to load trip details');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [bookingId, canFetch]);

  const handleComplete = async () => {
    // Completing a trip is a database write. It only happens against a real
    // booking row — demo/sample walkthroughs never touch the database.
    if (!canPersist || !bookingId) {
      setBookingStatus('completed');
      navigation.navigate('Rating', { bookingId, booking: booking ?? undefined });
      return;
    }
    try {
      setFinishing(true);
      await bookingsService.updateStatus(bookingId, 'completed');
      setBookingStatus('completed');
      navigation.navigate('Rating', { bookingId });
    } catch {
      setError('Could not mark the trip as completed. Check your connection and try again.');
      setFinishing(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading trip summary…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !booking) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{error || 'Something went wrong'}</Text>
          <Button title="Go Back" onPress={() => navigation.goBack()} variant="outline" style={{ marginTop: spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  // Only recorded values are shown — nothing is estimated here.
  const duration = booking.duration_min != null ? Number(booking.duration_min) : null;
  const distance = booking.distance_km != null ? Number(booking.distance_km) : null;
  const avgSpeed =
    duration !== null && distance !== null && duration > 0
      ? Math.round((distance / (duration / 60)) * 10) / 10
      : null;

  const pickupPoint =
    booking.pickup_lat != null && booking.pickup_lng != null
      ? { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) }
      : null;
  const destPoint =
    booking.dest_lat != null && booking.dest_lng != null
      ? { lat: Number(booking.dest_lat), lng: Number(booking.dest_lng) }
      : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Completed route */}
        <View style={styles.mapContainer}>
          <MapCanvas
            pickup={pickupPoint}
            destination={destPoint}
            caption="Completed trip — straight-line preview"
            pickupLabel={booking.pickup_address}
            destinationLabel={booking.destination_address}
          />
        </View>

        {/* Arrival Content */}
        <View style={styles.content}>
          <View style={styles.pinContainer}>
            <Text style={styles.redPin}>📍</Text>
          </View>

          <Text style={styles.heading}>You have arrived</Text>
          <Text style={styles.destinationName}>{booking.destination_address.split(',')[0]}</Text>
          <Text style={styles.destinationAddress}>{booking.destination_address}</Text>

          {/* Trip Stats — recorded values only */}
          <Card elevation="md" style={styles.statsCard}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{duration !== null ? `${Math.round(duration)}` : '—'}</Text>
                <Text style={styles.statLabel}>Duration (min)</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{distance !== null ? distance.toFixed(1) : '—'}</Text>
                <Text style={styles.statLabel}>Distance (km)</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{avgSpeed !== null ? `${avgSpeed}` : '—'}</Text>
                <Text style={styles.statLabel}>Avg speed (km/h)</Text>
              </View>
            </View>
            {(duration === null || distance === null) && (
              <Text style={styles.statsNote}>
                Values marked “—” were not recorded for this trip.
              </Text>
            )}
          </Card>

          {(!canPersist || demoRun) && (
            <Text style={styles.noticeText}>
              {demoRun
                ? 'Demo mode — nothing was saved for this trip.'
                : 'Sample mode — this summary is not stored.'}
            </Text>
          )}

          <Button
            title={canPersist ? 'Complete trip & rate' : 'Rate this trip'}
            onPress={handleComplete}
            fullWidth
            size="lg"
            loading={finishing}
            style={styles.finishButton}
          />
          <Button
            title="Back to trips"
            onPress={() => navigation.popTo('Activity')}
            variant="ghost"
            fullWidth
            style={styles.skipButton}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center' },

  mapContainer: { height: 260, overflow: 'hidden' },

  content: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    marginTop: -spacing.xl,
    padding: spacing.xxl,
    alignItems: 'center',
  },
  pinContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.redLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    marginTop: -spacing.xxxl - spacing.lg,
  },
  redPin: { fontSize: 32 },
  heading: { ...typography.h1, textAlign: 'center', marginBottom: spacing.sm },
  destinationName: { ...typography.h3, textAlign: 'center', marginBottom: spacing.xs },
  destinationAddress: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },

  statsCard: { width: '100%', marginBottom: spacing.xl },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { ...typography.h2, color: colors.primary },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
  statDivider: { width: 1, height: 40, backgroundColor: colors.border },
  statsNote: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.md, textAlign: 'center' },

  noticeText: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  finishButton: { marginTop: spacing.sm },
  skipButton: { marginTop: spacing.sm },
});

export default ArrivalScreen;
