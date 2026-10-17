import React from 'react';
import { TouchableOpacity, Text,  ActivityIndicator, ViewStyle } from 'react-native';
import { colors, spacing, typography, radii } from '../../constants/theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  title, onPress, variant = 'primary', size = 'md', disabled, loading, icon, style, fullWidth
}) => {
  const baseStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    gap: spacing.sm,
    ...(fullWidth && { width: '100%' as any }),
  };
  const sizeStyle: ViewStyle = {
    sm: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
    md: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
    lg: { paddingVertical: spacing.lg, paddingHorizontal: spacing.xxl },
  }[size];
  const variantStyle: ViewStyle = {
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    outline: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.primary },
    ghost: { backgroundColor: 'transparent' },
    danger: { backgroundColor: colors.error },
  }[variant];
  const textColor = variant === 'primary' || variant === 'danger' ? colors.surface : variant === 'outline' ? colors.primary : colors.text;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[baseStyle, sizeStyle, variantStyle, (disabled || loading) && { opacity: 0.5 }, style]}
    >
      {loading ? <ActivityIndicator color={textColor} size="small" /> : icon}
      <Text style={[typography.button, { color: textColor, fontSize: size === 'sm' ? 14 : 16 }]}>{title}</Text>
    </TouchableOpacity>
  );
};
