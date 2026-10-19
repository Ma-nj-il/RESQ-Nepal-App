import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Header, Toggle } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { NOTIFICATION_PREFS_KEY } from '../../constants/storage';
import { notificationsService } from '../../services/database/notifications';
import { isSupabaseConfigured } from '../../services/database/client';
import { useAuthStore } from '../../store/authStore';
import { isDemoMode } from '../../utils/demoMode';
import { Notification } from '../../types';

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

/**
 * Clearly-labelled sample inbox shown only in demo mode (or when the database
 * is not configured). Real database rows are never mixed with these.
 */
const SAMPLE_NOTIFICATIONS: Notification[] = [
  {
    id: 'sample-notif-1',
    user_id: 'sample',
    booking_id: 'sample-completed',
    title: 'Trip completed (sample)',
    body: 'The ICU transfer to Norvic International Hospital is marked completed. Open your trips to review or rate it.',
    type: 'trip',
    read: false,
    created_at: '2026-10-16T15:05:00Z',
  },
  {
    id: 'sample-notif-2',
    user_id: 'sample',
    booking_id: 'sample-ongoing',
    title: 'Ambulance assigned (sample)',
    body: 'A crew accepted the request in this walkthrough. No real vehicle is attached in demo mode.',
    type: 'booking',
    read: true,
    created_at: '2026-10-17T10:32:00Z',
  },
];

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const NotificationsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const demoRun = isDemoMode();
  const offlineInbox = demoRun || !isSupabaseConfigured;
  const shouldFetchInbox = Boolean(user?.id && isSupabaseConfigured && !demoRun);

  const [settings, setSettings] = useState<NotificationSetting[]>(defaultSettings);
  const [inbox, setInbox] = useState<Notification[]>(() =>
    offlineInbox ? SAMPLE_NOTIFICATIONS : [],
  );
  const [inboxLoading, setInboxLoading] = useState(shouldFetchInbox);
  const [inboxError, setInboxError] = useState<string | null>(null);

  // Used by the error-state Retry button. The initial load is handled by the
  // effect below so no state is set synchronously during mount.
  const loadInbox = async () => {
    if (offlineInbox || !user?.id) {
      setInbox(SAMPLE_NOTIFICATIONS);
      setInboxError(null);
      setInboxLoading(false);
      return;
    }
    setInboxLoading(true);
    try {
      const data = await notificationsService.getByUser(user.id);
      setInbox(data);
      setInboxError(null);
    } catch {
      setInboxError('Could not load your notifications.');
    } finally {
      setInboxLoading(false);
    }
  };

  useEffect(() => {
    if (!shouldFetchInbox || !user?.id) return;
    let active = true;
    (async () => {
      try {
        const data = await notificationsService.getByUser(user.id);
        if (active) {
          setInbox(data);
          setInboxError(null);
        }
      } catch {
        if (active) setInboxError('Could not load your notifications.');
      } finally {
        if (active) setInboxLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [shouldFetchInbox, user?.id]);

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

  const handleOpenNotification = useCallback(
    async (item: Notification) => {
      setInbox((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      if (!offlineInbox && !item.id.startsWith('sample-')) {
        try {
          await notificationsService.markRead(item.id);
        } catch {
          // The row stays unread on the server; local state already updated.
        }
      }
      if (item.booking_id) {
        if (offlineInbox) {
          // Sample rows are not in the database, so open the trips list.
          navigation.popTo('Activity');
        } else {
          navigation.navigate('TripTracking', { bookingId: item.booking_id });
        }
      }
    },
    [navigation, offlineInbox],
  );

  const enabledCount = settings.filter((s) => s.enabled).length;
  const unreadCount = inbox.filter((n) => !n.read).length;

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Notifications" showBack onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* In-app updates */}
        <Text style={styles.sectionTitle}>Recent updates</Text>
        <View style={styles.inboxCard}>
          {inboxLoading ? (
            <View style={styles.inboxLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.mutedText}>Loading notifications…</Text>
            </View>
          ) : inboxError ? (
            <View style={styles.inboxLoading}>
              <Text style={styles.errorText}>{inboxError}</Text>
              <TouchableOpacity onPress={loadInbox} accessibilityRole="button" style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : inbox.length === 0 ? (
            <View style={styles.inboxLoading}>
              <Text style={styles.mutedText}>
                No notifications yet. Booking and trip updates appear here when they happen.
              </Text>
            </View>
          ) : (
            inbox.map((item, index) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.notificationRow, index < inbox.length - 1 && styles.notificationRowBorder]}
                activeOpacity={0.8}
                onPress={() => void handleOpenNotification(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.read ? 'Read' : 'Unread'} notification: ${item.title}`}
              >
                <View style={[styles.unreadDot, item.read && styles.unreadDotRead]} />
                <View style={styles.notificationInfo}>
                  <Text style={[styles.notificationTitle, !item.read && styles.notificationTitleUnread]}>
                    {item.title}
                  </Text>
                  <Text style={styles.notificationBody} numberOfLines={2}>
                    {item.body}
                  </Text>
                  <Text style={styles.notificationTime}>{formatWhen(item.created_at)}</Text>
                </View>
                {item.booking_id ? <Text style={styles.chevron}>›</Text> : null}
              </TouchableOpacity>
            ))
          )}
          {offlineInbox && !inboxLoading && !inboxError ? (
            <Text style={styles.inboxNote}>
              Demo mode — sample updates for the walkthrough. Push delivery is not enabled in this build.
            </Text>
          ) : null}
        </View>

        {/* Preferences */}
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryText}>
            {enabledCount} of {settings.length} notifications enabled
          </Text>
          <Text style={styles.settingDescription}>
            Preferences are stored on this device. Push delivery is not enabled in this build
            {unreadCount > 0 ? ` · ${unreadCount} unread` : ''}.
          </Text>
        </View>

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
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1, marginTop: spacing.md },
  sectionTitle: {
    ...typography.h4,
    color: colors.text,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },

  inboxCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    borderRadius: radii.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  inboxLoading: { padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  mutedText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  errorText: { ...typography.bodySmall, color: colors.error, textAlign: 'center' },
  retryButton: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryText: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },

  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.lg,
    gap: spacing.md,
  },
  notificationRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  unreadDotRead: { backgroundColor: colors.disabled },
  notificationInfo: { flex: 1 },
  notificationTitle: { ...typography.body, color: colors.text },
  notificationTitleUnread: { fontWeight: '700' },
  notificationBody: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  notificationTime: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs },
  chevron: { fontSize: 22, color: colors.textTertiary, alignSelf: 'center' },
  inboxNote: {
    ...typography.caption,
    color: colors.textTertiary,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  summaryCard: {
    backgroundColor: colors.blueLight,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  summaryText: { ...typography.bodySmall, color: colors.info, fontWeight: '600' },
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

export default NotificationsScreen;
