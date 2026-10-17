import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Header, Toggle } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { supportRequestsService } from '../../services/database/supportRequests';
import { isSupabaseConfigured } from '../../services/database/client';

interface SecurityOption {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

type RequestKind = 'deactivation' | 'deletion';

export const SecurityScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const user = useAuthStore((state) => state.user);
  // Local-only toggles: these are example options from the design. Only phone
  // OTP sign-in is active in this build, so the state is never presented as a
  // working security control.
  const [securityOptions, setSecurityOptions] = useState<SecurityOption[]>([
    { id: 'biometric', label: 'Biometric ID', description: 'Example option — not connected in this build', enabled: false },
    { id: 'face', label: 'Face ID', description: 'Example option — not connected in this build', enabled: false },
    { id: 'sms', label: 'SMS Authenticator', description: 'Phone OTP sign-in is the active method', enabled: true },
    { id: 'google', label: 'Google Authenticator', description: 'Example option — not connected in this build', enabled: false },
  ]);


  const handleToggle = useCallback((id: string) => {
    setSecurityOptions((prev) =>
      prev.map((o) => (o.id === id ? { ...o, enabled: !o.enabled } : o))
    );
  }, []);

  const handleChangePassword = useCallback(() => {
    navigation.navigate('ChangePassword');
  }, [navigation]);

  const handleDeviceManagement = useCallback(() => {
    navigation.navigate('DeviceManagement');
  }, [navigation]);

  const submitRequest = useCallback(
    async (kind: RequestKind) => {
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
          subject: kind === 'deletion' ? 'Account deletion request' : 'Account deactivation request',
          message: `Requested from ${kind === 'deletion' ? 'Security → Delete Account' : 'Security → Deactivate Account'} in the app.`,
        });
        Alert.alert(
          'Request Recorded',
          'Your request has been saved for the RESQ Nepal team to review. Identity confirmation may be required before it is processed.',
        );
      } catch {
        Alert.alert('Could not send request', 'Check your connection and try again.');
      }
    },
    [user],
  );

  const handleDeactivate = useCallback(() => {
    Alert.alert('Deactivate Account', 'Are you sure you want to deactivate your account?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: () => void submitRequest('deactivation') },
    ]);
  }, [submitRequest]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Account',
      'This action is permanent and cannot be undone. All your data will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void submitRequest('deletion') },
      ]
    );
  }, [submitRequest]);

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Account & Security" showBack onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Security Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Authentication Methods</Text>
          <Text style={styles.sectionNote}>
            Example options from the design. In this build the only active sign-in method is
            phone OTP; the switches below are not connected to real authentication.
          </Text>
          {securityOptions.map((option) => (
            <View key={option.id} style={styles.optionRow}>
              <View style={styles.optionInfo}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionDescription}>{option.description}</Text>
              </View>
              <Toggle value={option.enabled} onValueChange={() => handleToggle(option.id)} />
            </View>
          ))}
        </View>

        {/* Change Password */}
        <TouchableOpacity style={styles.menuRow} onPress={handleChangePassword}>
          <View style={styles.menuInfo}>
            <Text style={styles.menuLabel}>Change Password</Text>
            <Text style={styles.menuDescription}>Set or update your account password</Text>
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>

        {/* Device Management */}
        <TouchableOpacity style={styles.menuRow} onPress={handleDeviceManagement}>
          <View style={styles.menuInfo}>
            <Text style={styles.menuLabel}>Device Management</Text>
            <Text style={styles.menuDescription}>Manage devices linked to your account</Text>
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>

        {/* Danger Zone */}
        <View style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>Danger Zone</Text>

          <TouchableOpacity style={styles.dangerRow} onPress={handleDeactivate}>
            <View style={styles.menuInfo}>
              <Text style={styles.dangerLabel}>Deactivate Account</Text>
              <Text style={styles.dangerDescription}>
                Temporarily disable your account. You can reactivate it anytime.
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.dangerRow} onPress={handleDelete}>
            <View style={styles.menuInfo}>
              <Text style={[styles.dangerLabel, styles.deleteLabel]}>Delete Account</Text>
              <Text style={styles.deleteDescription}>
                Permanently delete your account and all associated data. This cannot be undone.
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  sectionTitle: { ...typography.h4, marginBottom: spacing.sm },
  sectionNote: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 18 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionInfo: { flex: 1, marginRight: spacing.md },
  optionLabel: { ...typography.body, fontWeight: '600' },
  optionDescription: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  menuInfo: { flex: 1 },
  menuLabel: { ...typography.body, fontWeight: '600' },
  menuDescription: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  arrow: { fontSize: 20, color: colors.textTertiary },
  dangerZone: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xxxl,
  },
  dangerTitle: { ...typography.h4, color: colors.error, marginBottom: spacing.md },
  dangerRow: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radii.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.redLight,
  },
  dangerLabel: { ...typography.body, fontWeight: '600', color: colors.warning },
  dangerDescription: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  deleteLabel: { color: colors.error },
  deleteDescription: { ...typography.bodySmall, color: colors.error, marginTop: 2 },
});
