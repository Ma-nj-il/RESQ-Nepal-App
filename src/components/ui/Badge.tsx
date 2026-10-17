import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, spacing,  radii } from '../../constants/theme';

interface BadgeProps {
  label: string;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';
  style?: ViewStyle;
}

export const Badge: React.FC<BadgeProps> = ({ label, variant = 'neutral', style }) => {
  const variantStyle = {
    success: { backgroundColor: colors.greenLight, color: colors.success },
    warning: { backgroundColor: colors.amberLight, color: colors.warning },
    error: { backgroundColor: colors.redLight, color: colors.error },
    info: { backgroundColor: colors.blueLight, color: colors.info },
    neutral: { backgroundColor: colors.input, color: colors.textSecondary },
    primary: { backgroundColor: colors.redLight, color: colors.primary },
  }[variant];

  return (
    <View style={[styles.badge, { backgroundColor: variantStyle.backgroundColor }, style]}>
      <Text style={[styles.text, { color: variantStyle.color }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.full, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '600' },
});
