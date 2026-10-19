import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button, Input, Card, Badge } from '../../components/ui';
import { RouteSummary } from '../../components/booking/RouteSummary';
import { useBookingStore } from '../../store/bookingStore';
import { useAuthStore } from '../../store/authStore';
import { estimateFare, startingPrice } from '../../constants/fares';
import { SERVICE_CATEGORIES } from '../../constants/serviceCategories';
import { formatKm, straightLineKm } from '../../utils/geo';

const BookingConfirmationScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const ambulance = route.params?.ambulance;
  const { pickup, destination } = useBookingStore();
  const { user } = useAuthStore();

  // Cash is the only supported payment method in this version.
  const paymentMethod = 'cash' as const;

  // Who the ambulance is requested for. "For someone else" keeps the pickup
  // exactly where the requester set it — the device location is never swapped
  // in automatically.
  const [bookingFor, setBookingFor] = useState<'self' | 'other'>('self');
  const [patientName, setPatientName] = useState(() => user?.full_name?.trim() ?? '');
  const [patientAge, setPatientAge] = useState('');
  const [patientCondition, setPatientCondition] = useState('');
  const [patientPhone, setPatientPhone] = useState(user?.phone ?? '');
  const [caregiverName, setCaregiverName] = useState('');
  const [caregiverPhone, setCaregiverPhone] = useState('');
  const [pickupNotes, setPickupNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const selectBookingFor = (value: 'self' | 'other') => {
    setBookingFor(value);
    if (value === 'self' && !patientName.trim() && user?.full_name) {
      setPatientName(user.full_name);
    }
  };

  const routeDistanceKm = useMemo(() => {
    if (pickup?.lat == null || pickup?.lng == null || destination?.lat == null || destination?.lng == null) {
      return null;
    }
    return straightLineKm(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: destination.lat, lng: destination.lng },
    );
  }, [pickup, destination]);

  const fare = estimateFare(ambulance?.category ?? 'basic', routeDistanceKm);
  const fromPrice = startingPrice(ambulance?.category ?? 'basic');
  const category = SERVICE_CATEGORIES[(ambulance?.category ?? 'basic') as 'basic' | 'icu'];

  const handleConfirmBooking = async () => {
    // Guard against double taps creating two requests.
    if (submittingRef.current || isSubmitting) return;

    if (!pickup) {
      Alert.alert('Pickup required', 'Set your pickup location before confirming.');
      return;
    }
    if (!destination) {
      Alert.alert('Destination required', 'Choose the hospital or destination before confirming.');
      return;
    }
    if (!patientName.trim()) {
      Alert.alert('Missing information', 'Please enter the patient name.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    // Anything the crew needs beyond the standard fields goes into the
    // booking's existing `notes` column — no invented schema, nothing hidden.
    const notesParts = [
      bookingFor === 'other' ? 'Requested for someone else' : null,
      caregiverName.trim() ? `Caregiver: ${caregiverName.trim()}` : null,
      caregiverPhone.trim() ? `Caregiver phone: ${caregiverPhone.trim()}` : null,
      pickupNotes.trim() ? `Pickup instructions: ${pickupNotes.trim()}` : null,
    ].filter((part): part is string => Boolean(part));
    const notes = notesParts.length > 0 ? notesParts.join(' · ') : undefined;

    try {
      navigation.navigate('Processing', {
        bookingData: {
          ambulance,
          pickup,
          destination,
          bookingFor,
          patientName: patientName.trim(),
          patientAge: patientAge.trim(),
          patientCondition: patientCondition.trim(),
          patientPhone: patientPhone.trim(),
          notes,
          paymentMethod,
          emergencyLevel: ambulance?.category === 'icu' ? 'high' : 'medium',
          fareBreakdown: fare,
          totalFare: fare?.totalFare ?? null,
        },
      });
    } catch {
      submittingRef.current = false;
      setIsSubmitting(false);
      Alert.alert('Error', 'Could not start the booking. Please try again.');
      return;
    }
    // The Processing screen owns the request from here.
    setTimeout(() => {
      submittingRef.current = false;
      setIsSubmitting(false);
    }, 800);
  };

  const handleCancel = () => {
    Alert.alert('Cancel booking', 'Discard this booking request?', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirm Booking</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView} keyboardShouldPersistTaps="handled">
        <View style={styles.summaryWrap}>
          <RouteSummary
            pickup={pickup}
            destination={destination}
            onEditPickup={() => navigation.navigate('LocationSearch', { mode: 'pickup' })}
            onEditDestination={() => navigation.navigate('LocationSearch', { mode: 'destination' })}
            meta={routeDistanceKm ? `Approx. ${formatKm(routeDistanceKm)} straight line` : null}
          />
        </View>

        {/* Service */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Ambulance Service</Text>
          <View style={styles.ambulanceRow}>
            <Text style={styles.ambulanceIcon}>🚑</Text>
            <View style={styles.ambulanceInfo}>
              <Text style={styles.ambulanceModel}>
                {ambulance?.isCategoryOption
                  ? category.name
                  : ambulance?.model || category.name}
              </Text>
              <Text style={styles.ambulancePlate}>
                {ambulance?.isCategoryOption
                  ? 'Vehicle assigned after confirmation'
                  : ambulance?.plate_number || 'Plate not recorded'}
              </Text>
            </View>
            <Badge
              label={category.badge}
              variant={category.emergency ? 'error' : 'success'}
            />
          </View>
        </Card>

        {/* Fare */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Fare</Text>
          {fare ? (
            <>
              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>Base fare</Text>
                <Text style={styles.fareValue}>NPR {fare.baseFare.toFixed(0)}</Text>
              </View>
              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>Distance ({formatKm(fare.distanceKm)}, straight line)</Text>
                <Text style={styles.fareValue}>NPR {fare.distanceCharge.toFixed(0)}</Text>
              </View>
              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>Service fee</Text>
                <Text style={styles.fareValue}>NPR {fare.serviceFee.toFixed(0)}</Text>
              </View>
              <View style={styles.fareDivider} />
              <View style={styles.fareRow}>
                <Text style={styles.fareTotalLabel}>Indicative total</Text>
                <Text style={styles.fareTotalValue}>NPR {fare.totalFare.toFixed(0)}</Text>
              </View>
              <Text style={styles.fareNote}>
                Rate-card estimate — the final fare is confirmed after the trip and paid in cash to
                the crew.
              </Text>
            </>
          ) : (
            <View style={styles.pendingRow}>
              <Text style={styles.pendingIcon}>🧾</Text>
              <View style={styles.pendingTextWrap}>
                <Text style={styles.pendingTitle}>Fare confirmed after the trip</Text>
                <Text style={styles.pendingText}>
                  An indicative estimate needs both locations on the map. Rates start from NPR{' '}
                  {fromPrice.toLocaleString('en-IN')} for {category.name}. Pay the final fare in cash
                  to the crew.
                </Text>
              </View>
            </View>
          )}
        </Card>

        {/* Patient */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Patient Details</Text>
          <View style={styles.forRow}>
            {(['self', 'other'] as const).map((value) => {
              const selected = bookingFor === value;
              const label = value === 'self' ? 'For myself' : 'For someone else';
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.forOption, selected && styles.forOptionSelected]}
                  onPress={() => selectBookingFor(value)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                >
                  <Text style={[styles.forOptionText, selected && styles.forOptionTextSelected]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.forHint}>
            {bookingFor === 'self'
              ? 'Booking for yourself — the crew drives to the pickup point above.'
              : 'The crew drives to the pickup point above. Your phone location is never used automatically for this booking.'}
          </Text>
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

          {bookingFor === 'other' && (
            <>
              <View style={styles.onSiteDivider} />
              <Text style={styles.onSiteTitle}>On-site contact (family or caregiver)</Text>
              <Input
                label="Contact Name"
                placeholder="Who is with the patient?"
                value={caregiverName}
                onChangeText={setCaregiverName}
              />
              <Input
                label="Contact Phone"
                placeholder="+977-98XXXXXXXX"
                value={caregiverPhone}
                onChangeText={setCaregiverPhone}
                keyboardType="phone-pad"
              />
              <Input
                label="Finding the patient (optional)"
                placeholder="Building, floor, landmark or gate instructions"
                value={pickupNotes}
                onChangeText={setPickupNotes}
                multiline
                numberOfLines={3}
              />
            </>
          )}
        </Card>

        <View style={{ height: 140 }} />
      </ScrollView>

      <View style={styles.bottomBar}>
        <Button
          title="Confirm Booking"
          onPress={handleConfirmBooking}
          fullWidth
          size="lg"
          loading={isSubmitting}
          disabled={isSubmitting}
        />
        <Button title="Cancel" onPress={handleCancel} variant="ghost" fullWidth style={styles.cancelButton} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h3, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 40 },
  scrollView: { flex: 1 },
  summaryWrap: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  card: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  sectionTitle: { ...typography.h4, color: colors.text, marginBottom: spacing.md },

  forRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  forOption: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.input,
    paddingHorizontal: spacing.sm,
  },
  forOptionSelected: { borderColor: colors.primary, backgroundColor: colors.redLight },
  forOptionText: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  forOptionTextSelected: { color: colors.primaryDark, fontWeight: '700' },
  forHint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
  onSiteDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  onSiteTitle: { ...typography.body, fontWeight: '700', color: colors.text, marginBottom: spacing.md },

  ambulanceRow: { flexDirection: 'row', alignItems: 'center' },
  ambulanceIcon: { fontSize: 32, marginRight: spacing.md },
  ambulanceInfo: { flex: 1 },
  ambulanceModel: { ...typography.body, fontWeight: '600', color: colors.text },
  ambulancePlate: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  fareLabel: { ...typography.body, color: colors.textSecondary, flex: 1, paddingRight: spacing.sm },
  fareValue: { ...typography.body, color: colors.text },
  fareDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  fareTotalLabel: { ...typography.h4, color: colors.text },
  fareTotalValue: { ...typography.h3, color: colors.primary },
  fareNote: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  pendingRow: { flexDirection: 'row', gap: spacing.md },
  pendingIcon: { fontSize: 26 },
  pendingTextWrap: { flex: 1 },
  pendingTitle: { ...typography.body, fontWeight: '700', color: colors.text },
  pendingText: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },

  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  cancelButton: { marginTop: spacing.xs },
});

export default BookingConfirmationScreen;
