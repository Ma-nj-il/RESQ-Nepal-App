import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { RoutePoint } from '../../types';

interface RouteSummaryProps {
  pickup: RoutePoint | null;
  destination: RoutePoint | null;
  onEditPickup?: () => void;
  onEditDestination?: () => void;
  /** Optional meta line, e.g. "Approx. 5.2 km straight line". */
  meta?: string | null;
}

/**
 * Compact pickup → destination summary used on the ambulance list, booking
 * confirmation and status screens. Shows exactly the addresses the user
 * selected (or a clear "not selected" hint) plus optional edit actions.
 */
export const RouteSummary: React.FC<RouteSummaryProps> = ({
  pickup,
  destination,
  onEditPickup,
  onEditDestination,
  meta,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.rail}>
          <View style={[styles.dot, styles.dotPickup]} />
          <View style={styles.line} />
          <View style={[styles.dot, styles.dotDest]} />
        </View>

        <View style={styles.fields}>
          <TouchableOpacity
            style={styles.field}
            onPress={onEditPickup}
            disabled={!onEditPickup}
            activeOpacity={0.7}
            accessibilityRole={onEditPickup ? 'button' : undefined}
          >
            <Text style={styles.label}>Pickup</Text>
            <Text style={[styles.value, !pickup && styles.placeholder]} numberOfLines={1}>
              {pickup?.address || 'Tap to set pickup location'}
            </Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.field}
            onPress={onEditDestination}
            disabled={!onEditDestination}
            activeOpacity={0.7}
            accessibilityRole={onEditDestination ? 'button' : undefined}
          >
            <Text style={styles.label}>Destination</Text>
            <Text style={[styles.value, !destination && styles.placeholder]} numberOfLines={1}>
              {destination?.address || 'Tap to search hospital or destination'}
            </Text>
          </TouchableOpacity>
        </View>

        {(onEditPickup || onEditDestination) && (
          <Text style={styles.editHint}>Edit</Text>
        )}
      </View>

      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  row: { flexDirection: 'row' },
  rail: { alignItems: 'center', width: 20, paddingTop: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotPickup: { backgroundColor: colors.success },
  dotDest: { backgroundColor: colors.primary },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  fields: { flex: 1, marginLeft: spacing.sm },
  field: { paddingVertical: 6 },
  label: { ...typography.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  value: { ...typography.body, color: colors.text, marginTop: 1 },
  placeholder: { color: colors.textTertiary },
  divider: { height: 1, backgroundColor: colors.border },
  editHint: {
    ...typography.bodySmall,
    color: colors.primary,
    fontWeight: '700',
    alignSelf: 'center',
    marginLeft: spacing.sm,
  },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
});
