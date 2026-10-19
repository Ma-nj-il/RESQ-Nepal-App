import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { Badge, Button, Card } from '../../components/ui';
import { estimateFare, startingPrice } from '../../constants/fares';
import { useBookingStore } from '../../store/bookingStore';
import { formatKm, straightLineKm } from '../../utils/geo';
import { AmbulanceOption } from './AmbulanceListScreen';

const AmbulanceDetailsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const ambulance: AmbulanceOption | undefined = route.params?.ambulance;
  const { pickup, destination } = useBookingStore();

  const routeDistanceKm = useMemo(() => {
    if (pickup?.lat == null || pickup?.lng == null || destination?.lat == null || destination?.lng == null) {
      return null;
    }
    return straightLineKm(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: destination.lat, lng: destination.lng },
    );
  }, [pickup, destination]);

  // No fabricated fallback: without a selected ambulance there is nothing to
  // show, so send the user back to the list instead.
  if (!ambulance) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ambulance Details</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.emptyBox}>
          <Text style={styles.sectionTitle}>No ambulance selected</Text>
          <Text style={styles.emptyText}>
            Go back and choose a service category or an available ambulance.
          </Text>
          <Button
            title="Go Back"
            variant="outline"
            onPress={() => navigation.goBack()}
            style={{ marginTop: spacing.lg }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const isCategoryOption = Boolean(ambulance.isCategoryOption);
  const fare = estimateFare(ambulance.category, routeDistanceKm);
  const fromPrice = startingPrice(ambulance.category);

  const handleContinue = () => {
    navigation.navigate('BookingConfirmation', { ambulance });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isCategoryOption ? 'Service Details' : 'Ambulance Details'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
        {/* Hero */}
        <View style={styles.imageContainer}>
          <View style={styles.imagePlaceholder}>
            <Text style={styles.vehicleEmoji}>🚑</Text>
            <Text style={styles.vehicleModel}>{ambulance.model}</Text>
            {isCategoryOption ? (
              <Text style={styles.vehiclePlate}>Assigned from the verified fleet after confirmation</Text>
            ) : (
              <Text style={styles.vehiclePlate}>
                {ambulance.plate_number || 'Plate not recorded'}
              </Text>
            )}
          </View>
          <Badge
            label={ambulance.category === 'icu' ? 'ICU' : 'Basic'}
            variant={ambulance.category === 'icu' ? 'error' : 'success'}
            style={styles.categoryBadge}
          />
        </View>

        {!isCategoryOption && ambulance.hospital_affiliation ? (
          <Card style={styles.card} elevation="md">
            <Text style={styles.sectionTitle}>Hospital Affiliation</Text>
            <View style={styles.hospitalRow}>
              <Text style={styles.hospitalIcon}>🏥</Text>
              <Text style={styles.hospitalName}>{ambulance.hospital_affiliation}</Text>
            </View>
          </Card>
        ) : null}

        {/* Equipment — compact chips, no long per-item descriptions. */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Equipment</Text>
          <View style={styles.equipmentChips}>
            {ambulance.equipment.map((item, index) => (
              <View key={`${item}-${index}`} style={styles.equipmentChip}>
                <Text style={styles.equipmentChipText}>{item}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Fare */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Fare</Text>
          {fare ? (
            <>
              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>Base fare</Text>
                <Text style={styles.fareValue}>NPR {fare.baseFare.toLocaleString('en-IN')}</Text>
              </View>
              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>
                  Distance ({formatKm(fare.distanceKm)}, straight line)
                </Text>
                <Text style={styles.fareValue}>NPR {fare.distanceCharge.toLocaleString('en-IN')}</Text>
              </View>
              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>Service fee</Text>
                <Text style={styles.fareValue}>NPR {fare.serviceFee.toLocaleString('en-IN')}</Text>
              </View>
              <View style={styles.fareDivider} />
              <View style={styles.fareRow}>
                <Text style={styles.fareTotalLabel}>Indicative total</Text>
                <Text style={styles.fareTotalValue}>NPR {fare.totalFare.toLocaleString('en-IN')}</Text>
              </View>
              <Text style={styles.fareNote}>
                Rate-card estimate from the straight-line distance between your two points. The
                final fare is confirmed after the trip.
              </Text>
            </>
          ) : (
            <>
              <View style={styles.pendingRow}>
                <Text style={styles.pendingIcon}>🧾</Text>
                <View style={styles.pendingTextWrap}>
                  <Text style={styles.pendingTitle}>Fare confirmed after the trip</Text>
                  <Text style={styles.pendingText}>
                    Set both the pickup and destination locations to see an indicative estimate.
                    Rates start from NPR {fromPrice.toLocaleString('en-IN')} for{' '}
                    {ambulance.category === 'icu' ? 'ICU / Emergency' : 'Basic'} service.
                  </Text>
                </View>
              </View>
            </>
          )}
        </Card>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom Action */}
      <View style={styles.bottomBar}>
        <Button
          title={isCategoryOption ? 'Continue to Booking' : 'Book This Ambulance'}
          onPress={handleContinue}
          fullWidth
          size="lg"
        />
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
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },

  scrollView: { flex: 1 },
  imageContainer: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radii.lg,
    overflow: 'hidden',
    ...shadows.md,
  },
  imagePlaceholder: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleEmoji: { fontSize: 64, marginBottom: spacing.md },
  vehicleModel: { ...typography.h2, color: colors.text, textAlign: 'center', paddingHorizontal: spacing.lg },
  vehiclePlate: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  categoryBadge: { position: 'absolute', top: spacing.md, right: spacing.md },

  card: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  sectionTitle: { ...typography.h4, color: colors.text, marginBottom: spacing.sm },

  hospitalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  hospitalIcon: { fontSize: 24 },
  hospitalName: { ...typography.body, fontWeight: '600', color: colors.text, flex: 1 },

  equipmentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  equipmentChip: {
    backgroundColor: colors.input,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  equipmentChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '500' },

  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
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
  },
});

export default AmbulanceDetailsScreen;
