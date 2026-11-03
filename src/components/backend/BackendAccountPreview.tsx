import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { BackendError } from '../../services/api/backend/errors';
import type { NativeBackendRuntime } from '../../services/api/backend/nativeRuntime';
import type { preferences, profile as profileDecoder } from '../../services/api/backend/requester';
import { BackendProductPreview } from './BackendProductPreview';
import { BackendDispatchPreview } from './BackendDispatchPreview';
import { BackendSecurityPreview } from './BackendSecurityPreview';
import { useBackendCommand } from './useBackendCommand';

type NotificationPage = Awaited<ReturnType<NativeBackendRuntime['api']['notifications']>>['data'];

/** Bounded requester acceptance surface. Session teardown unmounts and discards all account data. */
export function BackendAccountPreview({ runtime, profile }: {
  runtime: NativeBackendRuntime;
  profile: ReturnType<typeof profileDecoder>;
}) {
  const [settings, setSettings] = useState<ReturnType<typeof preferences> | null>(null);
  const [notifications, setNotifications] = useState<NotificationPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const pending = useRef(false);
  const command = useBackendCommand(runtime.generateId);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try { await work(); } catch (failure) {
      if (active.current) setError(failure instanceof BackendError ? failure.message : 'Unable to load account data.');
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };
  const loadNotifications = (afterId?: string) => run(async () => {
    const { data } = await runtime.api.notifications(afterId);
    if (active.current) setNotifications(data);
  });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{profile.displayName ?? 'Your account'}</Text>
      <Text style={styles.text}>{profile.phoneMasked ?? 'Phone number not available'}</Text>
      <Text style={styles.text}>Account status: {profile.status}</Text>
      <Button title="Sign out" variant="outline" onPress={() => { void runtime.auth.logout(); }} />
      {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}

      <Text style={styles.heading}>Notification preferences</Text>
      {command.notice && <Text style={styles.text} accessibilityRole="alert">{command.notice}</Text>}
      {command.unresolved && <Button title="Retry preference request" disabled={command.busy} onPress={() => { void command.retry(); }} />}
      <Button title="Load preferences" disabled={busy || command.busy} onPress={() => { void run(async () => {
        const { data } = await runtime.api.preferences();
        if (active.current) setSettings(data);
      }); }} />
      {settings && <View style={styles.card}>
        <Text style={styles.text}>Booking updates: {settings.bookingUpdates ? 'On' : 'Off'}</Text>
        <Text style={styles.text}>Trip updates: {settings.tripUpdates ? 'On' : 'Off'}</Text>
        <Text style={styles.text}>Support updates: {settings.supportUpdates ? 'On' : 'Off'}</Text>
        <Text style={styles.text}>Marketing: {settings.marketing ? 'On' : 'Off'}</Text>
        <Text style={styles.text}>Version: {settings.version}</Text>
        {(['bookingUpdates', 'tripUpdates', 'supportUpdates', 'marketing'] as const).map((key) =>
          <Button key={key} title={`Toggle ${key}`} variant="outline" disabled={busy || command.unresolved}
            onPress={() => command.submit({ ...settings, [key]: !settings[key] }, (value, identity) => runtime.api.replacePreferences(value, {
              idempotencyKey: identity.idempotencyKey, expectedVersion: identity.expectedVersion!,
            }), ({ data }) => setSettings(data), settings.version)} />)}
      </View>}

      <Text style={styles.heading}>In-app notifications</Text>
      <Text style={styles.text}>These records confirm account updates. They do not confirm SMS or push delivery.</Text>
      <Button title="Refresh notifications" disabled={busy} onPress={() => { void loadNotifications(); }} />
      {notifications?.items.length === 0 && <Text style={styles.text}>No notifications on this page.</Text>}
      {notifications?.items.map((item) => <View key={item.id} style={styles.card}>
        <Text style={styles.text}>{item.kind === 'SUPPORT_UPDATED' ? 'Support updated' : 'Cash recorded'}</Text>
        <Text style={styles.text}>{item.createdAt}</Text>
        {item.read ? <Text style={styles.text}>Read</Text> : <Button title="Mark as read" disabled={busy}
          onPress={() => { void run(async () => {
            const { data } = await runtime.api.markRead(item.id);
            if (active.current) setNotifications((current) => current && ({ ...current,
              items: current.items.map((notification) => notification.id === data.id ? { ...notification, read: true } : notification),
            }));
          }); }} />}
      </View>)}
      {notifications?.nextAfterId && <Button title="Next page" disabled={busy}
        onPress={() => { void loadNotifications(notifications.nextAfterId!); }} />}
      <BackendProductPreview runtime={runtime} />
      <BackendDispatchPreview runtime={runtime} />
      <BackendSecurityPreview runtime={runtime} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg },
  heading: { ...typography.h3, color: colors.text },
  text: { ...typography.bodySmall, color: colors.text },
  card: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.background, borderRadius: radii.md },
  error: { ...typography.bodySmall, color: colors.primaryDark },
});
