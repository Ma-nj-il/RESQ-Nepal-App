import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../constants/theme';

export interface TimelineStep {
  key: string;
  label: string;
  icon: string;
}

interface TripTimelineProps {
  steps: TimelineStep[];
  /** Index of the step currently in progress; -1 when none. */
  currentIndex: number;
  /** Terminal failure state (e.g. request rejected) marks the first step. */
  failed?: boolean;
  failedLabel?: string;
}

/**
 * Vertical trip/booking timeline. Steps before `currentIndex` are completed,
 * the current step is highlighted, the rest stay muted. A failed booking
 * marks the whole rail red instead of pretending progress.
 */
export const TripTimeline: React.FC<TripTimelineProps> = ({
  steps,
  currentIndex,
  failed,
  failedLabel,
}) => {
  return (
    <View style={styles.container}>
      {steps.map((step, index) => {
        const isCompleted = !failed && index < currentIndex;
        const isCurrent = !failed && index === currentIndex;
        const isFailedHead = failed && index === 0;

        return (
          <View key={step.key} style={styles.item}>
            <View style={styles.left}>
              <View
                style={[
                  styles.icon,
                  isCompleted && styles.iconCompleted,
                  isCurrent && styles.iconCurrent,
                  isFailedHead && styles.iconFailed,
                ]}
              >
                <Text style={[styles.iconGlyph, isCompleted && styles.iconGlyphCompleted]}>
                  {isCompleted ? '✓' : step.icon}
                </Text>
              </View>
              {index < steps.length - 1 && (
                <View style={[styles.line, isCompleted && styles.lineCompleted]} />
              )}
            </View>
            <View style={styles.content}>
              <Text
                style={[
                  styles.label,
                  isCurrent && styles.labelCurrent,
                  isCompleted && styles.labelCompleted,
                  isFailedHead && styles.labelFailed,
                ]}
              >
                {step.label}
              </Text>
              {isCurrent && (
                <Text style={styles.hint}>In progress…</Text>
              )}
              {isFailedHead && failedLabel ? (
                <Text style={styles.failedHint}>{failedLabel}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingLeft: spacing.xs },
  item: { flexDirection: 'row' },
  left: { alignItems: 'center', marginRight: spacing.md },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 15 },
  iconGlyphCompleted: { color: colors.surface, fontWeight: '800' },
  iconCompleted: { backgroundColor: colors.success },
  iconCurrent: { backgroundColor: colors.primary },
  iconFailed: { backgroundColor: colors.error },
  line: { width: 2, flex: 1, minHeight: 14, backgroundColor: colors.border, marginVertical: 2 },
  lineCompleted: { backgroundColor: colors.success },
  content: { flex: 1, paddingTop: 5, paddingBottom: spacing.md },
  label: { ...typography.body, color: colors.textSecondary },
  labelCurrent: { color: colors.primary, fontWeight: '700' },
  labelCompleted: { color: colors.text },
  labelFailed: { color: colors.error, fontWeight: '700' },
  hint: { ...typography.caption, color: colors.primary, marginTop: 2 },
  failedHint: { ...typography.caption, color: colors.error, marginTop: 2 },
});
