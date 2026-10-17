import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { useBookingStore } from '../../store/bookingStore';
import { bookingsService } from '../../services/database/bookings';
import { Booking } from '../../types';

type RouteParams = {
  Arrival: { bookingId: string };
};

const MOODS = [
  { emoji: '😡', label: 'Terrible' },
  { emoji: '😞', label: 'Bad' },
  { emoji: '😐', label: 'Okay' },
  { emoji: '😊', label: 'Good' },
  { emoji: '😄', label: 'Great' },
];

const ArrivalScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'Arrival'>>();
  const { bookingId } = route.params;
  const { setBookingStatus } = useBookingStore();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMood, setSelectedMood] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);

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

  const handleFinish = async () => {
    try {
      setFinishing(true);
      await bookingsService.updateStatus(bookingId, 'completed');
      setBookingStatus('completed');
      navigation.navigate('Rating', { bookingId });
    } catch {
      setError('Failed to complete trip');
      setFinishing(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading trip summary...</Text>
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

  const duration = booking.duration_min || 24;
  const distance = booking.distance_km || 8.5;
  const avgSpeed = Math.round((distance / (duration / 60)) * 10) / 10;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Map View with Completed Route */}
        <View style={styles.mapContainer}>
          <View style={styles.mapPlaceholder}>
            <View style={styles.routeContainer}>
              <View style={styles.routeLine} />
              <View style={styles.routeProgressComplete} />
              <View style={[styles.mapPin, styles.pickupPin]}>
                <Text style={styles.pinIcon}>●</Text>
              </View>
              <View style={[styles.mapPin, styles.destPin]}>
                <Text style={styles.pinIcon}>📍</Text>
              </View>
              <View style={styles.ambulanceMarker}>
                <Text style={styles.ambulanceIcon}>🚑</Text>
              </View>
            </View>
            <Text style={styles.mapLabel}>Route Completed</Text>
          </View>
        </View>

        {/* Arrival Content */}
        <View style={styles.content}>
          {/* Red Location Pin */}
          <View style={styles.pinContainer}>
            <Text style={styles.redPin}>📍</Text>
          </View>

          {/* Heading */}
          <Text style={styles.heading}>You have arrived!</Text>

          {/* Destination Info */}
          <Text style={styles.destinationName}>{booking.destination_address.split(',')[0]}</Text>
          <Text style={styles.destinationAddress}>{booking.destination_address}</Text>

          {/* Trip Stats */}
          <Card elevation="md" style={styles.statsCard}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{duration}</Text>
                <Text style={styles.statLabel}>Duration (min)</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{distance.toFixed(1)}</Text>
                <Text style={styles.statLabel}>Distance (km)</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{avgSpeed}</Text>
                <Text style={styles.statLabel}>Avg Speed (km/h)</Text>
              </View>
            </View>
          </Card>

          {/* Mood Selector */}
          <Card elevation="sm" style={styles.moodCard}>
            <Text style={styles.moodTitle}>How was your mood during this trip?</Text>
            <View style={styles.moodRow}>
              {MOODS.map((mood, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.moodButton,
                    selectedMood === index && styles.moodButtonSelected,
                  ]}
                  onPress={() => setSelectedMood(index)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.moodEmoji}>{mood.emoji}</Text>
                  <Text
                    style={[
                      styles.moodLabel,
                      selectedMood === index && styles.moodLabelSelected,
                    ]}
                  >
                    {mood.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          {/* Finish Button */}
          <Button
            title="Finish"
            onPress={handleFinish}
            fullWidth
            size="lg"
            loading={finishing}
            style={styles.finishButton}
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

  mapContainer: { height: 280 },
  mapPlaceholder: {
    flex: 1,
    backgroundColor: '#E8EAF0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLabel: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.sm },
  routeContainer: {
    width: '70%',
    height: 160,
    position: 'relative',
    justifyContent: 'center',
  },
  routeLine: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    width: '100%',
  },
  routeProgressComplete: {
    height: 4,
    backgroundColor: colors.success,
    borderRadius: 2,
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
  },
  mapPin: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupPin: { left: 0, top: '40%', backgroundColor: colors.green },
  destPin: { right: 0, top: '40%', backgroundColor: colors.primary },
  pinIcon: { color: colors.surface, fontSize: 14 },
  ambulanceMarker: {
    position: 'absolute',
    right: '5%',
    top: '35%',
    fontSize: 36,
  },
  ambulanceIcon: { fontSize: 36 },

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
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  statDivider: { width: 1, height: 40, backgroundColor: colors.border },

  moodCard: { width: '100%', marginBottom: spacing.xl },
  moodTitle: { ...typography.h4, textAlign: 'center', marginBottom: spacing.lg },
  moodRow: { flexDirection: 'row', justifyContent: 'space-between' },
  moodButton: {
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: 'transparent',
    minWidth: 56,
  },
  moodButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.redLight,
  },
  moodEmoji: { fontSize: 28, marginBottom: spacing.xs },
  moodLabel: { ...typography.caption, color: colors.textSecondary },
  moodLabelSelected: { color: colors.primary, fontWeight: '600' },

  finishButton: { marginTop: spacing.sm },
});

export default ArrivalScreen;
