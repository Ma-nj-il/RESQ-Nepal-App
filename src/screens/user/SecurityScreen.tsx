import { AppText } from '../../components/ui/AppText';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Header, Input } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { authService } from '../../services/auth/authService';
import { useAuthStore } from '../../store/authStore';
import { confirmAction } from '../../utils/confirmAction';

type BusyAction = 'codes' | 'deactivate' | 'delete' | null;

export const SecurityScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const logout = useAuthStore((state) => state.logout);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const requirePassword = (): boolean => {
    if (password) return true;
    setError('Enter your current password before performing a security action.');
    return false;
  };

  const generateCodes = async () => {
    if (!requirePassword()) return;
    setBusy('codes');
    setError(null);
    try {
      setRecoveryCodes(await authService.regenerateRecoveryCodes(password));
      setPassword('');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not generate recovery codes.');
    } finally {
      setBusy(null);
    }
  };

  const deactivate = () => {
    if (!requirePassword()) return;
    confirmAction(
      'Deactivate account',
      'Your account and every active session will be disabled. You can reactivate later with your email and password.',
      async () => {
        setBusy('deactivate');
        setError(null);
        try {
          await authService.deactivateAccount(password);
          logout();
        } catch (actionError) {
          setError(actionError instanceof Error ? actionError.message : 'Could not deactivate the account.');
        } finally {
          setBusy(null);
        }
      },
      { confirmLabel: 'Deactivate', destructive: true },
    );
  };

  const deleteAccount = () => {
    if (!requirePassword()) return;
    confirmAction(
      'Delete account permanently',
      'Direct account information will be anonymized and all sessions will be revoked. Legally required operational records may be retained.',
      async () => {
        setBusy('delete');
        setError(null);
        try {
          await authService.deleteAccount(password);
          logout();
        } catch (actionError) {
          setError(actionError instanceof Error ? actionError.message : 'Could not delete the account.');
        } finally {
          setBusy(null);
        }
      },
      { confirmLabel: 'Delete permanently', destructive: true },
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Account & Security" showBack onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.infoCard}>
          <AppText style={styles.sectionTitle}>Authentication</AppText>
          <AppText style={styles.bodyText}>
            Email and password sign-in is active. SMS verification, authenticator MFA, and social login remain unavailable until their providers are configured.
          </AppText>
        </View>

        <TouchableOpacity style={styles.menuRow} onPress={() => navigation.navigate('ChangePassword')}>
          <View style={styles.flex}>
            <AppText style={styles.menuLabel}>Change Password</AppText>
            <AppText style={styles.menuDescription}>Confirm your current password and revoke other devices</AppText>
          </View>
          <AppText style={styles.arrow}>›</AppText>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuRow} onPress={() => navigation.navigate('DeviceManagement')}>
          <View style={styles.flex}>
            <AppText style={styles.menuLabel}>Device Management</AppText>
            <AppText style={styles.menuDescription}>View and revoke active account sessions</AppText>
          </View>
          <AppText style={styles.arrow}>›</AppText>
        </TouchableOpacity>

        <View style={styles.securityCard}>
          <AppText style={styles.sectionTitle}>Sensitive actions</AppText>
          <Input
            label="Current password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
          />
          {error && <AppText style={styles.error}>{error}</AppText>}

          <Button
            title="Generate new recovery codes"
            variant="outline"
            fullWidth
            loading={busy === 'codes'}
            disabled={busy !== null}
            onPress={() => void generateCodes()}
          />

          {recoveryCodes.length > 0 && (
            <View style={styles.codesCard}>
              <AppText style={styles.codesTitle}>Save these codes now</AppText>
              <AppText style={styles.codesNote}>
                They are displayed once. Each code can reset your password one time.
              </AppText>
              {recoveryCodes.map((code) => (
                <AppText key={code} selectable style={styles.code}>{code}</AppText>
              ))}
            </View>
          )}
        </View>

        <View style={styles.dangerZone}>
          <AppText style={styles.dangerTitle}>Account lifecycle</AppText>
          <Button
            title="Deactivate account"
            variant="outline"
            fullWidth
            loading={busy === 'deactivate'}
            disabled={busy !== null}
            onPress={deactivate}
          />
          <Button
            title="Delete account permanently"
            variant="danger"
            fullWidth
            loading={busy === 'delete'}
            disabled={busy !== null}
            onPress={deleteAccount}
            style={styles.deleteButton}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xxxl },
  flex: { flex: 1 },
  infoCard: {
    margin: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.blueLight,
  },
  sectionTitle: { ...typography.h4, color: colors.text, marginBottom: spacing.sm },
  bodyText: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 19 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  menuLabel: { ...typography.body, fontWeight: '600' },
  menuDescription: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  arrow: { fontSize: 20, color: colors.textTertiary },
  securityCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  error: { ...typography.bodySmall, color: colors.error, marginBottom: spacing.md },
  codesCard: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.input },
  codesTitle: { ...typography.body, fontWeight: '700', color: colors.text },
  codesNote: { ...typography.caption, color: colors.textSecondary, marginVertical: spacing.sm },
  code: { ...typography.bodySmall, color: colors.text, letterSpacing: 1, paddingVertical: 2 },
  dangerZone: { marginHorizontal: spacing.lg, marginTop: spacing.xl },
  dangerTitle: { ...typography.h4, color: colors.error, marginBottom: spacing.md },
  deleteButton: { marginTop: spacing.md },
});
