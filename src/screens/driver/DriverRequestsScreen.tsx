import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Badge, EmptyState } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Booking } from '../../types';
import { supabase } from '../../services/database';
import { isDemoMode } from '../../utils/demoMode';
import { useDriverDemoStore } from '../../store/driverDemoStore';
import { useAuthStore } from '../../store/authStore';
import DriverNavigationHeader from '../../components/driver/DriverNavigationHeader';

const REQUEST_EXPIRY_SECONDS = 60;

const DriverRequestsScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  // Demo walkthrough — sample requests live in an isolated in-memory store;
  // accepting or declining here never touches the real database.
  const isDemoDriver = useAuthStore((state) => state.isDemoDriver);
  const walkthrough = isDemoMode() && isDemoDriver;
  const demoRequests = useDriverDemoStore((s) => s.requests);
  const acceptDemoRequest = useDriverDemoStore((s) => s.acceptRequest);
  const declineDemoRequest = useDriverDemoStore((s) => s.declineRequest);

  const [requests, setRequests] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);

  // The walkthrough requests are projected into the same shape the card
  // renders, so both paths share one presentation.
  const displayRequests: Booking[] = walkthrough
    ? demoRequests.map((r) => ({
        id: r.id,
        user_id: 'walkthrough-patient',
        category: r.category,
        pickup_address: r.pickupAddress,
        pickup_lat: r.pickupLat,
        pickup_lng: r.pickupLng,
        destination_address: r.destinationAddress,
        dest_lat: r.destLat,
        dest_lng: r.destLng,
        status: 'pending',
        patient_name: r.patientName,
        patient_age: r.patientAge,
        patient_condition: r.patientCondition,
        emergency_level: r.emergencyLevel,
        estimated_fare: r.estimatedFare,
        distance_km: r.distanceKm,
        duration_min: r.durationMin,
        payment_method: 'cash',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
    : requests;

  useEffect(() => {
    loadRequests();
    // Load exactly once on mount — loadRequests reads fresh state internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRequests() {
    setLoading(true);
    setError(null);
    try {
      if (walkthrough) {
        setLoading(false);
        return;
      }
      const { data, error: fetchError } = await supabase
        .from('bookings')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (fetchError) throw fetchError;
      setRequests(data ?? []);
    } catch {
      setError('Failed to load requests. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const handleAccept = async (requestId: string) => {
    if (walkthrough) {
      // Walkthrough acceptance is instant and in-memory; the store refuses
      // when a sample trip is already active.
      const accepted = acceptDemoRequest(requestId);
      if (!accepted) {
        Alert.alert(
          'Walkthrough trip already in progress',
          'Finish or restart the current walkthrough trip before accepting another request.',
        );
        return;
      }
      navigation.navigate('DriverTrip', { bookingId: requestId });
      return;
    }

    setAcceptingId(requestId);
    try {
      // Attach this driver's own ambulance to the accepted booking —
      // otherwise the RPC stores ambulance_id = null.
      let ambulanceId: string | null = null;
      try {
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData.user?.id;
        if (userId) {
          const { data: driverRow } = await supabase
            .from('drivers')
            .select('id')
            .eq('user_id', userId)
            .maybeSingle();
          if (driverRow?.id) {
            const { data: ambRow } = await supabase
              .from('ambulances')
              .select('id')
              .eq('driver_id', driverRow.id)
              .limit(1)
              .maybeSingle();
            ambulanceId = ambRow?.id ?? null;
          }
        }
      } catch {
        // Leaving the ambulance unset is safe; acceptance still proceeds.
      }

      // Atomic compare-and-set via the accept_booking RPC: only one
      // driver can win a pending booking; the loser receives an error.
      const { error: acceptError } = await supabase.rpc('accept_booking', {
        p_booking_id: requestId,
        p_ambulance_id: ambulanceId,
      });
      if (acceptError) {
        setError(acceptError.message);
        return;
      }
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      navigation.navigate('DriverTrip', { bookingId: requestId });
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDecline = async (requestId: string) => {
    if (walkthrough) {
      // Walkthrough decline — removes the sample request from this session
      // only; nothing is written anywhere.
      declineDemoRequest(requestId);
      return;
    }
    setDecliningId(requestId);
    try {
      // Declining only dismisses the request locally — the booking
      // remains available for other drivers.
      await new Promise((resolve) => setTimeout(resolve, 400));
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } finally {
      setDecliningId(null);
    }
  };

  const getEmergencyColor = (level: string) => {
    switch (level) {
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'success';
      default:
        return 'neutral';
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <DriverNavigationHeader title="Requests" showBack />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading requests...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <DriverNavigationHeader title="Requests" showBack />
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Retry" variant="outline" onPress={loadRequests} />
        </View>
      </SafeAreaView>
    );
  }

  if (displayRequests.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <DriverNavigationHeader title="Requests" showBack />
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="📋"
            title="No Incoming Requests"
            message="New booking requests will appear here when patients request ambulances near you."
          />
          {walkthrough && (
            <Button
              title="Refresh Requests"
              variant="outline"
              onPress={() => useDriverDemoStore.getState().restart()}
              style={styles.restartButton}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <DriverNavigationHeader title={`Requests (${displayRequests.length})`} showBack />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {displayRequests.map((request) => (
          <Card key={request.id} elevation="sm" style={styles.requestCard}>
            {/* Header Row */}
            <View style={styles.cardHeader}>
              <View style={styles.headerLeft}>
                <Badge
                  label={request.category.toUpperCase()}
                  variant={request.category === 'icu' ? 'error' : 'info'}
                />
                <Badge
                  label={request.emergency_level.toUpperCase()}
                  variant={getEmergencyColor(request.emergency_level)}
                />
              </View>
              <Text style={styles.timer}>⏱ {REQUEST_EXPIRY_SECONDS}s</Text>
            </View>

            {/* Patient Info */}
            <View style={styles.patientSection}>
              <Text style={styles.sectionLabel}>Patient</Text>
              <Text style={styles.patientName}>
                {request.patient_name ?? 'Unknown'} • {request.patient_age ?? '?'} yrs
              </Text>
              <Text style={styles.patientCondition}>{request.patient_condition ?? 'No condition noted'}</Text>
            </View>

            {/* Pickup & Destination */}
            <View style={styles.locationSection}>
              <View style={styles.locationRow}>
                <View style={[styles.locationDot, { backgroundColor: colors.success }]} />
                <View style={styles.locationInfo}>
                  <Text style={styles.locationLabel}>Pickup</Text>
                  <Text style={styles.locationAddress}>{request.pickup_address}</Text>
                </View>
              </View>
              <View style={styles.locationLine} />
              <View style={styles.locationRow}>
                <View style={[styles.locationDot, { backgroundColor: colors.primary }]} />
                <View style={styles.locationInfo}>
                  <Text style={styles.locationLabel}>Destination</Text>
                  <Text style={styles.locationAddress}>{request.destination_address}</Text>
                </View>
              </View>
            </View>

            {/* Trip Details */}
            <View style={styles.tripDetails}>
              <View style={styles.tripDetailItem}>
                <Text style={styles.tripDetailValue}>{request.distance_km ?? 0} km</Text>
                <Text style={styles.tripDetailLabel}>Distance</Text>
              </View>
              <View style={styles.tripDetailItem}>
                <Text style={styles.tripDetailValue}>{request.duration_min ?? 0} min</Text>
                <Text style={styles.tripDetailLabel}>Est. Time</Text>
              </View>
              <View style={styles.tripDetailItem}>
                <Text style={styles.tripDetailValue}>NPR {request.estimated_fare ?? 0}</Text>
                <Text style={styles.tripDetailLabel}>Fare</Text>
              </View>
            </View>

            {/* Actions */}
            <View style={styles.actionRow}>
              <Button
                title="Decline"
                variant="outline"
                size="sm"
                onPress={() => handleDecline(request.id)}
                loading={decliningId === request.id}
                disabled={decliningId === request.id || acceptingId === request.id}
                style={styles.declineButton}
              />
              <Button
                title="Accept"
                size="sm"
                onPress={() => handleAccept(request.id)}
                loading={acceptingId === request.id}
                disabled={acceptingId === request.id || decliningId === request.id}
                style={styles.acceptButton}
              />
            </View>
          </Card>
        ))}
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
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  restartButton: { alignSelf: 'center', marginTop: spacing.md },
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBack: {
    position: 'absolute',
    left: spacing.lg,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  headerBackText: {
    ...typography.h3,
    color: colors.text,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  requestCard: {
    marginBottom: spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timer: {
    ...typography.bodySmall,
    color: colors.warning,
    fontWeight: '700',
  },
  patientSection: {
    marginBottom: spacing.md,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  patientName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  patientCondition: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  locationSection: {
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
    marginBottom: spacing.md,
  },
  tripDetailItem: {
    flex: 1,
    alignItems: 'center',
  },
  tripDetailValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.text,
  },
  tripDetailLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  declineButton: {
    flex: 1,
  },
  acceptButton: {
    flex: 1,
  },
});

export default DriverRequestsScreen;
