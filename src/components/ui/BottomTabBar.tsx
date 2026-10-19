import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography } from '../../constants/theme';

export type TabKey = 'home' | 'ambulances' | 'activity' | 'account';

const TABS: { key: TabKey; label: string; icon: string; route: string }[] = [
  { key: 'home', label: 'Home', icon: '🏠', route: 'Home' },
  { key: 'ambulances', label: 'Ambulances', icon: '🚑', route: 'AmbulanceList' },
  { key: 'activity', label: 'Activity', icon: '📋', route: 'Activity' },
  { key: 'account', label: 'Account', icon: '👤', route: 'Account' },
];

interface BottomTabBarProps {
  active: TabKey;
}

/**
 * Shared bottom navigation for the user area (Home / Ambulances / Activity /
 * Account). Kept as one component so the three screens cannot drift apart.
 */
export const BottomTabBar: React.FC<BottomTabBarProps> = ({ active }) => {
  const navigation = useNavigation<any>();

  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.item}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
            onPress={() => {
              if (!isActive) navigation.navigate(tab.route);
            }}
          >
            <Text style={[styles.icon, isActive && styles.iconActive]}>{tab.icon}</Text>
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
            <View style={[styles.indicator, isActive && styles.indicatorActive]} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.sm,
    minHeight: 52,
  },
  icon: { fontSize: 22, marginBottom: 2, opacity: 0.55 },
  iconActive: { opacity: 1 },
  label: { ...typography.caption, color: colors.textTertiary },
  labelActive: { color: colors.primary, fontWeight: '700' },
  indicator: { height: 3, width: 24, borderRadius: 2, marginTop: 3, backgroundColor: 'transparent' },
  indicatorActive: { backgroundColor: colors.primary },
});
