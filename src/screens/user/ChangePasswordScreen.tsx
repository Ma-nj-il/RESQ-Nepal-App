import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Input, Button, LoadingOverlay } from '../../components/ui';
import { colors, spacing, typography} from '../../constants/theme';
import { authService } from '../../services/auth/authService';
import { isSupabaseConfigured } from '../../services/database/client';

const ChangePasswordScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setError(null);
    if (!newPassword || !confirmPassword) {
      setError('Please fill in both fields.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!isSupabaseConfigured) {
      Alert.alert(
        'Not saved',
        'No database is configured, so a password cannot be stored in this build.',
      );
      return;
    }
    setLoading(true);
    const result = await authService.updatePassword(newPassword);
    setLoading(false);
    if (!result.success) {
      setError(result.message || 'Could not save the password. Check your connection and try again.');
      return;
    }
    setSuccess(true);
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
              <Text style={styles.backText}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Change Password</Text>
            <View style={styles.backButton} />
          </View>

          {success ? (
            <View style={styles.successBox}>
              <Text style={styles.successIcon}>✅</Text>
              <Text style={styles.successTitle}>Password Saved</Text>
              <Text style={styles.successMessage}>
                Your account now has a password on file. You keep signing in with your phone
                number and OTP in this build.
              </Text>
              <Button title="Done" onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg }} />
            </View>
          ) : (
            <>
              <Text style={styles.description}>
                Set a password for this account (at least 8 characters). Phone OTP remains the
                sign-in method in this build — the password is stored with your account and will
                be usable once password sign-in is enabled.
              </Text>

              <Input
                label="New Password"
                placeholder="Enter new password"
                secureTextEntry
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <Input
                label="Confirm New Password"
                placeholder="Re-enter new password"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                error={error ?? undefined}
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
