import React, { useCallback } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card, Header } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { APP_VERSION } from '../../constants/appInfo';

interface SettingRowProps {
  icon: string;
  label: string;
  subtitle: string;
  onPress: () => void;
}

const SettingRow: React.FC<SettingRowProps> = ({ icon, label, subtitle, onPress }) => (
  <TouchableOpacity
    style={styles.row}
    onPress={onPress}
    activeOpacity={0.7}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityHint={subtitle}
  >
    <Text style={styles.rowIcon}>{icon}</Text>
    <View style={styles.rowTextWrap}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowSubtitle}>{subtitle}</Text>
    </View>
    <Text style={styles.rowChevron}>›</Text>
  </TouchableOpacity>
);

/**
 * Settings hub. Only genuinely implemented options are listed — sound and
 * haptic toggles do not exist in this build, so they are not shown.
 */
const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const openDeviceSettings = useCallback(() => {
    Linking.openSettings().catch(() => {
      Alert.alert(
        'Could not open settings',
        'Open your device Settings app, find RESQ Nepal and review the Location permission there.',
      );
    });
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Settings" showBack onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.groupLabel}>Preferences</Text>
        <Card elevation="sm" style={styles.groupCard}>
          <SettingRow
            icon="🔔"
            label="Notifications"
            subtitle="Booking updates, trip status and app alerts"
            onPress={() => navigation.navigate('Notifications')}
          />
          <SettingRow
            icon="🎨"
            label="App appearance"
            subtitle="Display options and their current limits"
            onPress={() => navigation.navigate('Appearance')}
          />
          <SettingRow
            icon="🌐"
            label="Language"
            subtitle="Nepali translations are planned — English only for now"
            onPress={() => navigation.navigate('Language')}
          />
        </Card>

        <Text style={styles.groupLabel}>Location &amp; security</Text>
        <Card elevation="sm" style={styles.groupCard}>
          <SettingRow
            icon="📍"
            label="Location permission"
            subtitle="Opens your device settings — RESQ Nepal only asks while you use it"
            onPress={openDeviceSettings}
          />
          <SettingRow
            icon="🔒"
            label="Account & Security"
            subtitle="Password, signed-in devices and account deletion"
            onPress={() => navigation.navigate('Security')}
          />
        </Card>

        <Text style={styles.groupLabel}>Legal &amp; information</Text>
        <Card elevation="sm" style={styles.groupCard}>
          <SettingRow
            icon="📄"
            label="Privacy Policy"
            subtitle="How your data is handled"
            onPress={() => navigation.navigate('PrivacyPolicy')}
          />
          <SettingRow
            icon="📝"
            label="Terms of Service"
            subtitle="The terms that apply to this app"
            onPress={() => navigation.navigate('TermsOfService')}
          />
          <SettingRow
            icon="ℹ️"
            label="About RESQ Nepal"
            subtitle={`Version ${APP_VERSION}`}
            onPress={() => navigation.navigate('About')}
          />
        </Card>

        <Text style={styles.footnote}>
          Sound and haptic options are not implemented in this build, so no toggles are shown for
          them. Text size follows your device settings automatically.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

export default SettingsScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  groupLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  groupCard: { paddingHorizontal: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  rowIcon: { fontSize: 18, width: 30, textAlign: 'center' },
  rowTextWrap: { flex: 1, marginRight: spacing.sm },
  rowLabel: { ...typography.body, color: colors.text },
  rowSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowChevron: { fontSize: 20, color: colors.textTertiary },
  footnote: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xl },
});
