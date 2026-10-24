import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Toggle} from '../../components/ui';
import { colors, spacing, typography} from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/auth/authService';
import { supportRequestsService } from '../../services/database/supportRequests';
import { isSupabaseConfigured } from '../../services/database/client';
import DriverNavigationHeader from '../../components/driver/DriverNavigationHeader';

interface SettingsItem {
  id: string;
  icon: string;
  title: string;
  subtitle?: string;
  type: 'toggle' | 'link' | 'action';
  value?: boolean;
  onPress?: () => void;
  toggleKey?: string;
  badge?: string;
}

const DriverSettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user, logout, isDemoDriver, returnToUserMode } = useAuthStore();

  const [notifications, setNotifications] = useState(true);
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [autoAccept, setAutoAccept] = useState(false);
  const [availableForICU, setAvailableForICU] = useState(true);
  const [availableForBasic, setAvailableForBasic] = useState(true);
  const [nightMode, setNightMode] = useState(false);
  const [language, ] = useState('English');

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            if (isDemoDriver) {
              returnToUserMode();
              return;
            }
            // End the real Supabase session, then clear local state.
            try {
              await authService.signOut();
            } catch {
              // Local sign-out still proceeds.
            }
            logout();
          },
        },
      ]
    );
  };

  const handleSwitchToUser = () => {
    returnToUserMode();
  };

  const handleDeactivateAccount = () => {
    if (isDemoDriver) {
      Alert.alert('Demo preview', 'Account changes are unavailable in the local driver demo.');
      return;
    }
    Alert.alert(
      'Deactivate Account',
      'Are you sure you want to deactivate your driver account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            if (!isSupabaseConfigured || !user?.id) {
              Alert.alert(
                'Not recorded',
                'No database is configured, so this request could not be recorded in this build. Nothing was sent.',
              );
              return;
            }
            try {
              await supportRequestsService.create({
                user_id: user.id,
                subject: 'Driver account deactivation request',
                message: 'Requested from Driver Settings → Deactivate Account in the app.',
              });
              Alert.alert(
                'Request Recorded',
                'Your deactivation request has been saved for the RESQ Nepal team to review.',
              );
            } catch {
              Alert.alert('Could not send request', 'Check your connection and try again.');
            }
          },
        },
      ]
    );
  };

  const notificationSection: SettingsItem[] = [
    {
      id: 'notifications',
      icon: '🔔',
      title: 'Push Notifications',
      subtitle: 'Receive booking request alerts',
      type: 'toggle',
      value: notifications,
      toggleKey: 'notifications',
    },
    {
      id: 'sound',
      icon: '🔊',
      title: 'Sound Alerts',
      subtitle: 'Play sound for new requests',
      type: 'toggle',
      value: soundAlerts,
      toggleKey: 'soundAlerts',
    },
  ];

  const vehicleSection: SettingsItem[] = [
    {
      id: 'icu',
      icon: '🏥',
      title: 'ICU Ambulance Requests',
      subtitle: 'Receive ICU category bookings',
      type: 'toggle',
      value: availableForICU,
      toggleKey: 'availableForICU',
    },
    {
      id: 'basic',
      icon: '🚑',
      title: 'Basic Ambulance Requests',
      subtitle: 'Receive basic category bookings',
      type: 'toggle',
      value: availableForBasic,
      toggleKey: 'availableForBasic',
    },
    {
      id: 'auto_accept',
      icon: '⚡',
      title: 'Auto Accept',
      subtitle: 'Automatically accept nearby requests',
      type: 'toggle',
      value: autoAccept,
      toggleKey: 'autoAccept',
    },
  ];

  const availabilitySection: SettingsItem[] = [
    {
      id: 'night_mode',
      icon: '🌙',
      title: 'Night Mode (10PM - 6AM)',
      subtitle: 'Receive requests during night hours',
      type: 'toggle',
      value: nightMode,
      toggleKey: 'nightMode',
    },
    {
      id: 'schedule',
      icon: '📅',
      title: 'Availability Schedule',
      subtitle: 'Set your working hours',
      type: 'link',
      onPress: () =>
        Alert.alert(
          'Availability Schedule',
          'Scheduled availability is not enabled yet. Your online/offline status on the home screen controls when requests reach you.',
        ),
    },
  ];

  const supportSection: SettingsItem[] = [
    {
      id: 'help',
      icon: '❓',
      title: 'Help & Support',
      subtitle: 'FAQs and contact support',
      type: 'link',
      onPress: () => navigation.navigate('Help'),
    },
    {
      id: 'faq',
      icon: '💬',
      title: 'FAQ',
      subtitle: 'Frequently asked questions',
      type: 'link',
      onPress: () => navigation.navigate('FAQ'),
    },
  ];

  const accountSection: SettingsItem[] = [
    {
      id: 'identity',
      icon: '🪪',
      title: 'Application Status',
      subtitle: 'Documents, reference ID and review state',
      type: 'link',
      onPress: () => navigation.navigate('ApplicationStatus', { type: 'DRIVER' }),
    },
    {
      id: 'language',
      icon: '🌐',
      title: 'Language',
      subtitle: language,
      type: 'link',
      onPress: () => navigation.navigate('Language'),
    },
    {
      id: 'deactivate',
      icon: '⚠️',
      title: 'Deactivate Account',
      subtitle: 'Permanently delete your account',
      type: 'action',
      onPress: handleDeactivateAccount,
    },
  ];

  const toggleSetting = (key: string) => {
    switch (key) {
      case 'notifications':
        setNotifications((prev) => !prev);
        break;
      case 'soundAlerts':
        setSoundAlerts((prev) => !prev);
        break;
      case 'autoAccept':
        setAutoAccept((prev) => !prev);
        break;
      case 'availableForICU':
        setAvailableForICU((prev) => !prev);
        break;
      case 'availableForBasic':
        setAvailableForBasic((prev) => !prev);
        break;
      case 'nightMode':
        setNightMode((prev) => !prev);
        break;
    }
  };

  const renderSection = (title: string, items: SettingsItem[]) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Card elevation="sm" style={styles.sectionCard}>
        {items.map((item, index) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.settingsItem, index < items.length - 1 && styles.settingsItemBorder]}
            onPress={item.type === 'toggle' ? () => toggleSetting(item.toggleKey!) : item.onPress}
            disabled={item.type === 'toggle'}
            activeOpacity={item.type === 'toggle' ? 1 : 0.7}
          >
            <Text style={styles.settingsIcon}>{item.icon}</Text>
            <View style={styles.settingsContent}>
              <Text style={styles.settingsTitle}>{item.title}</Text>
              {item.subtitle && (
                <Text style={styles.settingsSubtitle}>{item.subtitle}</Text>
              )}
            </View>
            {item.type === 'toggle' && (
              <Toggle
                value={item.value!}
                onValueChange={() => toggleSetting(item.toggleKey!)}
              />
            )}
            {item.type === 'link' && (
              <Text style={styles.chevron}>›</Text>
            )}
            {item.type === 'action' && (
              <Text style={[styles.chevron, { color: colors.error }]}>›</Text>
            )}
          </TouchableOpacity>
        ))}
      </Card>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <DriverNavigationHeader title="Settings" showBack />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderSection('Notifications', notificationSection)}
        {renderSection('Vehicle Preferences', vehicleSection)}
        {renderSection('Availability', availabilitySection)}
        {renderSection('Support', supportSection)}
        {renderSection('Account', accountSection)}

        {/* Switch to User Mode */}
        <Button
          title="Switch to User Mode"
          variant="outline"
          fullWidth
          onPress={handleSwitchToUser}
          style={styles.logoutButton}
        />

        {/* Logout Button */}
        <Button
          title="Logout"
          variant="ghost"
          fullWidth
          onPress={handleLogout}
          style={styles.logoutButton}
        />

        {/* App Version */}
        <Text style={styles.versionText}>RESQ Nepal v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  sectionCard: {
    padding: 0,
    overflow: 'hidden',
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
  },
  settingsItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingsIcon: {
    fontSize: 20,
    marginRight: spacing.md,
  },
  settingsContent: {
    flex: 1,
  },
  settingsTitle: {
    ...typography.body,
    fontWeight: '500',
    color: colors.text,
  },
  settingsSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
    color: colors.textTertiary,
    fontWeight: '600',
  },
  logoutButton: {
    marginTop: spacing.sm,
    borderColor: colors.error,
  },
  versionText: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});

export default DriverSettingsScreen;
