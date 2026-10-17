import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button} from '../../components/ui';
import { isValidNepaliPhone } from '../../utils/format';

interface PhoneRegistrationScreenProps {
  navigation: any;
}

const PhoneRegistrationScreen: React.FC<PhoneRegistrationScreenProps> = ({ navigation }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const handleBack = () => {
    navigation.goBack();
  };

  const handleSignUp = () => {
    if (!agreedToTerms) {
      Alert.alert('Terms required', 'Please agree to the RESQ Nepal Terms & Conditions to continue.');
      return;
    }
    if (!isValidNepaliPhone(phoneNumber)) {
      Alert.alert('Check phone number', 'Enter a valid 10-digit Nepali mobile number (starting 96/97/98).');
      return;
    }
    navigation.navigate('OTP', { phone: `+977${phoneNumber}` });
  };

  const handleSignIn = () => {
    navigation.navigate('Login');
  };

  const handleSocialLogin = (provider: string) => {
    Alert.alert(
      `${provider} sign-up`,
      `${provider} sign-up is not available in this build. Please continue with your phone number.`,
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {/* Back Arrow */}
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Heading */}
          <Text style={styles.heading}>Join Nepal Today ✨</Text>
          <Text style={styles.subtitle}>Enter your phone number to create your RESQ Nepal account.</Text>

          {/* Phone Input */}
          <View style={styles.phoneContainer}>
            <View style={styles.phoneInputWrapper}>
              <View style={styles.countryCodeContainer}>
                <Text style={styles.flag}>🇳🇵</Text>
                <Text style={styles.countryCode}>+977</Text>
              </View>
              <View style={styles.phoneDivider} />
              <View style={styles.phoneInputFlex}>
                <View style={styles.phoneInputRow}>
                  <Text style={styles.phoneLabel}>Phone Number</Text>
                  <Text style={styles.phoneHint}>e.g. 98XXXXXXXX</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  value={phoneNumber}
                  onChangeText={(text) => setPhoneNumber(text.replace(/\D/g, '').slice(0, 10))}
                  placeholder="98XXXXXXXX"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
            </View>
          </View>

          {/* Terms Checkbox */}
          <TouchableOpacity
            style={styles.checkboxContainer}
            onPress={() => setAgreedToTerms(!agreedToTerms)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
              {agreedToTerms && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.termsText}>I agree to RESQ Nepal Terms & Conditions.</Text>
          </TouchableOpacity>

          {/* Sign In Link */}
          <View style={styles.signInContainer}>
            <Text style={styles.signInText}>Already have an account? </Text>
            <TouchableOpacity onPress={handleSignIn}>
              <Text style={styles.signInLink}>Sign in</Text>
            </TouchableOpacity>
          </View>

          {/* Social Login Row */}
          <View style={styles.socialRow}>
            <TouchableOpacity
              style={styles.socialIconButton}
              onPress={() => handleSocialLogin('Google')}
              activeOpacity={0.7}
            >
              <Text style={styles.socialIcon}>G</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.socialIconButton}
              onPress={() => handleSocialLogin('Apple')}
              activeOpacity={0.7}
            >
              <Text style={styles.socialIcon}>🍎</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.socialIconButton}
              onPress={() => handleSocialLogin('Facebook')}
              activeOpacity={0.7}
            >
              <Text style={styles.socialIcon}>f</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.socialIconButton}
              onPress={() => handleSocialLogin('X')}
              activeOpacity={0.7}
            >
              <Text style={styles.socialIcon}>𝕏</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Sign Up Button */}
        <View style={styles.footer}>
          <Button
            title="Sign up"
            onPress={handleSignUp}
            fullWidth
            size="lg"
            disabled={!agreedToTerms || !isValidNepaliPhone(phoneNumber)}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  keyboardView: {
    flex: 1,
  },
  backButton: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backArrow: {
    fontSize: 24,
    color: colors.text,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  heading: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  phoneContainer: {
    marginBottom: spacing.lg,
  },
  phoneInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  countryCodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  flag: {
    fontSize: 20,
  },
  countryCode: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  phoneDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  phoneInputFlex: {
    flex: 1,
  },
  phoneInputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  phoneLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
  },
  phoneInput: {
    ...typography.body,
    color: colors.text,
    padding: 0,
    marginTop: 2,
  },
  phoneHint: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
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
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  termsText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  signInContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  signInText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  signInLink: {
    ...typography.bodySmall,
    color: colors.primary,
    fontWeight: '600',
  },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  socialIconButton: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  socialIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
});

export default PhoneRegistrationScreen;
