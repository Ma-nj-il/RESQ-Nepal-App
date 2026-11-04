import { AppText } from '../../components/ui/AppText';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Input } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { type UserServiceSession } from '../../services/api/userService';
import { authService } from '../../services/auth/authService';
import { useAuthStore } from '../../store/authStore';

const DeviceManagementScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const logout = useAuthStore((state) => state.logout);
  const [sessions, setSessions] = useState<UserServiceSession[]>([]);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await authService.listSessions());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load active sessions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSessions();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadSessions]);

  const revoke = async (session: UserServiceSession) => {
    setBusyId(session.id);
    setError(null);
    try {
      await authService.revokeSession(session.id);
      if (session.current) logout();
      else setSessions((current) => current.filter((item) => item.id !== session.id));
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke this session.');
    } finally {
      setBusyId(null);
    }
  };

  const revokeAll = async () => {
    if (!password) return setError('Enter your current password to revoke all sessions.');
    setBusyId('all');
    setError(null);
    try {
      await authService.revokeAllSessions(password);
      logout();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke all sessions.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <AppText style={styles.backText}>←</AppText>
        </TouchableOpacity>
        <AppText style={styles.headerTitle}>Device Management</AppText>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <AppText style={styles.description}>
          These are the active sessions authorized to use your RESQ Nepal account.
        </AppText>
        {error && <AppText style={styles.error}>{error}</AppText>}

        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : sessions.length === 0 ? (
          <AppText style={styles.empty}>No active sessions were found.</AppText>
        ) : (
          sessions.map((session) => (
            <Card key={session.id} style={styles.deviceCard}>
              <View style={styles.deviceRow}>
                <AppText style={styles.deviceIcon}>📱</AppText>
                <View style={styles.deviceInfo}>
                  <View style={styles.deviceNameRow}>
                    <AppText style={styles.deviceName}>{session.device_name || 'Unknown device'}</AppText>
                    {session.current && <AppText style={styles.currentBadge}>This device</AppText>}
                  </View>
                  <AppText style={styles.deviceMeta}>
                    Last used {new Date(session.last_used_at).toLocaleString()}
                  </AppText>
                  <AppText style={styles.deviceMeta}>
                    Expires {new Date(session.expires_at).toLocaleString()}
                  </AppText>
                  <Button
                    title={session.current ? 'Log out this device' : 'Revoke session'}
                    variant="outline"
                    size="sm"
                    loading={busyId === session.id}
                    disabled={busyId !== null}
                    onPress={() => void revoke(session)}
                    style={styles.revokeButton}
                  />
                </View>
              </View>
            </Card>
          ))
        )}

        <View style={styles.allSessionsCard}>
          <AppText style={styles.sectionTitle}>Revoke every session</AppText>
          <AppText style={styles.noticeText}>
            This signs out this device and every other device immediately.
          </AppText>
          <Input
            label="Current password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
          />
          <Button
            title="Revoke all sessions"
            variant="danger"
            fullWidth
            loading={busyId === 'all'}
            disabled={busyId !== null}
            onPress={() => void revokeAll()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h3 },
  content: { padding: spacing.lg, paddingTop: 0 },
  description: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.lg },
  error: { ...typography.bodySmall, color: colors.error, marginBottom: spacing.md },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', padding: spacing.xl },
  deviceCard: { marginBottom: spacing.md },
  deviceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  deviceIcon: { fontSize: 28 },
  deviceInfo: { flex: 1 },
  deviceNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  deviceName: { ...typography.h4 },
  currentBadge: {
    ...typography.caption,
    color: colors.success,
    backgroundColor: colors.greenLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  deviceMeta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  revokeButton: { marginTop: spacing.md, alignSelf: 'flex-start' },
  allSessionsCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.input,
  },
  sectionTitle: { ...typography.h4, color: colors.error, marginBottom: spacing.xs },
  noticeText: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.md },
});

export default DeviceManagementScreen;
