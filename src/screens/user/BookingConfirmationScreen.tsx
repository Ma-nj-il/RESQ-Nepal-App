import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { Button, Input, Card, Badge } from '../../components/ui';
import { useBookingStore } from '../../store/bookingStore';
import { useAuthStore } from '../../store/authStore';
import { estimateFare } from '../../constants/fares';
import { PaymentMethod } from '../../types';

const PAYMENT_METHODS: { key: PaymentMethod; label: string; icon: string }[] = [
  { key: 'wallet', label: 'RESQ Wallet', icon: '👛' },
  { key: 'cash', label: 'Cash', icon: '💵' },
  { key: 'esewa', label: 'eSewa', icon: '📱' },
  { key: 'khalti', label: 'Khalti', icon: '📲' },
];

const BookingConfirmationScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const ambulance = route.params?.ambulance;
  const { pickup, destination } = useBookingStore();
  const { user } = useAuthStore();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('wallet');
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [patientCondition, setPatientCondition] = useState('');
  const [patientPhone, setPatientPhone] = useState(user?.phone ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fare = estimateFare(
    ambulance?.category ?? 'basic',
    ambulance?.distanceKm ?? undefined
  );

  const handleConfirmBooking = async () => {
    if (!patientName.trim()) {
      Alert.alert('Missing Information', 'Please enter patient name');
      return;
    }

    setIsSubmitting(true);

    try {
      // The booking row is created on the Processing screen once the
      // request is confirmed — this step validates the review details.
      navigation.navigate('Processing', {
        bookingData: {
          ambulance,
          pickup,
          destination,
          patientName,
          patientAge,
          patientCondition,
          patientPhone,
          paymentMethod,
          emergencyLevel: ambulance?.category === 'icu' ? 'high' : 'medium',
          fareBreakdown: fare,
          totalFare: fare.totalFare,
        },
      });
    } catch {
      Alert.alert('Error', 'Failed to create booking. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel Booking',
      'Are you sure you want to cancel this booking?',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Yes', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirm Booking</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
        {/* Trip Details */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Trip Details</Text>
          <View style={styles.tripRow}>
            <View style={[styles.tripDot, styles.tripDotGreen]} />
            <View style={styles.tripContent}>
              <Text style={styles.tripLabel}>Pickup</Text>
              <Text style={styles.tripValue}>{pickup?.address || 'Current Location'}</Text>
            </View>
          </View>
          <View style={styles.tripLine} />
          <View style={styles.tripRow}>
            <View style={[styles.tripDot, styles.tripDotRed]} />
            <View style={styles.tripContent}>
              <Text style={styles.tripLabel}>Destination</Text>
              <Text style={styles.tripValue}>{destination?.address || 'Not specified'}</Text>
            </View>
          </View>
          <View style={styles.tripMeta}>
            <Text style={styles.tripMetaText}>
              📏 {ambulance?.distanceKm ? `${Number(ambulance.distanceKm).toFixed(1)} km` : 'Distance not recorded'}
            </Text>
          </View>
        </Card>

        {/* Ambulance Details */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Ambulance Details</Text>
          <View style={styles.ambulanceRow}>
            <Text style={styles.ambulanceIcon}>🚑</Text>
            <View style={styles.ambulanceInfo}>
              <Text style={styles.ambulanceModel}>{ambulance?.model || 'Model not recorded'}</Text>
              <Text style={styles.ambulancePlate}>{ambulance?.plate_number || 'Plate not recorded'}</Text>
            </View>
            <Badge
              label={ambulance?.category === 'icu' ? 'ICU' : 'Basic'}
              variant={ambulance?.category === 'icu' ? 'error' : 'success'}
            />
          </View>
          <View style={styles.equipmentSummary}>
            <Text style={styles.equipmentLabel}>Equipment:</Text>
            <Text style={styles.equipmentText}>
              {ambulance?.equipment?.slice(0, 3).join(', ') || 'Not recorded'}
            </Text>
          </View>
        </Card>

        {/* Fare Breakdown */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Fare Breakdown</Text>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Base fare</Text>
            <Text style={styles.fareValue}>NPR {fare.baseFare.toFixed(0)}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Distance charge</Text>
            <Text style={styles.fareValue}>NPR {fare.distanceCharge.toFixed(0)}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Service fee</Text>
            <Text style={styles.fareValue}>NPR {fare.serviceFee.toFixed(0)}</Text>
          </View>
          <View style={styles.fareDivider} />
          <View style={styles.fareRow}>
            <Text style={styles.fareTotalLabel}>Estimated total</Text>
            <Text style={styles.fareTotalValue}>NPR {fare.totalFare.toFixed(0)}</Text>
          </View>
          <Text style={styles.fareNote}>
            Indicative rate card estimate — the final fare may change with actual distance and
            waiting time.
          </Text>
        </Card>

        {/* Payment Method */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Payment Method</Text>
          {PAYMENT_METHODS.map((method) => (
            <TouchableOpacity
              key={method.key}
              style={[
                styles.paymentOption,
                paymentMethod === method.key && styles.paymentOptionActive,
              ]}
              onPress={() => setPaymentMethod(method.key)}
            >
              <Text style={styles.paymentIcon}>{method.icon}</Text>
              <Text style={styles.paymentLabel}>{method.label}</Text>
              <View style={[
                styles.radioButton,
                paymentMethod === method.key && styles.radioButtonActive,
              ]}>
                {paymentMethod === method.key && <View style={styles.radioButtonInner} />}
              </View>
            </TouchableOpacity>
          ))}
        </Card>

        {/* Patient Details */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Patient Details</Text>
          <Input
            label="Patient Name *"
            placeholder="Enter patient name"
            value={patientName}
            onChangeText={setPatientName}
          />
          <Input
            label="Age"
            placeholder="Enter age"
            value={patientAge}
            onChangeText={setPatientAge}
            keyboardType="numeric"
          />
          <Input
            label="Condition (Optional)"
            placeholder="Describe patient condition"
            value={patientCondition}
            onChangeText={setPatientCondition}
            multiline
            numberOfLines={3}
          />
          <Input
            label="Contact Number"
            placeholder="+977-98XXXXXXXX"
            value={patientPhone}
            onChangeText={setPatientPhone}
            keyboardType="phone-pad"
          />
        </Card>

        {/* Bottom spacing */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom Actions */}
      <View style={styles.bottomBar}>
        <Button
          title="Confirm Booking"
          onPress={handleConfirmBooking}
          fullWidth
          size="lg"
          loading={isSubmitting}
          disabled={isSubmitting}
        />
        <Button
          title="Cancel"
          onPress={handleCancel}
          variant="ghost"
          fullWidth
          style={styles.cancelButton}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 24,
    color: colors.text,
  },
  headerTitle: {
    ...typography.h3,
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.text,
    marginBottom: spacing.md,
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  tripDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  tripDotGreen: {
    backgroundColor: colors.success,
  },
  tripDotRed: {
    backgroundColor: colors.primary,
  },
  tripLine: {
    width: 2,
    height: 20,
    backgroundColor: colors.border,
    marginLeft: 5,
    marginVertical: 2,
  },
  tripContent: {
    flex: 1,
  },
  tripLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  tripValue: {
    ...typography.body,
    color: colors.text,
    marginTop: 2,
  },
  tripMeta: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tripMetaText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  ambulanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  ambulanceIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  ambulanceInfo: {
    flex: 1,
  },
  ambulanceModel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  ambulancePlate: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  equipmentSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  equipmentLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginRight: spacing.sm,
  },
  equipmentText: {
    ...typography.bodySmall,
    color: colors.text,
    flex: 1,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  fareLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  fareValue: {
    ...typography.body,
    color: colors.text,
  },
  fareDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  fareNote: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  fareTotalLabel: {
    ...typography.h4,
    color: colors.text,
  },
  fareTotalValue: {
    ...typography.h3,
    color: colors.primary,
  },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.input,
  },
  paymentOptionActive: {
    backgroundColor: colors.redLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  paymentIcon: {
    fontSize: 20,
    marginRight: spacing.md,
  },
  paymentLabel: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonActive: {
    borderColor: colors.primary,
  },
  radioButtonInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  cancelButton: {
    marginTop: spacing.xs,
  },
});

export default BookingConfirmationScreen;
