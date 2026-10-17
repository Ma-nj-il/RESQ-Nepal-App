import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Avatar, StarRating } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { paymentMethodLabel } from '../../utils/format';
import { bookingsService } from '../../services/database/bookings';
import { ratingsService } from '../../services/database/ratings';
import { driversService } from '../../services/database/drivers';
import { profilesService } from '../../services/database/profiles';
import { isSupabaseConfigured } from '../../services/database/client';
import { useAuthStore } from '../../store/authStore';
import { Booking } from '../../types';

type RouteParams = {
  Rating: { bookingId: string };
};

const RatingScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'Rating'>>();
  const { bookingId } = route.params;
  const { user } = useAuthStore();


  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [driverName, setDriverName] = useState('Driver');

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

  // Show the real driver's name when it can be loaded; otherwise a generic
  // label — never an invented person.
  useEffect(() => {
    const driverId = booking?.driver_id;
    if (!driverId) return;
    (async () => {
      try {
        const driver = await driversService.getById(driverId);
        if (!driver) return;
        const profile = await profilesService.getById(driver.user_id);
        if (profile?.full_name && profile.full_name.trim()) {
          setDriverName(profile.full_name);
        }
      } catch {
        // Keep the generic label.
      }
    })();
  }, [booking?.driver_id]);

  const handleSubmit = async () => {
    if (rating === 0 || submitting || submitted) return;
    if (isSupabaseConfigured) {
      if (!user?.id) {
        setError('You need to be signed in to rate this trip.');
        return;
      }
      if (!booking?.driver_id) {
        setError('This trip has no assigned driver, so there is nothing to rate.');
        return;
      }
    }
    try {
      setSubmitting(true);
      setError(null);
      if (isSupabaseConfigured && booking && user?.id && booking.driver_id) {
        // Persist the rating against the completed booking.
        await ratingsService.create({
          booking_id: booking.id,
          user_id: user.id,
          driver_id: booking.driver_id,
          rating,
        });
      }
      setSubmitted(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      setError(
        message.includes('duplicate')
          ? 'This trip has already been rated.'
          : 'Failed to submit rating. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    navigation.navigate('Activity');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{error || 'Something went wrong'}</Text>
          <Button title="Go Back" onPress={() => navigation.goBack()} variant="outline" style={{ marginTop: spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.thankYouContainer}>
          <Text style={styles.thankYouIcon}>🎉</Text>
          <Text style={styles.thankYouTitle}>Thank You!</Text>
          <Text style={styles.thankYouMessage}>
            Your feedback helps us improve RESQ Nepal for everyone.
          </Text>
          <Button title="Done" onPress={handleClose} fullWidth size="lg" style={{ marginTop: spacing.xxl }} />
        </View>
      </SafeAreaView>
    );
  }

  // Real fare data from the booking — no invented promos, discounts or tax.
  const fareValue = booking.final_fare ?? booking.estimated_fare ?? null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Close Button */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Driver Avatar */}
        <View style={styles.avatarContainer}>
          <Avatar name={driverName} size="xl" />
        </View>

        {/* Heading */}
        <Text style={styles.heading}>How was the driver?</Text>
        <Text style={styles.subtitle}>Help RESQ Nepal do better by rating this trip</Text>
        {!isSupabaseConfigured && (
          <Text style={styles.sampleNote}>
            Sample mode — database not configured. The rating is not saved.
          </Text>
        )}

        {/* Star Rating */}
        <View style={styles.ratingContainer}>
          <StarRating rating={rating} onRate={setRating} size="lg" />
          <Text style={styles.ratingHint}>
            {rating === 0
              ? 'Tap a star to rate'
              : rating === 1
              ? 'Terrible'
              : rating === 2
              ? 'Bad'
              : rating === 3
              ? 'Okay'
              : rating === 4
              ? 'Good'
              : 'Excellent'}
          </Text>
        </View>

        {/* Payment Summary Card */}
        <Card elevation="md" style={styles.paymentCard}>
          <Text style={styles.paymentTitle}>Payment Summary</Text>
          <View style={styles.divider} />
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Payment Method</Text>
            <Text style={styles.paymentValue}>
              {paymentMethodLabel[booking.payment_method] ?? 'Not recorded'}
            </Text>
          </View>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>
              {booking.final_fare ? 'Final fare' : 'Estimated fare'}
            </Text>
            <Text style={styles.paymentValue}>
              {fareValue !== null ? `NPR ${fareValue}` : 'Not recorded'}
            </Text>
          </View>
          {fareValue !== null && (
            <>
              <View style={styles.divider} />
              <View style={styles.paymentRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>NPR {fareValue}</Text>
              </View>
            </>
          )}
        </Card>

        {/* Submit error (e.g. duplicate rating, network failure) */}
        {error && <Text style={styles.submitError}>{error}</Text>}

        {/* Give Rate Button */}
        <Button
          title="Give Rate"
          onPress={handleSubmit}
          fullWidth
          size="lg"
          disabled={rating === 0 || submitting}
          loading={submitting}
          style={styles.submitButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scrollContent: { padding: spacing.xl, alignItems: 'center' },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center' },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 18, color: colors.text },

  avatarContainer: { marginBottom: spacing.lg, marginTop: spacing.md },
  heading: { ...typography.h1, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  sampleNote: {
    ...typography.bodySmall,
    color: colors.warning,
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  ratingContainer: { alignItems: 'center', marginBottom: spacing.xxl },
  ratingHint: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.md },

  paymentCard: { width: '100%', marginBottom: spacing.xl },
  paymentTitle: { ...typography.h4, marginBottom: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  paymentLabel: { ...typography.bodySmall, color: colors.textSecondary },
  paymentValue: { ...typography.bodySmall, fontWeight: '500' },
  totalLabel: { ...typography.body, fontWeight: '700' },
  totalValue: { ...typography.body, fontWeight: '700', color: colors.primary },

  submitError: {
    ...typography.bodySmall,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  submitButton: { marginTop: spacing.sm },

  thankYouContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  thankYouIcon: { fontSize: 64, marginBottom: spacing.lg },
  thankYouTitle: { ...typography.h1, marginBottom: spacing.md },
  thankYouMessage: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
});

export default RatingScreen;
