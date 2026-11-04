import { AppText } from '../../components/ui/AppText';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { UserServiceError } from '../../services/api/userService';
import { authService } from '../../services/auth/authService';
import { useAuthStore } from '../../store/authStore';
import { isDemoMode } from '../../utils/demoMode';

interface LoginScreenProps {
  navigation: any;
  route?: any;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation, route }) => {
  const [email, setEmail] = useState(route?.params?.email || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [canReactivate, setCanReactivate] = useState(false);

  const enterSession = (session: Awaited<ReturnType<typeof authService.login>>) => {
    const store = useAuthStore.getState();
    store.setUser(session.user);
    store.setMode(session.mode);
    store.setAuthenticated(true);
  };

  const handleSignIn = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setFormError('Enter your account password.');
      return;
    }

    setFormError(null);
    setCanReactivate(false);
    setIsSubmitting(true);
    try {
      const session = await authService.login(normalizedEmail, password, rememberMe);
      enterSession(session);
    } catch (error) {
      const message =
        error instanceof UserServiceError
          ? error.message
          : 'Could not sign in. Check your connection and try again.';
      setFormError(message);
      setCanReactivate(error instanceof UserServiceError && error.code === 'AUTH_ACCOUNT_DEACTIVATED');
      if (Platform.OS !== 'web') Alert.alert('Sign in failed', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReactivate = async () => {
    setIsSubmitting(true);
    setFormError(null);
    try {
      enterSession(await authService.reactivate(email.trim().toLowerCase(), password, rememberMe));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not reactivate this account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <AppText style={styles.backArrow}>←</AppText>
        </TouchableOpacity>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <AppText style={styles.heading}>Welcome Back</AppText>
          <AppText style={styles.subtitle}>
            Sign in with the email and password registered with RESQ Nepal.
          </AppText>

          {route?.params?.registered && (
            <AppText style={styles.successText}>
              Account created. Sign in to continue.
            </AppText>
          )}
          {formError && <AppText style={styles.errorText}>{formError}</AppText>}

          <View style={styles.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              onSubmitEditing={() => void handleSignIn()}
            />
          </View>

          {Platform.OS !== 'web' ? (
            <TouchableOpacity
              style={styles.checkboxContainer}
              onPress={() => setRememberMe((current) => !current)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                {rememberMe && <AppText style={styles.checkmark}>✓</AppText>}
              </View>
              <AppText style={styles.rememberText}>Keep me signed in on this device</AppText>
            </TouchableOpacity>
          ) : (
            <AppText style={styles.webSessionNote}>Web sessions last only until this tab is closed.</AppText>
          )}

          <Button
            title="Sign in"
            onPress={() => void handleSignIn()}
            fullWidth
            size="lg"
            loading={isSubmitting}
            disabled={isSubmitting || !email.trim() || !password}
          />

          {canReactivate && (
            <Button
              title="Reactivate account"
              variant="outline"
              onPress={() => void handleReactivate()}
              fullWidth
              loading={isSubmitting}
              style={styles.secondaryAction}
            />
          )}

          <TouchableOpacity
            onPress={() => navigation.navigate('RecoverPassword', { email: email.trim() })}
            style={styles.forgotButton}
          >
            <AppText style={styles.signUpLink}>Use a recovery code</AppText>
          </TouchableOpacity>

          <View style={styles.signUpContainer}>
            <AppText style={styles.signUpText}>Don&apos;t have an account? </AppText>
            <TouchableOpacity onPress={() => navigation.navigate('PhoneRegistration')}>
              <AppText style={styles.signUpLink}>Sign up</AppText>
            </TouchableOpacity>
          </View>

          {isDemoMode() && (
            <View style={styles.demoCard}>
              <AppText style={styles.demoText}>
                Demo mode is enabled. You can preview the original local OTP walkthrough without
                creating a backend account.
              </AppText>
              <Button
                title="Open demo OTP"
                variant="outline"
                fullWidth
                onPress={() => navigation.navigate('OTP', { phone: '+9779800000000' })}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  keyboardView: { flex: 1 },
  backButton: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backArrow: { fontSize: 24, color: colors.text },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  heading: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xxl,
    lineHeight: 22,
  },
  form: { marginBottom: spacing.xs },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  rememberText: { ...typography.bodySmall, color: colors.textSecondary },
  webSessionNote: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.xl },
  signUpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  signUpText: { ...typography.bodySmall, color: colors.textSecondary },
  signUpLink: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  secondaryAction: { marginTop: spacing.md },
  forgotButton: { alignItems: 'center', marginTop: spacing.lg },
  demoCard: {
    marginTop: spacing.xxl,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.blueLight,
  },
  demoText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  successText: {
    ...typography.bodySmall,
    color: colors.success,
    marginBottom: spacing.md,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    marginBottom: spacing.md,
    lineHeight: 19,
  },
});

export default LoginScreen;
