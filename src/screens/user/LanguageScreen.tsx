import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Header } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { LANGUAGE_KEY } from '../../constants/storage';

const languages = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Espanol' },
  { code: 'zh', name: 'Mandarin Chinese', nativeName: '中文' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Portugues' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'fr', name: 'French', nativeName: 'Francais' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
];

export const LanguageScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [selectedCode, setSelectedCode] = useState('en');

  // Restore the previous choice (stored on this device).
  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_KEY)
      .then((code) => {
        if (code) setSelectedCode(code);
      })
      .catch(() => {
        // Keep the default.
      });
  }, []);

  const handleSelect = useCallback((code: string) => {
    setSelectedCode(code);
    // Preference is stored on this device and will apply once translations
    // are added — the interface itself is English-only in this build.
    AsyncStorage.setItem(LANGUAGE_KEY, code).catch(() => {});
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Header title="App Language" showBack onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Honest notice: no translated interface exists yet. */}
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>
            The interface is currently available in English only. Your selection is remembered
            on this device and will apply when translations are released.
          </Text>
        </View>

        <View style={styles.listContainer}>
          {languages.map((lang, index) => (
            <TouchableOpacity
              key={lang.code}
              style={[styles.langRow, index < languages.length - 1 && styles.langRowBorder]}
              activeOpacity={0.7}
              onPress={() => handleSelect(lang.code)}
            >
              <View style={styles.langInfo}>
                <Text style={styles.langName}>{lang.name}</Text>
                <Text style={styles.langNative}>{lang.nativeName}</Text>
              </View>
              {selectedCode === lang.code && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  noticeCard: {
    backgroundColor: colors.blueLight,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  noticeText: { ...typography.bodySmall, color: colors.text, lineHeight: 18 },
  listContainer: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radii.lg,
    overflow: 'hidden',
    marginBottom: spacing.xxxl,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  langRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  langInfo: { flex: 1 },
  langName: { ...typography.body, fontWeight: '600' },
  langNative: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  checkmark: { color: colors.primary, fontSize: 20, fontWeight: '700' },
});
