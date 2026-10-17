import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { Badge, Button, Avatar, Card } from '../../components/ui';
import { estimateFare } from '../../constants/fares';
import { Ambulance } from '../../types';

interface AmbulanceWithDriver extends Ambulance {
  driverName?: string;
  driverRating?: number;
  driverTotalRides?: number;
  driverPhone?: string;
  price?: number;
}

const AmbulanceDetailsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const ambulance: AmbulanceWithDriver | undefined = route.params?.ambulance;

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
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          <Text style={styles.sectionTitle}>No ambulance selected</Text>
          <Text style={{ ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm }}>
            Go back and choose an ambulance from the list.
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

  const handleBookNow = () => {
    navigation.navigate('BookingConfirmation', { ambulance });
  };

  const fare = estimateFare(ambulance.category);

  const getEquipmentDetails = (equipment: string[]) => {
    return equipment.map((item) => {
      const lower = item.toLowerCase();
      let icon = '🏥';
      let description = item;

      if (lower.includes('oxygen')) {
        icon = '🫁';
        description = 'Medical-grade oxygen supply';
      } else if (lower.includes('stretcher')) {
        icon = '🛏️';
        description = 'Adjustable patient stretcher';
      } else if (lower.includes('ventilator')) {
        icon = '💨';
        description = 'Emergency ventilator support';
      } else if (lower.includes('defibrillator')) {
        icon = '⚡';
        description = 'AED defibrillator';
      } else if (lower.includes('cardiac') || lower.includes('monitor')) {
        icon = '💓';
        description = 'Cardiac monitoring system';
      } else if (lower.includes('first aid')) {
        icon = '🩹';
        description = 'Complete first aid kit';
      }

      return { name: item, icon, description };
    });
  };

  const equipmentDetails = getEquipmentDetails(ambulance.equipment);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ambulance Details</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
        {/* Vehicle Image Placeholder */}
        <View style={styles.imageContainer}>
          <View style={styles.imagePlaceholder}>
            <Text style={styles.vehicleEmoji}>🚑</Text>
            <Text style={styles.vehicleModel}>{ambulance.model}</Text>
            <Text style={styles.vehiclePlate}>{ambulance.plate_number}</Text>
          </View>
          <Badge
            label={ambulance.category === 'icu' ? 'ICU' : 'Basic'}
            variant={ambulance.category === 'icu' ? 'error' : 'success'}
            style={styles.categoryBadge}
          />
        </View>

        {/* Driver Info Card — only real data is shown. Driver identity is
            shared with passengers after assignment; when it is not available
            yet the card says so instead of inventing a driver. */}
        <Card style={styles.driverCard} elevation="md">
          <Text style={styles.sectionTitle}>Driver Information</Text>
          <View style={styles.driverRow}>
            <Avatar name={ambulance.driverName || 'D'} size="lg" />
            <View style={styles.driverInfo}>
              <View style={styles.driverNameRow}>
                <Text style={styles.driverName}>{ambulance.driverName || 'Driver'}</Text>
              </View>
              {ambulance.driverRating != null ? (
                <View style={styles.ratingRow}>
                  <Text style={styles.star}>★</Text>
                  <Text style={styles.ratingText}>{ambulance.driverRating}</Text>
                  {ambulance.driverTotalRides != null && (
                    <Text style={styles.ridesText}>({ambulance.driverTotalRides} rides)</Text>
                  )}
                </View>
              ) : (
                <Text style={styles.ridesText}>Driver details are shared after assignment</Text>
              )}
              {ambulance.driverPhone && (
                <Text style={styles.phoneText}>📞 {ambulance.driverPhone}</Text>
              )}
            </View>
          </View>
        </Card>

        {/* Equipment List */}
        <Card style={styles.equipmentCard} elevation="md">
          <Text style={styles.sectionTitle}>Equipment & Facilities</Text>
          {equipmentDetails.map((item, index) => (
            <View key={index} style={styles.equipmentItem}>
              <Text style={styles.equipmentIcon}>{item.icon}</Text>
              <View style={styles.equipmentContent}>
                <Text style={styles.equipmentName}>{item.name}</Text>
                <Text style={styles.equipmentDescription}>{item.description}</Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Hospital Affiliation */}
        {ambulance.hospital_affiliation && (
          <Card style={styles.hospitalCard} elevation="md">
            <Text style={styles.sectionTitle}>Hospital Affiliation</Text>
            <View style={styles.hospitalRow}>
              <Text style={styles.hospitalIcon}>🏥</Text>
              <Text style={styles.hospitalName}>{ambulance.hospital_affiliation}</Text>
            </View>
          </Card>
        )}

        {/* Fare Estimate */}
        <Card style={styles.fareCard} elevation="md">
          <Text style={styles.sectionTitle}>Fare Estimate</Text>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Base fare</Text>
            <Text style={styles.fareValue}>NPR {fare.baseFare.toLocaleString('en-IN')}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Distance charge</Text>
            <Text style={styles.fareValue}>NPR {fare.distanceCharge.toLocaleString('en-IN')}</Text>
          </View>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Service fee</Text>
            <Text style={styles.fareValue}>NPR {fare.serviceFee.toLocaleString('en-IN')}</Text>
          </View>
          <View style={styles.fareDivider} />
          <View style={styles.fareRow}>
            <Text style={styles.fareTotalLabel}>Estimated Total</Text>
            <Text style={styles.fareTotalValue}>NPR {fare.totalFare.toLocaleString('en-IN')}</Text>
          </View>
          <Text style={styles.fareNote}>
            Indicative rate card estimate for a {ambulance.category === 'icu' ? 'ICU / Emergency' : 'Basic'} ambulance — final fare may vary with actual distance and waiting time.
          </Text>
        </Card>

        {/* Bottom spacing for button */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Book Now Button */}
      <View style={styles.bottomBar}>
        <Button
          title="Book Now"
          onPress={handleBookNow}
          fullWidth
          size="lg"
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
  vehicleEmoji: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  vehicleModel: {
    ...typography.h2,
    color: colors.text,
  },
  vehiclePlate: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  categoryBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
  },
  driverCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.text,
    marginBottom: spacing.md,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  driverNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  driverName: {
    ...typography.h4,
    color: colors.text,
  },
  verifiedBadge: {
    ...typography.caption,
    color: colors.success,
    backgroundColor: colors.greenLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  star: {
    fontSize: 16,
    color: colors.warning,
  },
  ratingText: {
    ...typography.body,
    color: colors.text,
    marginLeft: 4,
  },
  ridesText: {
    ...typography.caption,
    color: colors.textTertiary,
    marginLeft: 4,
  },
  phoneText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  equipmentCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  equipmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  equipmentIcon: {
    fontSize: 24,
    marginRight: spacing.md,
  },
  equipmentContent: {
    flex: 1,
  },
  equipmentName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  equipmentDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  hospitalCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  hospitalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  hospitalIcon: {
    fontSize: 24,
  },
  hospitalName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  fareCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
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
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

export default AmbulanceDetailsScreen;
