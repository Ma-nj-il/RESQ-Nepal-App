import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button } from '../../components/ui';

interface WelcomeScreenProps {
  navigation: any;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ navigation }) => {
  const handleSignUp = () => {
    navigation.navigate('PhoneRegistration');
  };

  const handleSignIn = () => {
    navigation.navigate('Login');
  };

  const handleSocialLogin = (provider: string) => {
    Alert.alert(
      `${provider} sign-in`,
      `${provider} sign-in is not available in this build. Please continue with your phone number.`,
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Logo Section */}
        <View style={styles.logoSection}>
          <View style={styles.logoContainer}>
            <View style={styles.crossHorizontal} />
            <View style={styles.crossVertical} />
          </View>
          <Text style={styles.logoText}>RESQ Nepal</Text>
        </View>

        {/* Heading */}
        <View style={styles.headingSection}>
          <Text style={styles.heading}>Let&apos;s Get Started!</Text>
          <Text style={styles.subheading}>Let&apos;s dive in to your account</Text>
        </View>

        {/* Google is shown as an option but reports that OAuth is not configured. */}
        <View style={styles.socialContainer}>
          <TouchableOpacity
            style={styles.socialButton}
            onPress={() => handleSocialLogin('Google')}
            activeOpacity={0.7}
          >
            <Text style={styles.socialIcon}>G</Text>
            <Text style={styles.socialText}>Continue with Google</Text>
          </TouchableOpacity>

        </View>

        {/* Or Divider */}
        <View style={styles.dividerContainer}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Action Buttons */}
        <View style={styles.actionContainer}>
          <Button title="Sign up" onPress={handleSignUp} fullWidth size="lg" />
          <View style={styles.spacer} />
          <Button title="Sign in" onPress={handleSignIn} fullWidth size="lg" variant="outline" />
        </View>

        <View style={styles.driverEntry}>
          <Text style={styles.driverPrompt}>Are you an ambulance driver?</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('DriverLogin')}
            accessibilityRole="button"
            accessibilityLabel="Driver Login"
          >
            <Text style={styles.driverLink}>🚑  Driver Login</Text>
          </TouchableOpacity>
        </View>

        {/* Footer Links */}
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => navigation.navigate('PrivacyPolicy')}>
            <Text style={styles.footerLink}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.footerSeparator}>•</Text>
          <TouchableOpacity onPress={() => navigation.navigate('TermsOfService')}>
            <Text style={styles.footerLink}>Terms of Service</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  logoContainer: {
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  crossHorizontal: {
    position: 'absolute',
    width: 70,
    height: 22,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
  },
  crossVertical: {
    position: 'absolute',
    width: 22,
    height: 70,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
  },
  logoText: {
    ...typography.h3,
    color: colors.primary,
  },
  headingSection: {
    marginBottom: spacing.xxl,
  },
  heading: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subheading: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  socialContainer: {
    gap: spacing.md,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  socialIcon: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  socialText: {
    ...typography.body,
    fontWeight: '500',
    color: colors.text,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xl,
    gap: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    ...typography.bodySmall,
    color: colors.textTertiary,
  },
  actionContainer: {
    marginBottom: spacing.xl,
  },
  driverEntry: { alignItems: 'center', marginBottom: spacing.md },
  driverPrompt: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  driverLink: { ...typography.body, color: colors.primary, fontWeight: '700', padding: spacing.sm },
  spacer: {
    height: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: 'auto',
    paddingTop: spacing.xl,
  },
  footerLink: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  footerSeparator: {
    ...typography.bodySmall,
    color: colors.textTertiary,
  },
});

export default WelcomeScreen;
