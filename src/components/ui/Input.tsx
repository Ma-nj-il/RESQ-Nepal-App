import React from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps} from 'react-native';
import { colors, spacing, typography, radii } from '../../constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  icon,
  rightElement,
  style,
  accessibilityLabel,
  accessibilityState,
  ...props
}) => {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label} accessible={false}>{label}</Text>}
      <View style={[styles.inputContainer, error && { borderColor: colors.error }, style]}>
        {icon && <View style={styles.icon}>{icon}</View>}
        <TextInput
          style={styles.input}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={{ ...accessibilityState, disabled: accessibilityState?.disabled ?? props.editable === false }}
          {...props}
        />
        {rightElement}
      </View>
      {error && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  label: { ...typography.bodySmall, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  icon: { marginRight: spacing.sm },
  input: { flex: 1, paddingVertical: spacing.md, fontSize: 16, color: colors.text },
  error: { color: colors.error, fontSize: 12, marginTop: spacing.xs },
});
