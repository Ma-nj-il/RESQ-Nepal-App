import React from 'react';
import { TouchableOpacity, View, StyleSheet} from 'react-native';
import { colors, radii } from '../../constants/theme';

interface ToggleProps {
  value: boolean;
  onValueChange: (val: boolean) => void;
}

export const Toggle: React.FC<ToggleProps> = ({ value, onValueChange }) => {
  return (
    <TouchableOpacity
      onPress={() => onValueChange(!value)}
      style={[styles.container, { backgroundColor: value ? colors.success : colors.disabled }]}
      activeOpacity={0.7}
    >
      <View style={[styles.circle, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { width: 48, height: 28, borderRadius: radii.full, padding: 2, justifyContent: 'center' },
  circle: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surface },
});
