import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography } from '../../constants/theme';

interface DriverNavigationHeaderProps {
  title: string;
  showBack?: boolean;
}

const DriverNavigationHeader: React.FC<DriverNavigationHeaderProps> = ({
  title,
  showBack = false,
}) => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  return (
    <View style={styles.container}>
      {showBack && (
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Text style={styles.icon}>‹</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={() => navigation.navigate('DriverDrawer')}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel="Open driver menu"
        hitSlop={8}
      >
        <Text style={styles.icon}>☰</Text>
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  action: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 24, color: colors.text },
  title: {
    ...typography.h4,
    color: colors.text,
    marginLeft: spacing.md,
    flex: 1,
  },
});

export default DriverNavigationHeader;
