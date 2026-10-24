import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, StarRating } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { bookingsService } from '../../services/database/bookings';
import { ratingsService } from '../../services/database/ratings';
import { driversService } from '../../services/database/drivers';
import { profilesService } from '../../services/database/profiles';
import { isSupabaseConfigured } from '../../services/database/client';
import { useAuthStore } from '../../store/authStore';
import { isDemoMode } from '../../utils/demoMode';
import { DemoTripReceipt } from '../../utils/demoTrip';
import { useDemoRatingStore } from '../../store/demoRatingStore';
import { Booking } from '../../types';

type RouteParams = {
  Rating: { bookingId?: string; booking?: Booking; demoTrip?: DemoTripReceipt };
};

const POSITIVE_TAGS = ['Quick response', 'Professional crew', 'Clean vehicle', 'Careful driving'];
const ISSUE_TAGS = ['Arrived late', 'Hard to reach', 'Driving style', 'Vehicle condition', 'Billing concern'];

const RatingScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'Rating'>>();
  const bookingId = route.params?.bookingId;
  const paramBooking = route.params?.booking;
  const { user } = useAuthStore();

  const demoRun = isDemoMode();
  const demoTrip = demoRun && route.params?.demoTrip?.isDemo ? route.params.demoTrip : undefined;
  const saveDemoRating = useDemoRatingStore((state) => state.saveDemoRating);
  const existingDemoRating = useDemoRatingStore((state) =>
    demoTrip ? state.ratingsByTripId[demoTrip.id] : undefined,
  );
  const shouldFetch = Boolean(bookingId && paramBooking === undefined && isSupabaseConfigured && !demoRun);

  const [booking, setBooking] = useState<Booking | null>(paramBooking ?? null);
  const [loading, setLoading] = useState(shouldFetch);
  const [error, setError] = useState<string | null>(
    !paramBooking && !shouldFetch && !demoRun ? 'No trip was provided to rate.' : null,
  );
  const [rating, setRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(Boolean(existingDemoRating));
  const [driverName, setDriverName] = useState<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!shouldFetch || !bookingId) return;
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
  }, [bookingId, shouldFetch]);

  // Show the real driver's name when it can be loaded; otherwise a generic
  // label — never an invented person.
  useEffect(() => {
    const driverId = booking?.driver_id;
    if (!driverId || !isSupabaseConfigured || demoRun) return;
    let active = true;
    (async () => {
      try {
        const driver = await driversService.getById(driverId);
        if (!driver || !active) return;
        const profile = await profilesService.getById(driver.user_id);
        if (active && profile?.full_name && profile.full_name.trim()) {
          setDriverName(profile.full_name.trim());
        }
      } catch {
        // Keep the generic label.
      }
    })();
    return () => {
      active = false;
    };
  }, [booking?.driver_id, demoRun]);

  const canPersist = Boolean(
    isSupabaseConfigured && !demoRun && booking && user?.id && booking.driver_id && bookingId,
  );

  const tagOptions = useMemo(
    () => (rating >= 4 ? POSITIVE_TAGS : rating > 0 && rating <= 3 ? ISSUE_TAGS : []),
    [rating],
  );

  const toggleTag = (tag: string) => {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );
  };

  const handleSubmit = async () => {
    if (rating === 0 || submittingRef.current || submitted) return;
    if (demoRun) {
      if (demoTrip) {
        const feedback = [
          selectedTags.length > 0 ? selectedTags.join(', ') : null,
          comment.trim() || null,
        ].filter(Boolean).join(' — ');
        saveDemoRating(demoTrip.id, {
          rating,
          feedback: feedback || undefined,
          submittedAt: new Date().toISOString(),
        });
      }
      setSubmitted(true);
      return;
    }
    if (!canPersist || !booking || !user || !booking.driver_id || !bookingId) {
      setError('An authorized assigned driver and completed booking are required to submit a rating.');
      return;
    }
    try {
      submittingRef.current = true;
      setSubmitting(true);
      setError(null);

      const feedbackParts = [
        selectedTags.length > 0 ? selectedTags.join(', ') : null,
        comment.trim() ? comment.trim() : null,
      ].filter(Boolean);
      await ratingsService.create({
        booking_id: bookingId,
        user_id: user.id,
        driver_id: booking.driver_id,
        rating,
        feedback: feedbackParts.length > 0 ? feedbackParts.join(' — ') : undefined,
      });
      setSubmitted(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      setError(
        message.includes('duplicate')
          ? 'This trip has already been rated.'
          : 'Failed to submit rating. Please try again.',
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (demoRun) {
      navigation.popTo('Home');
      return;
    }
    // popTo returns to the existing trip list instead of pushing a duplicate
    // copy of it on top of the rating screen (navigate pushes in v7).
    navigation.popTo('Activity');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading trip…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!booking && !demoRun) {
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
          <Text style={styles.thankYouTitle}>Rating submitted</Text>
          <Text style={styles.thankYouMessage}>
            {demoRun
              ? 'Your rating is saved only for this local demo walkthrough. No driver was notified and nothing was sent to a server.'
              : canPersist
              ? 'Your feedback was saved and helps us improve RESQ Nepal for everyone.'
              : 'Your feedback was not sent because this trip has no authorized assigned driver.'}
          </Text>
          <Button
            title={demoRun ? 'Back to Home' : 'Done'}
            onPress={handleClose}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.xxl }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Completed trip — green check as in the reference. */}
        <View style={styles.checkCircle}>
          <Text style={styles.checkGlyph}>✓</Text>
        </View>

        <Text style={styles.heading}>Trip Completed</Text>
        <Text style={styles.subtitle}>Thank you for using RESQ Nepal!</Text>
        {(!isSupabaseConfigured || demoRun) && (
          <Text style={styles.sampleNote}>
            {demoTrip
              ? `DEMO PREVIEW · ${demoTrip.id} · sample assignment only. This rating stays local.`
              : demoRun
              ? 'Demo mode — this rating stays on this device and is not sent to a server.'
              : 'Sample mode — database not configured. The rating is not saved.'}
          </Text>
        )}

        {/* Rating card — stars for the real driver only. */}
        <Card elevation="sm" style={styles.ratingCard}>
          <Text style={styles.ratingTitle}>Rate your driver</Text>
          <Text style={styles.ratingDriver}>
            {demoTrip ? 'Sample driver · no real driver was assigned' : driverName ?? 'Your assigned driver'}
          </Text>
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

          {/* Feedback chips + comment — optional, only after a rating choice */}
          {tagOptions.length > 0 && (
            <View style={styles.feedbackSection}>
              <Text style={styles.feedbackTitle}>
                {rating >= 4 ? 'What went well? (optional)' : 'What went wrong? (optional)'}
              </Text>
              <View style={styles.chipWrap}>
                {tagOptions.map((tag) => {
                  const selected = selectedTags.includes(tag);
                  return (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => toggleTag(tag)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{tag}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                style={styles.commentInput}
                placeholder="Add a comment (optional)"
                placeholderTextColor={colors.textTertiary}
                value={comment}
                onChangeText={setComment}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
          )}
        </Card>

        {/* Submit error (e.g. duplicate rating, network failure) */}
        {error && <Text style={styles.submitError}>{error}</Text>}

        <Button
          title="Submit Rating"
          onPress={handleSubmit}
          fullWidth
          size="lg"
          disabled={rating === 0 || submitting || (!demoRun && !canPersist)}
          loading={submitting}
          style={styles.submitButton}
        />
        <TouchableOpacity
          onPress={handleClose}
          style={styles.skipLink}
          accessibilityRole="button"
          accessibilityLabel="Skip rating"
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scrollContent: { padding: spacing.xl, alignItems: 'center', paddingBottom: spacing.xxxl },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center' },

  checkCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  checkGlyph: { color: colors.surface, fontSize: 32, fontWeight: '800' },

  heading: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: spacing.xs, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  sampleNote: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  ratingCard: { width: '100%', marginBottom: spacing.lg, alignItems: 'stretch' },
  ratingTitle: { ...typography.h4, color: colors.text },
  ratingDriver: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  ratingContainer: { alignItems: 'center', marginBottom: spacing.md },
  ratingHint: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.md },

  feedbackSection: { width: '100%', marginTop: spacing.sm },
  feedbackTitle: { ...typography.h4, marginBottom: spacing.md },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.redLight },
  chipText: { ...typography.bodySmall, color: colors.textSecondary },
  chipTextSelected: { color: colors.primaryDark, fontWeight: '700' },
  commentInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 88,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.input,
  },

  submitError: {
    ...typography.bodySmall,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  submitButton: { marginTop: spacing.sm },
  skipLink: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  skipText: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },

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
