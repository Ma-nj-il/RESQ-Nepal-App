import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Header, BottomSheet } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';

type ThemeOption = 'system' | 'light' | 'dark';

const themeOptions: { value: ThemeOption; label: string; icon: string }[] = [
  { value: 'system', label: 'System Default', icon: '📱' },
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark', label: 'Dark', icon: '🌙' },
];

export const AppearanceScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [selectedTheme, setSelectedTheme] = useState<ThemeOption>('light');
  const [selectedLanguage, ] = useState('English (US)');
  const [showThemeSheet, setShowThemeSheet] = useState(false);

  const handleThemeSelect = useCallback((theme: ThemeOption) => {
    setSelectedTheme(theme);
    setShowThemeSheet(false);
  }, []);

  const handleLanguagePress = useCallback(() => {
    navigation.navigate('Language');
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <Header title="App Appearance" showBack onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Theme Row */}
        <TouchableOpacity style={styles.menuRow} onPress={() => setShowThemeSheet(true)}>
          <View style={styles.menuLeft}>
            <Text style={styles.menuIcon}>🎨</Text>
            <View>
              <Text style={styles.menuLabel}>Theme</Text>
              <Text style={styles.menuValue}>
                {themeOptions.find((t) => t.value === selectedTheme)?.label || 'Light'}
              </Text>
            </View>
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>

        {/* Language Row */}
        <TouchableOpacity style={styles.menuRow} onPress={handleLanguagePress}>
          <View style={styles.menuLeft}>
            <Text style={styles.menuIcon}>🌐</Text>
            <View>
              <Text style={styles.menuLabel}>App Language</Text>
              <Text style={styles.menuValue}>{selectedLanguage}</Text>
            </View>
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>

        <Text style={[styles.menuValue, { marginHorizontal: spacing.lg, marginTop: spacing.md }]}>
          A full dark theme is not implemented in this build — choosing a theme does not change
          the app&apos;s colours yet.
        </Text>
      </ScrollView>

      {/* Theme Bottom Sheet */}
      <BottomSheet
        visible={showThemeSheet}
        onClose={() => setShowThemeSheet(false)}
        title="Choose Theme"
      >
        {themeOptions.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={styles.themeOption}
            onPress={() => handleThemeSelect(option.value)}
          >
            <Text style={styles.themeIcon}>{option.icon}</Text>
            <Text
              style={[
                styles.themeLabel,
                selectedTheme === option.value && styles.themeLabelSelected,
              ]}
            >
              {option.label}
            </Text>
            {selectedTheme === option.value && (
              <Text style={styles.checkmark}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </BottomSheet>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  menuLeft: { flexDirection: 'row', alignItems: 'center' },
  menuIcon: { fontSize: 24, marginRight: spacing.md },
  menuLabel: { ...typography.body, fontWeight: '600' },
  menuValue: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  arrow: { fontSize: 20, color: colors.textTertiary },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  themeIcon: { fontSize: 24, marginRight: spacing.md },
  themeLabel: { ...typography.body, flex: 1 },
  themeLabelSelected: { color: colors.primary, fontWeight: '600' },
  checkmark: { color: colors.primary, fontSize: 18, fontWeight: '700' },
});
