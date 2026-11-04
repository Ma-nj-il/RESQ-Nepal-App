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
import { isValidNepaliPhone, normalizeNepaliPhoneInput } from '../../utils/format';

const TERMS_VERSION = '2026-11-04';

interface PhoneRegistrationScreenProps {
  navigation: any;
}

const PhoneRegistrationScreen: React.FC<PhoneRegistrationScreenProps> = ({ navigation }) => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const clearValidation = () => {
    setFieldErrors({});
    setFormError(null);
  };

  const handleSignUp = async () => {
    const nextErrors: Record<string, string> = {};
    if (!firstName.trim()) nextErrors.firstName = 'First name is required';
    if (!lastName.trim()) nextErrors.lastName = 'Last name is required';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) nextErrors.email = 'Enter a valid email address';
    if (!isValidNepaliPhone(phoneNumber)) {
      nextErrors.phone = 'Use a 10-digit number starting with 96, 97, or 98';
    }
    if (password.length < 8) nextErrors.password = 'Use at least 8 characters';
    if (password !== confirmPassword) nextErrors.confirmPassword = 'Passwords do not match';
    if (!agreedToTerms) nextErrors.terms = 'You must agree before creating an account';

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setFormError('Please correct the highlighted fields.');
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const phone = `+977${phoneNumber}`;

    if (isDemoMode()) {
      const now = new Date().toISOString();
      const store = useAuthStore.getState();
      store.setUser({
        id: 'demo-user',
        auth_source: 'demo',
        full_name: `${firstName.trim()} ${lastName.trim()}`,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: normalizedEmail,
        phone,
        mode: 'user',
        created_at: now,
        updated_at: now,
      });
      store.setMode('user');
      navigation.navigate('LocationPermission');
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      await authService.register({
        email: normalizedEmail,
        password,
        phone_number: phone,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role: 'rider',
        terms_version: TERMS_VERSION,
      });
      navigation.replace('Login', { email: normalizedEmail, registered: true });
    } catch (error) {
      const message =
        error instanceof UserServiceError
          ? error.message
          : 'Check your connection and try again.';
      setFormError(message);
      if (Platform.OS !== 'web') Alert.alert('Could not create account', message);
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
          <AppText style={styles.heading}>Create Your Account</AppText>
          <AppText style={styles.subtitle}>
            These details are sent securely to the RESQ Nepal user service.
          </AppText>
          {formError && <AppText style={styles.errorText}>{formError}</AppText>}

          <View style={styles.nameRow}>
            <View style={styles.nameField}>
              <Input
                label="First name"
                value={firstName}
                onChangeText={(value) => {
                  clearValidation();
                  setFirstName(value);
                }}
                placeholder="First name"
                autoCapitalize="words"
                textContentType="givenName"
                error={fieldErrors.firstName}
              />
            </View>
            <View style={styles.nameField}>
              <Input
                label="Last name"
                value={lastName}
                onChangeText={(value) => {
                  clearValidation();
                  setLastName(value);
                }}
                placeholder="Last name"
                autoCapitalize="words"
                textContentType="familyName"
                error={fieldErrors.lastName}
              />
            </View>
          </View>

          <Input
            label="Email"
            value={email}
            onChangeText={(value) => {
              clearValidation();
              setEmail(value);
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            error={fieldErrors.email}
          />
          <Input
            label="Nepali phone number"
            value={phoneNumber}
            onChangeText={(value) => {
              clearValidation();
              setPhoneNumber(normalizeNepaliPhoneInput(value));
            }}
            placeholder="98XXXXXXXX"
            keyboardType="phone-pad"
            icon={<AppText style={styles.countryCode}>+977</AppText>}
            error={fieldErrors.phone}
          />
          <Input
            label="Password"
            value={password}
            onChangeText={(value) => {
              clearValidation();
              setPassword(value);
            }}
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            error={fieldErrors.password}
          />
          <Input
            label="Confirm password"
            value={confirmPassword}
            onChangeText={(value) => {
              clearValidation();
              setConfirmPassword(value);
            }}
            placeholder="Repeat your password"
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            error={fieldErrors.confirmPassword}
          />

          <TouchableOpacity
            style={styles.checkboxContainer}
            onPress={() => {
              clearValidation();
              setAgreedToTerms((current) => !current);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
              {agreedToTerms && <AppText style={styles.checkmark}>✓</AppText>}
            </View>
            <AppText style={styles.termsText}>I agree to the Terms & Conditions.</AppText>
          </TouchableOpacity>
          {fieldErrors.terms && <AppText style={styles.termsError}>{fieldErrors.terms}</AppText>}

          <Button
            title={isDemoMode() ? 'Continue in demo mode' : 'Create account'}
            onPress={() => void handleSignUp()}
            fullWidth
            size="lg"
            loading={isSubmitting}
            disabled={isSubmitting}
          />

          <View style={styles.signInContainer}>
            <AppText style={styles.signInText}>Already have an account? </AppText>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <AppText style={styles.signInLink}>Sign in</AppText>
            </TouchableOpacity>
          </View>
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
  scrollContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  heading: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  nameRow: { flexDirection: 'row', gap: spacing.sm },
  nameField: { flex: 1 },
  countryCode: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
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
  termsText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  termsError: { ...typography.caption, color: colors.error, marginTop: -spacing.sm, marginBottom: spacing.md },
  signInContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  signInText: { ...typography.bodySmall, color: colors.textSecondary },
  signInLink: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    marginBottom: spacing.md,
    lineHeight: 19,
  },
});

export default PhoneRegistrationScreen;
