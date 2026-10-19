import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button } from '../../components/ui';
import { MapCanvas } from '../../components/map/MapCanvas';
import { SearchRadar } from '../../components/booking/SearchRadar';
import { bookingsService, isSupabaseConfigured } from '../../services/database';
import { useAuthStore } from '../../store/authStore';
import { useBookingStore } from '../../store/bookingStore';
import { isDemoMode } from '../../utils/demoMode';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map-first search screen shown immediately after the Home primary action.
 *
 * The booking row is created while the radar runs. As soon as creation
 * succeeds the screen hands over to BookingStatus, which continues polling the
 * real booking. No driver, plate, ETA or dispatch result is invented here.
 */
const ProcessingScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const { user } = useAuthStore();
  const { pickup, destination, selectedCategory } = useBookingStore();

  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cancelledRef = useRef(false);
  // Prevents overlapping create calls (e.g. rapid Retry taps) from inserting
  // two bookings for the same request.
  const creatingRef = useRef(false);

  const bookingData = route.params?.bookingData;
  const demoRun = isDemoMode();

  const createBooking = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      // Yield once so this function never calls setState synchronously from
      // the mount effect (avoids cascading renders).
      await Promise.resolve();

      // ── Demo mode / database not configured: walk through the flow without
      // persisting anything. The UI labels this clearly.
      if (!isSupabaseConfigured || demoRun) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        if (cancelledRef.current) return;
        creatingRef.current = false;
        navigation.replace('BookingStatus', { bookingData });
        return;
      }

      // ── Database configured: create the real booking row.
      const userId = user?.id;
      if (!userId) {
        setError('You need to be signed in to create a booking.');
        return;
      }
      if (!pickup?.address || !destination?.address) {
        setError('Pickup and destination are required. Go back and select both addresses.');
        return;
      }

      const ambulance = bookingData?.ambulance;
      const record = await bookingsService.create({
        user_id: userId,
        // Only pass ambulance_id when it is a real database UUID; sample and
        // category options use placeholder ids that would fail the foreign key.
        ambulance_id:
          typeof ambulance?.id === 'string' && UUID_RE.test(ambulance.id)
            ? ambulance.id
            : undefined,
        category: ambulance?.category ?? selectedCategory,
        pickup_address: pickup.address,
        pickup_lat: pickup.lat ?? undefined,
        pickup_lng: pickup.lng ?? undefined,
        destination_address: destination.address,
        dest_lat: destination.lat ?? undefined,
        dest_lng: destination.lng ?? undefined,
        status: 'pending',
        patient_name: bookingData?.patientName,
        patient_age: bookingData?.patientAge,
        patient_condition: bookingData?.patientCondition,
        patient_phone: bookingData?.patientPhone,
        notes: bookingData?.notes ?? undefined,
        emergency_level: bookingData?.emergencyLevel ?? 'medium',
        // Only sent when a real rate-card estimate exists; otherwise the fare
        // stays pending until it is confirmed after the trip.
        estimated_fare: bookingData?.totalFare ?? undefined,
        payment_method: bookingData?.paymentMethod ?? 'cash',
      });

      if (cancelledRef.current) return;
      creatingRef.current = false;
      navigation.replace('BookingStatus', {
        bookingData,
        bookingId: record.id,
      });
    } catch {
      if (cancelledRef.current) return;
      setError(
        'We could not create your booking. Check your connection and try again — no booking was placed.',
      );
    } finally {
      creatingRef.current = false;
    }
  }, [bookingData, demoRun, destination, navigation, pickup, selectedCategory, user]);

  useEffect(() => {
    cancelledRef.current = false;

    // Kick off booking creation on the next tick so no setState is called
    // synchronously from the effect body.
    const kickoff = setTimeout(() => {
      void createBooking();
    }, 0);

    return () => {
      cancelledRef.current = true;
      clearTimeout(kickoff);
    };
  }, [attempt, createBooking]);

  const handleRetry = () => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  const pickupPoint =
    pickup?.lat != null && pickup?.lng != null ? { lat: pickup.lat, lng: pickup.lng } : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.mapArea}>
        <MapCanvas
          pickup={pickupPoint}
          pickupLabel={pickup?.address}
          style={styles.map}
        />
        {!error && <SearchRadar active={isFocused} />}
        <View style={styles.topPill}>
          <Text style={styles.topPillText}>Ambulance search</Text>
        </View>
      </View>

      <View style={styles.sheet}>
        <View style={styles.handleBar} />

        {error ? (
          <View style={styles.errorBody}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.title}>Booking not created</Text>
            <Text style={styles.subtitle}>{error}</Text>
            <Button title="Try again" onPress={handleRetry} fullWidth style={styles.retryButton} />
            <Button title="Go back" variant="ghost" onPress={handleGoBack} fullWidth />
          </View>
        ) : (
          <>
            <View style={styles.statusRow}>
              <View style={styles.statusIconWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
              <View style={styles.statusCopy}>
                <Text style={styles.title}>Finding an ambulance…</Text>
                <Text style={styles.subtitle}>
                  Looking for a verified crew near your pickup.
                </Text>
              </View>
            </View>

            <View style={styles.routeRow}>
              <View style={styles.routeRail}>
                <View style={[styles.routeDot, styles.routeDotPickup]} />
                <View style={styles.routeLine} />
                <View style={[styles.routeDot, styles.routeDotDestination]} />
              </View>
              <View style={styles.routeCopy}>
                <Text style={styles.routeText} numberOfLines={1}>
                  {pickup?.address || 'Pickup location'}
                </Text>
                <Text style={styles.routeText} numberOfLines={1}>
                  {destination?.address || 'Destination'}
                </Text>
              </View>
            </View>

            <Text style={styles.helper}>
              {demoRun
                ? 'Demo walkthrough — no dispatch server is contacted. The radar is illustrative, not live GPS.'
                : isSupabaseConfigured
                  ? 'This may take a few moments. The radar is illustrative, not live GPS.'
                  : 'Sample mode — the database is not configured, so nothing is saved.'}
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapArea: { flex: 1, position: 'relative' },
  map: { ...StyleSheet.absoluteFill },
  topPill: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
  },
  topPillText: { ...typography.bodySmall, fontWeight: '700', color: colors.text },

  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.redLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCopy: { flex: 1 },
  title: { ...typography.h3, color: colors.primary },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },

  routeRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  routeRail: { width: 18, alignItems: 'center', paddingTop: 5 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeDotPickup: { backgroundColor: colors.success },
  routeDotDestination: { backgroundColor: colors.primary },
  routeLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 3 },
  routeCopy: { flex: 1, marginLeft: spacing.sm, gap: 7 },
  routeText: { ...typography.bodySmall, color: colors.text },
  helper: {
    ...typography.caption,
    color: colors.textTertiary,
    lineHeight: 17,
    marginTop: spacing.md,
  },

  errorBody: { alignItems: 'center' },
  errorIcon: { fontSize: 34, marginBottom: spacing.sm },
  retryButton: { marginTop: spacing.lg, marginBottom: spacing.sm },
});

export default ProcessingScreen;
