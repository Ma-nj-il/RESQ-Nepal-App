import React, {  useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { useBookingStore } from '../../store/bookingStore';
import { bookingsService } from '../../services/database/bookings';
import {} from '../../types';

type RouteParams = {
  CancelRide: { bookingId: string };
};

const CANCEL_REASONS = [
  'Change in plans',
  'Waiting for long time',
  'Unable to contact driver',
  'Driver denied to go to destination',
  'Wrong address shown',
  'The price is not reasonable',
  'Emergency situation',
  'Booking mistake',
  'Double booking',
  'Poor weather conditions',
  'Other',
];

const CancelRideScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'CancelRide'>>();
  const { bookingId } = route.params;
  const { setBookingStatus } = useBookingStore();

  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!selectedReason) return;
    try {
      setLoading(true);
      await bookingsService.cancel(bookingId);
      setBookingStatus('cancelled');
      navigation.navigate('Activity');
    } catch {
      setError('Failed to cancel ride. Please try again.');
      setLoading(false);
    }
  };

  const handleClose = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cancel Ride</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>Why are you cancelling?</Text>

        {/* Radio Button List */}
        <View style={styles.reasonList}>
          {CANCEL_REASONS.map((reason) => (
            <TouchableOpacity
              key={reason}
              style={styles.reasonItem}
              onPress={() => setSelectedReason(reason)}
              activeOpacity={0.7}
            >
              <View style={styles.radioContainer}>
                <View
                  style={[
                    styles.radioOuter,
                    selectedReason === reason && styles.radioOuterSelected,
                  ]}
                >
                  {selectedReason === reason && <View style={styles.radioInner} />}
                </View>
              </View>
              <Text
                style={[
                  styles.reasonText,
                  selectedReason === reason && styles.reasonTextSelected,
                ]}
              >
                {reason}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}
      </ScrollView>

      {/* Confirm Button */}
      <View style={styles.bottomContainer}>
        <Button
          title="Confirm"
          onPress={handleConfirm}
          fullWidth
          size="lg"
          disabled={!selectedReason}
          loading={loading}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  headerTitle: { ...typography.h3 },
  placeholder: { width: 40 },

  scrollContent: { padding: spacing.xl },

  subtitle: {
    ...typography.h4,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },

  reasonList: { gap: spacing.xs },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    gap: spacing.md,
  },
  radioContainer: { width: 24, alignItems: 'center' },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: colors.primary },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  reasonText: { ...typography.body, flex: 1 },
  reasonTextSelected: { fontWeight: '600', color: colors.primary },

  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  bottomContainer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

export default CancelRideScreen;
