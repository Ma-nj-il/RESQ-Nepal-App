import { AppText } from '../../components/ui/AppText';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Header, Input } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { authService } from '../../services/auth/authService';

interface RecoverPasswordScreenProps {
  navigation: any;
  route?: any;
}

const RecoverPasswordScreen: React.FC<RecoverPasswordScreenProps> = ({ navigation, route }) => {
  const [email, setEmail] = useState(route?.params?.email || '');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);

  const handleReset = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return setError('Enter a valid email address.');
    if (!recoveryCode.trim()) return setError('Enter one of your recovery codes.');
    if (password.length < 8 || password.length > 72) return setError('Use a password containing 8 to 72 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');

    setLoading(true);
    setError(null);
    try {
      await authService.resetPasswordWithRecoveryCode({
        email: normalizedEmail,
        recovery_code: recoveryCode,
        new_password: password,
      });
      setComplete(true);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Recover Password" showBack onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {complete ? (
            <>
              <AppText style={styles.title}>Password reset</AppText>
              <AppText style={styles.description}>
                The recovery code has been consumed and every previous session was revoked.
              </AppText>
              <Button
                title="Sign in"
                fullWidth
                onPress={() => navigation.replace('Login', { email: email.trim().toLowerCase() })}
              />
            </>
          ) : (
            <>
              <AppText style={styles.description}>
                Enter one recovery code you previously generated from Account & Security. Each code works once.
              </AppText>
              {error && <AppText style={styles.error}>{error}</AppText>}
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Input
                label="Recovery code"
                value={recoveryCode}
                onChangeText={setRecoveryCode}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="XXXX-XXXX-XXXX-XXXX"
              />
              <Input label="New password" value={password} onChangeText={setPassword} secureTextEntry />
              <Input
                label="Confirm new password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
              <Button
                title="Reset password"
                onPress={() => void handleReset()}
                fullWidth
                loading={loading}
                disabled={loading}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: spacing.xl },
  title: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
  description: { ...typography.body, color: colors.textSecondary, lineHeight: 22, marginBottom: spacing.xl },
  error: { ...typography.bodySmall, color: colors.error, marginBottom: spacing.md },
});

export default RecoverPasswordScreen;
