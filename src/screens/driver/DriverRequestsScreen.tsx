import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Badge, EmptyState } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { Booking} from '../../types';
import { supabase, isSupabaseConfigured } from '../../services/database';

const REQUEST_EXPIRY_SECONDS = 60;

// Development sample requests — only shown when Supabase is not configured
// (clearly labelled in the UI). Never presented as live data.
const SAMPLE_REQUESTS: Booking[] = [
  {
    id: 'sample-b1',
    user_id: 'u1',
    category: 'icu',
    pickup_address: 'Thamel, Kathmandu',
    pickup_lat: 27.7172,
    pickup_lng: 85.324,
    destination_address: 'Norvic International Hospital, Kathmandu',
    dest_lat: 27.7245,
    dest_lng: 85.3128,
    status: 'pending',
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
  },
  {
    id: 'sample-b2',
    user_id: 'u2',
    category: 'basic',
    pickup_address: 'Boudha, Kathmandu',
    pickup_lat: 27.7215,
    pickup_lng: 85.3624,
    destination_address: 'Grande International Hospital, Dhapasi',
    dest_lat: 27.7489,
    dest_lng: 85.3256,
    status: 'pending',
    patient_name: 'Sunita Sharma',
    patient_age: '32',
    patient_condition: 'Fracture - left leg',
    emergency_level: 'medium',
    estimated_fare: 1200,
    distance_km: 6.5,
    duration_min: 25,
    payment_method: 'cash',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const DriverRequestsScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [requests, setRequests] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [usingSampleData, setUsingSampleData] = useState(false);

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    setError(null);
    try {
      if (!isSupabaseConfigured) {
        setUsingSampleData(true);
        setRequests(SAMPLE_REQUESTS);
        return;
      }
      setUsingSampleData(false);
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
    setAcceptingId(requestId);
    try {
      if (!isSupabaseConfigured) {
        // Sample mode — simulate the acceptance delay.
        await new Promise((resolve) => setTimeout(resolve, 800));
      } else {
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
      }
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      navigation.navigate('DriverTrip', { bookingId: requestId });
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDecline = async (requestId: string) => {
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
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Retry" variant="outline" onPress={loadRequests} />
        </View>
      </SafeAreaView>
    );
  }

  if (requests.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Requests</Text>
        </View>
        <EmptyState
          icon="📋"
          title="No Incoming Requests"
          message="New booking requests will appear here when patients request ambulances near you."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Requests</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{requests.length}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {usingSampleData && (
          <Card elevation="sm" style={styles.sampleCard}>
            <Text style={styles.sampleText}>
              ⚠️ Sample mode — database not configured. Showing example requests.
            </Text>
          </Card>
        )}

        {requests.map((request) => (
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
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  countBadge: {
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    minWidth: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
    paddingHorizontal: 6,
  },
  countText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '700',
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
