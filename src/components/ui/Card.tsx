import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors, spacing, radii, shadows } from '../../constants/theme';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  elevation?: 'sm' | 'md' | 'lg';
  onPress?: () => void;
}

export const Card: React.FC<CardProps> = ({ children, style, elevation = 'sm', onPress }) => {
  const shadow = shadows[elevation];
  if (onPress) {
    return (
      <View onTouchEnd={onPress} style={[styles.card, shadow, style]}>
        {children}
      </View>
    );
  }
  return <View style={[styles.card, shadow, style]}>{children}</View>;
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
});
