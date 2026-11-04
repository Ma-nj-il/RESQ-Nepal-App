import { AppText } from '../../components/ui/AppText';
import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Input, Button, LoadingOverlay } from '../../components/ui';
import { colors, spacing, typography} from '../../constants/theme';
import { authService } from '../../services/auth/authService';

const ChangePasswordScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setError(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Complete all password fields.');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 72) {
      setError('Password must contain 8 to 72 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await authService.changePassword(currentPassword, newPassword);
      setSuccess(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not change the password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <AppText style={styles.backText}>←</AppText>
            </TouchableOpacity>
            <AppText style={styles.headerTitle}>Change Password</AppText>
            <View style={styles.backButton} />
          </View>

          {success ? (
            <View style={styles.successBox}>
              <AppText style={styles.successIcon}>✅</AppText>
              <AppText style={styles.successTitle}>Password Saved</AppText>
              <AppText style={styles.successMessage}>
                Your password was changed. Other signed-in devices were revoked.
              </AppText>
              <Button title="Done" onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg }} />
            </View>
          ) : (
            <>
              <AppText style={styles.description}>
                Confirm your current password, then choose a new password containing 8 to 72 characters.
              </AppText>

              <Input
                label="Current Password"
                placeholder="Enter current password"
                secureTextEntry
                value={currentPassword}
                onChangeText={setCurrentPassword}
                textContentType="password"
              />

              <Input
                label="New Password"
                placeholder="Enter new password"
                secureTextEntry
                value={newPassword}
                onChangeText={setNewPassword}
                textContentType="newPassword"
              />
              <Input
                label="Confirm New Password"
                placeholder="Re-enter new password"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                error={error ?? undefined}
                textContentType="newPassword"
              />

              <Button title="Save Password" onPress={handleSave} fullWidth style={{ marginTop: spacing.md }} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <LoadingOverlay visible={loading} message="Updating..." />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h3 },
  description: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.xl },
  successBox: { alignItems: 'center', paddingVertical: spacing.xxxl },
  successIcon: { fontSize: 48, marginBottom: spacing.md },
  successTitle: { ...typography.h3, marginBottom: spacing.sm },
  successMessage: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});

export default ChangePasswordScreen;
