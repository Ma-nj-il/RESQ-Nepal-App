import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Header, Toggle } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { NOTIFICATION_PREFS_KEY } from '../../constants/storage';

interface NotificationSetting {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

const defaultSettings: NotificationSetting[] = [
  { id: 'general', label: 'General Updates', description: 'News and updates about our services', enabled: true },
  { id: 'safety', label: 'Safety and Security Alerts', description: 'Critical safety notifications', enabled: true },
  { id: 'account', label: 'Account Notifications', description: 'Account activity and changes', enabled: true },
  { id: 'ride', label: 'Ride Status Updates', description: 'Real-time ride tracking updates', enabled: true },
  { id: 'promo', label: 'Promo Alerts', description: 'Special offers and promotions', enabled: false },
  { id: 'rating', label: 'Rating and Reviews', description: 'Reminders to rate your rides', enabled: true },
  { id: 'recommendations', label: 'Personalized Recommendations', description: 'Suggestions based on your activity', enabled: false },
  { id: 'app_updates', label: 'App Updates', description: 'New features and improvements', enabled: true },
  { id: 'service_updates', label: 'Service Updates', description: 'Service availability changes', enabled: true },
  { id: 'community', label: 'Community Forum Activity', description: 'Responses to your posts', enabled: false },
  { id: 'survey', label: 'Survey and Feedback Requests', description: 'Help us improve with your feedback', enabled: false },
  { id: 'announcements', label: 'Important Announcements', description: 'Urgent system notifications', enabled: true },
  { id: 'tips', label: 'App Tips and Tutorials', description: 'Learn new features and tips', enabled: false },
];

export const NotificationsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [settings, setSettings] = useState<NotificationSetting[]>(defaultSettings);

  // Load saved preferences; fall back to the defaults on first run.
  useEffect(() => {
    AsyncStorage.getItem(NOTIFICATION_PREFS_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Record<string, boolean>;
        setSettings((prev) =>
          prev.map((s) => (s.id in saved ? { ...s, enabled: saved[s.id] } : s))
        );
      })
      .catch(() => {
        // Keep defaults if the saved value cannot be read.
      });
  }, []);

  const handleToggle = useCallback((id: string) => {
    setSettings((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
      const prefs: Record<string, boolean> = {};
      next.forEach((s) => {
        prefs[s.id] = s.enabled;
      });
      AsyncStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
      return next;
    });
  }, []);

  const enabledCount = settings.filter((s) => s.enabled).length;

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Notifications" showBack onBack={() => navigation.goBack()} />

      {/* Summary */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryText}>
          {enabledCount} of {settings.length} notifications enabled
        </Text>
        <Text style={styles.settingDescription}>
          Preferences are stored on this device. Push delivery is not enabled in this build.
        </Text>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.settingsList}>
          {settings.map((setting) => (
            <View key={setting.id} style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>{setting.label}</Text>
                <Text style={styles.settingDescription}>{setting.description}</Text>
              </View>
              <Toggle value={setting.enabled} onValueChange={() => handleToggle(setting.id)} />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  summaryCard: {
    backgroundColor: colors.blueLight,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  summaryText: { ...typography.bodySmall, color: colors.info, fontWeight: '600' },
  scrollView: { flex: 1, marginTop: spacing.md },
  settingsList: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingInfo: { flex: 1, marginRight: spacing.md },
  settingLabel: { ...typography.body, fontWeight: '600' },
  settingDescription: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
});
