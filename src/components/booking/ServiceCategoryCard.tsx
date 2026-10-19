import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { ServiceCategory } from '../../constants/serviceCategories';
import { FareBreakdown } from '../../constants/fares';

interface ServiceCategoryCardProps {
  category: ServiceCategory;
  /** Real rate-card estimate when a route distance is available. */
  estimate?: FareBreakdown | null;
  /** Rate-card starting price (always available). */
  startingPrice: number;
  /** Honest availability line, e.g. "2 ambulances listed" / "Availability not confirmed yet". */
  availability: string;
  /** Green dot when something is actually listed as available. */
  available?: boolean;
  onPress: () => void;
}

/**
 * One of the two RESQ Nepal service categories (Basic / ICU) as a selectable
 * card. Information shown is limited to what is actually known: the category
 * definition, the rate card, and the real availability line passed in.
 */
export const ServiceCategoryCard: React.FC<ServiceCategoryCardProps> = ({
  category,
  estimate,
  startingPrice,
  availability,
  available,
  onPress,
}) => {
  const accent = category.emergency ? colors.primaryDark : colors.success;
  const accentSoft = category.emergency ? colors.redLight : colors.greenLight;

  return (
    <TouchableOpacity
      style={[styles.card, category.emergency && styles.cardEmergency]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${category.name}. ${category.tagline}. ${availability}`}
    >
      <View style={styles.headerRow}>
        <View style={[styles.vehicleBadge, { backgroundColor: accentSoft }]}>
          <Text style={styles.vehicleIcon}>🚑</Text>
        </View>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.name}>{category.name}</Text>
            <View style={[styles.categoryBadge, { backgroundColor: accent }]}>
              <Text style={styles.categoryBadgeText}>{category.badge}</Text>
            </View>
          </View>
          <Text style={styles.tagline}>{category.tagline}</Text>
        </View>
      </View>

      <View style={styles.capabilityRow}>
        {category.capabilities.slice(0, 4).map((capability) => (
          <View key={capability} style={styles.capabilityChip}>
            <Text style={styles.capabilityText}>{capability}</Text>
          </View>
        ))}
        {category.capabilities.length > 4 && (
          <Text style={styles.moreText}>+{category.capabilities.length - 4} more</Text>
        )}
      </View>

      <View style={styles.footerRow}>
        <View style={styles.availability}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: available ? colors.success : colors.textTertiary },
            ]}
          />
          <Text style={styles.availabilityText}>{availability}</Text>
        </View>

        <View style={styles.fareBlock}>
          {estimate ? (
            <>
              <Text style={styles.fareValue}>~ NPR {estimate.totalFare.toLocaleString('en-IN')}</Text>
              <Text style={styles.fareNote}>indicative · rate card</Text>
            </>
          ) : (
            <>
              <Text style={styles.fareValue}>From NPR {startingPrice.toLocaleString('en-IN')}</Text>
              <Text style={styles.fareNote}>fare confirmed after trip</Text>
            </>
          )}
        </View>
      </View>

      <View style={[styles.selectButton, { backgroundColor: accent }]}>
        <Text style={styles.selectButtonText}>
          Select {category.key === 'icu' ? 'ICU ambulance' : 'Basic ambulance'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardEmergency: {
    borderColor: 'rgba(198, 40, 53, 0.35)',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  vehicleBadge: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  vehicleIcon: { fontSize: 28 },
  headerText: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.h4, color: colors.text, flexShrink: 1 },
  categoryBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  categoryBadgeText: { ...typography.caption, color: colors.surface, fontWeight: '700' },
  tagline: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },

  capabilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  capabilityChip: {
    backgroundColor: colors.input,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  capabilityText: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  moreText: { ...typography.caption, color: colors.textTertiary },

  footerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  availability: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  availabilityText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  fareBlock: { alignItems: 'flex-end' },
  fareValue: { ...typography.h4, color: colors.text },
  fareNote: { ...typography.caption, color: colors.textTertiary },

  selectButton: {
    borderRadius: radii.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  selectButtonText: { ...typography.buttonSmall, color: colors.surface, fontWeight: '700' },
});
