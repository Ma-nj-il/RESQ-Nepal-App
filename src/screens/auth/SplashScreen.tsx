import { AppText } from '../../components/ui/AppText';
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button } from '../../components/ui';
import { ONBOARDING_SEEN_KEY } from '../../constants/storage';
import { UserServiceError } from '../../services/api/userService';
import { authService } from '../../services/auth/authService';
import { useAuthStore } from '../../store/authStore';

interface SplashScreenProps {
  navigation: any;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ navigation }) => {
  const { setUser, setMode, setAuthenticated } = useAuthStore();
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    const boot = async () => {
      const startedAt = Date.now();

      let restored;
      try {
        // A stored token is accepted only after the user service validates it.
        restored = await authService.restoreSession();
      } catch (error) {
        if (!active) return;
        setRestoreError(
          error instanceof UserServiceError
            ? error.message
            : 'Could not validate your saved session. Check your connection and retry.',
        );
        return;
      }
      if (!active) return;
      if (restored) {
        setUser(restored.user);
        setMode(restored.mode);
        setAuthenticated(true);
        // The root navigator swaps to the user/driver stack; this screen
        // unmounts — no navigation call is needed (or wanted) here.
        return;
      }

      // Keep the splash visible for a moment even when restore is instant.
      const elapsed = Date.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1500 - elapsed)));
      if (!active) return;

      const seen = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY).catch(() => null);
      if (!active) return;
      navigation.replace(seen ? 'Welcome' : 'Onboarding');
    };

    boot();
    return () => {
      active = false;
    };
  }, [navigation, restoreAttempt, setAuthenticated, setMode, setUser]);

  const continueSignedOut = async () => {
    try {
      await authService.signOut();
    } catch {
      setRestoreError('The saved session could not be removed from this device. Please retry.');
      return;
    }
    const seen = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY).catch(() => null);
    navigation.replace(seen ? 'Welcome' : 'Onboarding');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.crossHorizontal} />
          <View style={styles.crossVertical} />
        </View>

        {/* App Name */}
        <AppText style={styles.appName}>RESQ Nepal</AppText>
        <AppText style={styles.tagline}>Emergency Ambulance Booking</AppText>

        {restoreError && (
          <View style={styles.errorCard}>
            <AppText style={styles.errorText}>{restoreError}</AppText>
            <Button
              title="Retry"
              variant="secondary"
              fullWidth
              onPress={() => {
                setRestoreError(null);
                setRestoreAttempt((attempt) => attempt + 1);
              }}
            />
            <Button
              title="Sign in again"
              variant="ghost"
              fullWidth
              onPress={() => void continueSignedOut()}
            />
          </View>
        )}
      </View>

      {/* Loading Indicator */}
      <View style={styles.footer}>
        {!restoreError && <ActivityIndicator size="small" color={colors.surface} />}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  crossHorizontal: {
    position: 'absolute',
    width: 80,
    height: 24,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
  },
  crossVertical: {
    position: 'absolute',
    width: 24,
    height: 80,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
  },
  appName: {
    ...typography.h1,
    color: colors.surface,
    fontSize: 32,
    letterSpacing: 1,
  },
  tagline: {
    ...typography.body,
    color: 'rgba(255,255,255,0.8)',
    marginTop: spacing.sm,
  },
  errorCard: {
    width: '86%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.xxl,
    gap: spacing.sm,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: spacing.xs,
  },
  footer: {
    paddingBottom: spacing.xxxl,
    alignItems: 'center',
  },
});

export default SplashScreen;
