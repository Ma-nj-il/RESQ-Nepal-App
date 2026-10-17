import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Button, Card, Badge, Avatar } from '../../components/ui';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { bookingsService, isSupabaseConfigured } from '../../services/database';
import { Booking } from '../../types';

type TripPhase = 'pickup' | 'arrived' | 'started' | 'completed';

// Development sample trip — only shown when Supabase is not configured
// (clearly labelled in the UI). Never presented as live data.
function buildSampleBooking(bookingId?: string): Booking {
  return {
    id: bookingId ?? 'sample-b1',
    user_id: 'u1',
    category: 'icu',
    pickup_address: 'Thamel, Kathmandu',
    pickup_lat: 27.7172,
    pickup_lng: 85.324,
    destination_address: 'Norvic International Hospital, Kathmandu',
    dest_lat: 27.7245,
    dest_lng: 85.3128,
    status: 'assigned',
    patient_name: 'Ram Bahadur Thapa',
    patient_age: '65',
    patient_condition: 'Chest pain, needs ICU transport',
    emergency_level: 'high',
    estimated_fare: 2500,
    distance_km: 4.2,
    duration_min: 18,
    payment_method: 'cash',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const DriverTripScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const bookingId = route.params?.bookingId;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<TripPhase>('pickup');
  const [navigating, setNavigating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [usingSampleData, setUsingSampleData] = useState(false);

  useEffect(() => {
    loadBooking();
    // Load exactly once on mount — loadBooking reads fresh state internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBooking() {
    setLoading(true);
    setError(null);
    try {
      if (!isSupabaseConfigured || !bookingId) {
        setUsingSampleData(true);
        setBooking(buildSampleBooking(bookingId));
        return;
      }

      setUsingSampleData(false);
      const record = await bookingsService.getById(bookingId);
      if (!record) {
        setError('Trip not found.');
        return;
      }
      setBooking(record);
      // Resume the phase display from the stored status.
      if (record.status === 'arrived') setPhase('arrived');
      else if (record.status === 'started') setPhase('started');
      else if (record.status === 'completed') setPhase('completed');
      else setPhase('pickup');
    } catch {
      setError('Failed to load trip details.');
    } finally {
      setLoading(false);
    }
  }

  const openMaps = async (lat: number, lng: number, label: string) => {
    setNavigating(true);
    try {
      const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Error', 'Cannot open maps application');
      }
    } catch {
      Alert.alert('Error', 'Failed to open maps');
    } finally {
      setNavigating(false);
    }
  };

  const persistPhase = async (status: Booking['status'], next: TripPhase) => {
    if (!isSupabaseConfigured || usingSampleData || !booking) {
      setPhase(next);
      return;
    }
    setUpdating(true);
    try {
      await bookingsService.updateStatus(booking.id, status);
      setPhase(next);
    } catch {
      Alert.alert('Update Failed', 'Could not update the trip status. Check your connection and try again.');
    } finally {
      setUpdating(false);
    }
  };

  const handleArrived = () => {
    void persistPhase('arrived', 'arrived');
  };

  const handleStartTrip = () => {
    void persistPhase('started', 'started');
  };

  const handleCompleteTrip = async () => {
    if (isSupabaseConfigured && !usingSampleData && booking) {
      setUpdating(true);
      try {
        await bookingsService.updateStatus(booking.id, 'completed');
        setPhase('completed');
        Alert.alert(
          'Trip Completed',
          `Trip completed. Fare: NPR ${Number(booking.final_fare ?? booking.estimated_fare ?? 0).toLocaleString('en-IN')}`,
          [{ text: 'OK', onPress: () => navigation.navigate('DriverHome') }]
        );
      } catch {
        Alert.alert('Update Failed', 'Could not mark the trip as completed. Check your connection and try again.');
      } finally {
        setUpdating(false);
      }
      return;
    }

    setUpdating(true);
    setTimeout(() => {
      setUpdating(false);
      setPhase('completed');
      Alert.alert(
        'Trip Completed',
        `Sample trip completed. Fare: NPR ${Number(booking?.estimated_fare ?? 0).toLocaleString('en-IN')}`,
        [{ text: 'OK', onPress: () => navigation.navigate('DriverHome') }]
      );
    }, 800);
  };

  const handleCallPatient = () => {
    const phone = booking?.patient_phone?.trim();
    if (!phone) {
      Alert.alert(
        'No phone number',
        'A patient contact number was not recorded for this booking.',
      );
      return;
    }
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Call failed', 'Could not open the phone app on this device.');
    });
  };

  const getPhaseProgress = () => {
    switch (phase) {
      case 'pickup':
        return 0.25;
      case 'arrived':
        return 0.5;
      case 'started':
        return 0.75;
      case 'completed':
        return 1;
    }
  };

  const getPhaseLabel = () => {
    switch (phase) {
      case 'pickup':
        return 'Heading to Pickup';
      case 'arrived':
        return 'Arrived at Pickup';
      case 'started':
        return 'Trip In Progress';
      case 'completed':
        return 'Trip Completed';
    }
  };

  const renderActionButton = () => {
    switch (phase) {
      case 'pickup':
        return (
          <View style={styles.actionColumn}>
            <Button
              title="Navigate to Pickup"
              variant="outline"
              fullWidth
              onPress={() =>
                openMaps(booking?.pickup_lat ?? 0, booking?.pickup_lng ?? 0, 'Pickup')
              }
              loading={navigating}
              style={styles.navigateButton}
            />
            <Button
              title="Arrived at Pickup"
              fullWidth
              onPress={handleArrived}
              style={styles.primaryButton}
            />
          </View>
        );
      case 'arrived':
        return (
          <Button
            title="Start Trip"
            fullWidth
            size="lg"
            onPress={handleStartTrip}
            style={styles.primaryButton}
          />
        );
      case 'started':
        return (
          <View style={styles.actionColumn}>
            <Button
              title="Navigate to Destination"
              variant="outline"
              fullWidth
              onPress={() =>
                openMaps(booking?.dest_lat ?? 0, booking?.dest_lng ?? 0, 'Destination')
              }
              loading={navigating}
              style={styles.navigateButton}
            />
            <Button
              title="Complete Trip"
              fullWidth
              size="lg"
              onPress={handleCompleteTrip}
              loading={updating}
              disabled={updating}
              style={styles.primaryButton}
            />
          </View>
        );
      case 'completed':
        return null;
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading trip details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Retry" variant="outline" onPress={loadBooking} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Map View */}
      <View style={styles.mapContainer}>
        <View style={styles.mapPlaceholder}>
          <Text style={styles.mapIcon}>🗺️</Text>
          <Text style={styles.mapText}>Route Map</Text>
          <Text style={styles.mapSubtext}>{getPhaseLabel()}</Text>
          {/* Progress bar overlay */}
          <View style={styles.progressBarContainer}>
            <View
              style={[styles.progressBar, { width: `${getPhaseProgress() * 100}%` }]}
            />
          </View>
        </View>
      </View>

      {/* Bottom Content */}
      <View style={styles.bottomSheet}>
        {usingSampleData && (
          <View style={styles.sampleBanner}>
            <Text style={styles.sampleBannerText}>
              ⚠️ Sample mode — database not configured. Showing an example trip.
            </Text>
          </View>
        )}

        {/* Trip Progress Indicator */}
        <View style={styles.progressIndicator}>
          <View style={styles.progressSteps}>
            {['Pickup', 'Arrived', 'Started', 'Complete'].map((step, index) => {
              const stepPhase: TripPhase[] = ['pickup', 'arrived', 'started', 'completed'];
              const isActive = stepPhase.indexOf(phase) >= index;
              return (
                <View key={step} style={styles.progressStep}>
                  <View
                    style={[
                      styles.progressDot,
                      isActive && styles.progressDotActive,
                    ]}
                  >
                    {isActive && <Text style={styles.progressCheck}>✓</Text>}
                  </View>
                  <Text
                    style={[
                      styles.progressLabel,
                      isActive && styles.progressLabelActive,
                    ]}
                  >
                    {step}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Patient Info Card */}
        <Card elevation="sm" style={styles.patientCard}>
          <View style={styles.patientHeader}>
            <Avatar name={booking?.patient_name ?? 'Patient'} size="md" />
            <View style={styles.patientInfo}>
              <Text style={styles.patientName}>
                {booking?.patient_name ?? 'Unknown'}
              </Text>
              <Text style={styles.patientDetail}>
                Age: {booking?.patient_age ?? '?'} years
              </Text>
              <Text style={styles.patientCondition}>
                {booking?.patient_condition ?? 'No condition noted'}
              </Text>
            </View>
            <Badge
              label={booking?.emergency_level.toUpperCase() ?? 'MEDIUM'}
              variant={
                booking?.emergency_level === 'high'
                  ? 'error'
                  : booking?.emergency_level === 'medium'
                  ? 'warning'
                  : 'success'
              }
            />
          </View>
          <TouchableOpacity onPress={handleCallPatient} style={styles.callButton}>
            <Text style={styles.callIcon}>📞</Text>
            <Text style={styles.callText}>Call Patient</Text>
          </TouchableOpacity>
        </Card>

        {/* Pickup & Destination */}
        <Card elevation="sm" style={styles.locationCard}>
          <View style={styles.locationRow}>
            <View style={[styles.locationDot, { backgroundColor: colors.success }]} />
            <View style={styles.locationInfo}>
              <Text style={styles.locationLabel}>Pickup</Text>
              <Text style={styles.locationAddress}>{booking?.pickup_address}</Text>
            </View>
          </View>
          <View style={styles.locationLine} />
          <View style={styles.locationRow}>
            <View style={[styles.locationDot, { backgroundColor: colors.primary }]} />
            <View style={styles.locationInfo}>
              <Text style={styles.locationLabel}>Destination</Text>
              <Text style={styles.locationAddress}>{booking?.destination_address}</Text>
            </View>
          </View>
        </Card>

        {/* Trip Details */}
        <View style={styles.tripDetails}>
          <View style={styles.tripDetailItem}>
            <Text style={styles.tripDetailValue}>{booking?.distance_km ?? 0} km</Text>
            <Text style={styles.tripDetailLabel}>Distance</Text>
          </View>
          <View style={styles.tripDetailItem}>
            <Text style={styles.tripDetailValue}>{booking?.duration_min ?? 0} min</Text>
            <Text style={styles.tripDetailLabel}>Duration</Text>
          </View>
          <View style={styles.tripDetailItem}>
            <Text style={styles.tripDetailValue}>NPR {booking?.estimated_fare ?? 0}</Text>
            <Text style={styles.tripDetailLabel}>Fare</Text>
          </View>
        </View>

        {/* Action Buttons */}
        {renderActionButton()}
      </View>
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
  mapContainer: {
    flex: 1,
    backgroundColor: '#E8EAF6',
  },
  mapPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapIcon: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  mapText: {
    ...typography.h3,
    color: colors.text,
  },
  mapSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  progressBarContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    ...shadows.lg,
  },
  sampleBanner: {
    backgroundColor: colors.amberLight,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  sampleBannerText: {
    ...typography.bodySmall,
    color: colors.warning,
  },
  progressIndicator: {
    marginBottom: spacing.lg,
  },
  progressSteps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressStep: {
    alignItems: 'center',
    flex: 1,
  },
  progressDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  progressDotActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  progressCheck: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  progressLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  progressLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  patientCard: {
    marginBottom: spacing.md,
  },
  patientHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  patientInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  patientName: {
    ...typography.h4,
    color: colors.text,
  },
  patientDetail: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  patientCondition: {
    ...typography.bodySmall,
    color: colors.text,
    marginTop: 2,
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.greenLight,
    gap: spacing.sm,
  },
  callIcon: {
    fontSize: 16,
  },
  callText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '700',
  },
  locationCard: {
    marginBottom: spacing.md,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  locationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    marginRight: spacing.md,
  },
  locationInfo: {
    flex: 1,
  },
  locationLabel: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  locationAddress: {
    ...typography.bodySmall,
    color: colors.text,
    fontWeight: '500',
  },
  locationLine: {
    width: 2,
    height: 16,
    backgroundColor: colors.border,
    marginLeft: 4,
    marginVertical: 2,
  },
  tripDetails: {
    flexDirection: 'row',
    backgroundColor: colors.input,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  tripDetailItem: {
    flex: 1,
    alignItems: 'center',
  },
  tripDetailValue: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  tripDetailLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actionColumn: {
    gap: spacing.md,
  },
  navigateButton: {
    borderColor: colors.info,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
});

export default DriverTripScreen;
