import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { ONBOARDING_SEEN_KEY } from '../../constants/storage';
import { authService } from '../../services/auth/authService';
import { useAuthStore } from '../../store/authStore';

interface SplashScreenProps {
  navigation: any;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ navigation }) => {
  const { setUser, setMode, setAuthenticated } = useAuthStore();

  useEffect(() => {
    let active = true;

    const boot = async () => {
      const startedAt = Date.now();

      // Restore a persisted Supabase session, if one exists.
      const restored = await authService.restoreSession();
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
  }, [navigation, setAuthenticated, setMode, setUser]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.crossHorizontal} />
          <View style={styles.crossVertical} />
        </View>

        {/* App Name */}
        <Text style={styles.appName}>RESQ Nepal</Text>
        <Text style={styles.tagline}>Emergency Ambulance Booking</Text>
      </View>

      {/* Loading Indicator */}
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.surface} />
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
  footer: {
    paddingBottom: spacing.xxxl,
    alignItems: 'center',
  },
});

export default SplashScreen;
