import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Avatar, Badge } from '../../components/ui';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { useBookingStore } from '../../store/bookingStore';
import { bookingsService } from '../../services/database/bookings';
import { driversService } from '../../services/database/drivers';
import { profilesService } from '../../services/database/profiles';
import { supabase, isSupabaseConfigured } from '../../services/database/client';
import { estimateFare } from '../../constants/fares';
import { Booking } from '../../types';

type RouteParams = {
  TripTracking: { bookingId: string };
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting for a driver to accept',
  assigned: 'Driver assigned — preparing to depart',
  arriving: 'Ambulance is on the way',
  arrived: 'Ambulance has arrived at the pickup',
  started: 'Trip in progress',
  completed: 'Trip completed',
  cancelled: 'Trip cancelled',
  rejected: 'Trip was rejected',
  draft: 'Waiting to be confirmed',
};

const TripTrackingScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'TripTracking'>>();
  const { bookingId } = route.params;
  const { currentBooking } = useBookingStore();

  const [booking, setBooking] = useState<Booking | null>(currentBooking);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [driverName, setDriverName] = useState<string | null>(null);
  const [driverRating, setDriverRating] = useState<number | null>(null);
  const [vehicle, setVehicle] = useState<{ model?: string; plate_number?: string } | null>(null);

  const pulseAnim = useMemo(() => new Animated.Value(1), []);
  const routeAnim = useMemo(() => new Animated.Value(0.15), []);

  useEffect(() => {
    const loadBooking = async () => {
      try {
        setLoading(true);
        const data = await bookingsService.getById(bookingId);
        if (data) {
          setBooking(data);
        } else {
          setError('Booking not found');
        }
      } catch {
        setError('Failed to load trip details');
      } finally {
        setLoading(false);
      }
    };
    loadBooking();
  }, [bookingId]);

  // Decorative route progress: this is a preview animation because the app
  // does not receive live GPS updates from the driver in this build.
  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(routeAnim, {
        toValue: Math.min(0.9, (routeAnim as any)._value + 0.02),
        duration: 1000,
        useNativeDriver: false,
      }).start();
    }, 4000);
    return () => clearInterval(interval);
  }, [routeAnim]);

  // Pulse animation for the ambulance marker
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // Load the real driver's name and rating — never an invented person.
  useEffect(() => {
    const driverId = booking?.driver_id;
    if (!driverId || !isSupabaseConfigured) return;
    let active = true;
    (async () => {
      try {
        const driver = await driversService.getById(driverId);
        if (!driver || !active) return;
        setDriverRating(driver.rating > 0 ? driver.rating : null);
        try {
          const profile = await profilesService.getById(driver.user_id);
          if (active && profile?.full_name && profile.full_name.trim()) {
            setDriverName(profile.full_name.trim());
          }
        } catch {
          // Keep the generic label.
        }
      } catch {
        // Driver details unavailable — the bar stays minimal.
      }
    })();
    return () => {
      active = false;
    };
  }, [booking?.driver_id]);

  // Load the real vehicle assigned to this booking, when one is recorded.
  useEffect(() => {
    const ambulanceId = booking?.ambulance_id;
    if (!ambulanceId || !isSupabaseConfigured) return;
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('ambulances')
          .select('*')
          .eq('id', ambulanceId)
          .maybeSingle();
        if (active && data) {
          setVehicle(data as { model?: string; plate_number?: string });
        }
      } catch {
        // Vehicle details unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, [booking?.ambulance_id]);

  const handleCancel = () => {
    navigation.navigate('CancelRide', { bookingId });
  };

  const handleChat = () => {
    navigation.navigate('Chat', { bookingId });
  };

  const handleCall = () => {
    navigation.navigate('Call', { bookingId, type: 'voice' });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading trip details...</Text>
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

  const fareBreakdown = estimateFare(
    booking.category,
    booking.distance_km ? Number(booking.distance_km) : undefined
  );
  const totalFare = fareBreakdown.totalFare;
  const statusText = STATUS_TEXT[booking.status] ?? booking.status;
  const estimatedMinutes = booking.duration_min ? Number(booking.duration_min) : null;
  const distanceLabel = booking.distance_km ? `${Number(booking.distance_km).toFixed(1)} km` : 'Not recorded';

  return (
    <SafeAreaView style={styles.container}>
      {/* Map Placeholder */}
      <View style={styles.mapContainer}>
        <View style={styles.mapPlaceholder}>
          {/* Route line (preview illustration) */}
          <View style={styles.routeContainer}>
            <View style={styles.routeLine} />
            <Animated.View
              style={[
                styles.routeProgress,
                {
                  width: routeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
            {/* Pickup point */}
            <View style={[styles.mapPin, styles.pickupPin]}>
              <Text style={styles.pinIcon}>●</Text>
            </View>
            {/* Destination point */}
            <View style={[styles.mapPin, styles.destPin]}>
              <Text style={styles.pinIcon}>■</Text>
            </View>
            {/* Animated ambulance marker */}
            <Animated.View
              style={[
                styles.ambulanceMarker,
                {
                  left: routeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['10%', '80%'],
                  }),
                  transform: [{ scale: pulseAnim }],
                },
              ]}
            >
              <Text style={styles.ambulanceIcon}>🚑</Text>
            </Animated.View>
          </View>
          <Text style={styles.mapLabel}>
            {isSupabaseConfigured
              ? 'Route preview — live GPS tracking is not enabled in this build'
              : 'Sample preview — no live tracking'}
          </Text>
        </View>

        {/* Trip Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
          {estimatedMinutes !== null && (
            <Text style={styles.etaText}>
              Estimated trip time: about {Math.round(estimatedMinutes)} mins
            </Text>
          )}
        </View>

        {/* Driver Info Bar — only when a driver is actually assigned */}
        {booking.driver_id && (
          <View style={styles.driverBar}>
            <Avatar name={driverName ?? 'Driver'} size="sm" />
            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>{driverName ?? 'Driver'}</Text>
              <View style={styles.ratingRow}>
                {driverRating !== null ? (
                  <>
                    <Text style={styles.starIcon}>★</Text>
                    <Text style={styles.ratingText}>{driverRating.toFixed(1)}</Text>
                  </>
                ) : (
                  <Text style={styles.ratingText}>Rating not available yet</Text>
                )}
              </View>
            </View>
            <TouchableOpacity style={styles.iconButton} onPress={handleChat}>
              <Text style={styles.iconText}>💬</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={handleCall}>
              <Text style={styles.iconText}>📞</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Bottom Sheet Card */}
      <View style={styles.bottomCard}>
        <Card elevation="lg" style={styles.detailsCard}>
          {/* Ambulance Details */}
          <View style={styles.ambulanceRow}>
            <Text style={styles.ambulanceIcon}>🚑</Text>
            <View style={styles.ambulanceInfo}>
              <Text style={styles.ambulanceModel}>
                {vehicle?.model
                  ? `${vehicle.model} - ${booking.category.toUpperCase()}`
                  : `${booking.category.toUpperCase()} ambulance`}
              </Text>
              <Text style={styles.plateNumber}>
                {vehicle?.plate_number ?? 'Vehicle details not recorded'}
              </Text>
            </View>
            <Badge label={booking.status.toUpperCase()} variant="info" />
          </View>

          <View style={styles.divider} />

          {/* Pickup / Destination */}
          <View style={styles.locationRow}>
            <View style={[styles.locationDot, styles.pickup]} />
            <View style={styles.locationInfo}>
              <Text style={styles.locationLabel}>Pickup</Text>
              <Text style={styles.locationAddress}>{booking.pickup_address}</Text>
            </View>
          </View>
          <View style={styles.locationRow}>
            <View style={[styles.locationDot, styles.destination]} />
            <View style={styles.locationInfo}>
              <Text style={styles.locationLabel}>Destination</Text>
              <Text style={styles.locationAddress}>{booking.destination_address}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Fare Breakdown */}
          <Text style={styles.fareTitle}>Fare Estimate</Text>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Base fare</Text>
            <Text style={styles.fareValue}>NPR {fareBreakdown.baseFare}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Distance ({distanceLabel})</Text>
            <Text style={styles.fareValue}>NPR {fareBreakdown.distanceCharge}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Service fee</Text>
            <Text style={styles.fareValue}>NPR {fareBreakdown.serviceFee}</Text>
          </View>
          <View style={[styles.fareRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Estimated total</Text>
            <Text style={styles.totalValue}>NPR {totalFare}</Text>
          </View>
          <Text style={styles.fareNote}>
            Rate card estimate — the final fare is confirmed after the trip.
          </Text>
        </Card>

        {/* Cancel Button */}
        <Button
          title="Cancel Ride"
          onPress={handleCancel}
          variant="outline"
          fullWidth
          style={styles.cancelButton}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center' },

  mapContainer: { flex: 1, position: 'relative' },
  mapPlaceholder: {
    flex: 1,
    backgroundColor: '#E8EAF0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  routeContainer: {
    width: SCREEN_WIDTH * 0.7,
    height: 200,
    position: 'relative',
    justifyContent: 'center',
  },
  routeLine: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    width: '100%',
  },
  routeProgress: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  mapPin: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupPin: { left: 0, top: '40%', backgroundColor: colors.green },
  destPin: { right: 0, top: '40%', backgroundColor: colors.primary },
  pinIcon: { color: colors.surface, fontSize: 12 },
  ambulanceMarker: {
    position: 'absolute',
    top: '35%',
    fontSize: 32,
  },
  ambulanceIcon: { fontSize: 32 },

  statusCard: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadows.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  statusText: { ...typography.h4, flex: 1 },
  etaText: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.xs, marginLeft: spacing.lg + 10 },

  driverBar: {
    position: 'absolute',
    top: 100,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.md,
  },
  driverInfo: { flex: 1 },
  driverName: { ...typography.body, fontWeight: '600' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  starIcon: { color: colors.warning, fontSize: 14 },
  ratingText: { ...typography.caption, color: colors.textSecondary },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 18 },

  bottomCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    ...shadows.lg,
  },
  detailsCard: { marginBottom: spacing.lg },
  ambulanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ambulanceInfo: { flex: 1 },
  ambulanceModel: { ...typography.body, fontWeight: '600' },
  plateNumber: { ...typography.caption, color: colors.textSecondary },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },

  locationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.sm },
  locationDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  pickup: { backgroundColor: colors.green },
  destination: { backgroundColor: colors.primary },
  locationInfo: { flex: 1 },
  locationLabel: { ...typography.caption, color: colors.textTertiary },
  locationAddress: { ...typography.bodySmall, fontWeight: '500' },

  fareTitle: { ...typography.h4, marginBottom: spacing.sm },
  fareNote: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  fareLabel: { ...typography.bodySmall, color: colors.textSecondary },
  fareValue: { ...typography.bodySmall, fontWeight: '500' },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.xs },
  totalLabel: { ...typography.body, fontWeight: '700' },
  totalValue: { ...typography.body, fontWeight: '700', color: colors.primary },

  cancelButton: { marginTop: spacing.sm },
});

export default TripTrackingScreen;
