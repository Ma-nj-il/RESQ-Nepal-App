import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button } from '../../components/ui';
import { bookingsService, isSupabaseConfigured } from '../../services/database';
import { useAuthStore } from '../../store/authStore';
import { useBookingStore } from '../../store/bookingStore';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ProcessingScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuthStore();
  const { pickup, destination, selectedCategory } = useBookingStore();

  const pulseAnim = useMemo(() => new Animated.Value(1), []);
  const fadeAnim = useMemo(() => new Animated.Value(0), []);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cancelledRef = useRef(false);
  // Prevents overlapping create calls (e.g. rapid Retry taps) from inserting
  // two bookings for the same request.
  const creatingRef = useRef(false);

  const bookingData = route.params?.bookingData;

  const createBooking = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      // Yield once so this function never calls setState synchronously from
      // the mount effect (avoids cascading renders).
      await Promise.resolve();

      // ── Database not configured: walk through the flow without persisting.
      if (!isSupabaseConfigured) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        if (cancelledRef.current) return;
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
        // Only pass ambulance_id when it is a real database UUID; sample
        // list items use placeholder ids that would fail the foreign key.
        ambulance_id:
          typeof ambulance?.id === 'string' && UUID_RE.test(ambulance.id)
            ? ambulance.id
            : undefined,
        category: ambulance?.category ?? selectedCategory,
        pickup_address: pickup.address,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        destination_address: destination.address,
        dest_lat: destination.lat,
        dest_lng: destination.lng,
        status: 'pending',
        patient_name: bookingData?.patientName,
        patient_age: bookingData?.patientAge,
        patient_condition: bookingData?.patientCondition,
        patient_phone: bookingData?.patientPhone,
        emergency_level: bookingData?.emergencyLevel ?? 'medium',
        estimated_fare: bookingData?.totalFare,
        payment_method: bookingData?.paymentMethod ?? 'cash',
      });

      if (cancelledRef.current) return;
      navigation.replace('BookingStatus', {
        bookingData,
        bookingId: record.id,
      });
    } catch {
      if (cancelledRef.current) return;
      setError(
        'We could not create your booking. Check your connection and try again — no booking was placed.'
      );
    } finally {
      creatingRef.current = false;
    }
  }, [bookingData, destination, navigation, pickup, selectedCategory, user]);

  useEffect(() => {
    cancelledRef.current = false;

    // Pulse animation
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    // Fade in animation
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // Kick off booking creation on the next tick so no setState is called
    // synchronously from the effect body.
    const kickoff = setTimeout(() => {
      void createBooking();
    }, 0);

    return () => {
      cancelledRef.current = true;
      clearTimeout(kickoff);
      pulse.stop();
    };
  }, [attempt, createBooking, fadeAnim, pulseAnim]);

  const handleRetry = () => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.card,
            {
              opacity: fadeAnim,
              transform: [{ scale: error ? 1 : pulseAnim }],
            },
          ]}
        >
          {error ? (
            <>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.title}>Booking Not Created</Text>
              <Text style={styles.subtitle}>{error}</Text>
              <Button
                title="Try Again"
                onPress={handleRetry}
                fullWidth
                style={styles.retryButton}
              />
              <Button
                title="Go Back"
                variant="ghost"
                onPress={handleGoBack}
                fullWidth
                style={styles.backButton}
              />
            </>
          ) : (
            <>
              <View style={styles.spinnerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
              <Text style={styles.title}>Processing...</Text>
              <Text style={styles.subtitle}>
                {isSupabaseConfigured
                  ? 'Please wait while we confirm your booking'
                  : 'Sample mode — database not configured. Nothing is being saved.'}
              </Text>
              <View style={styles.dotsContainer}>
                <View style={[styles.dot, styles.dotActive]} />
                <View style={styles.dot} />
                <View style={styles.dot} />
              </View>
            </>
          )}
        </Animated.View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.xxxl,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
  },
  spinnerContainer: {
    marginBottom: spacing.lg,
  },
  errorIcon: {
    fontSize: 44,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.primary,
  },
  retryButton: {
    marginTop: spacing.lg,
  },
  backButton: {
    marginTop: spacing.sm,
  },
});

export default ProcessingScreen;
