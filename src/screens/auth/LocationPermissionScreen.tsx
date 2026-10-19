import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { Button } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';
import { locationService } from '../../services/location/locationService';
import { isSupabaseConfigured } from '../../services/database/client';
import { isDemoMode } from '../../utils/demoMode';

interface LocationPermissionScreenProps {
  navigation: any;
}

const LocationPermissionScreen: React.FC<LocationPermissionScreenProps> = ({ navigation }) => {
  const { setAuthenticated, setUser, setMode, user } = useAuthStore();

  const completeOnboarding = () => {
    if (user) {
      // A real account session already exists (created in the OTP step).
      // AppNavigator swaps the auth stack for the user/driver stack.
      setMode(user.mode === 'driver' ? 'driver' : 'user');
      setAuthenticated(true);
      return;
    }
    if (isDemoMode()) {
      // Demo mode: continue with a clearly local demo session. No real
      // account exists and nothing is written to Supabase.
      setUser({
        id: 'demo-user',
        full_name: 'Demo User',
        email: '',
        phone: '',
        mode: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setMode('user');
      setAuthenticated(true);
      return;
    }
    if (isSupabaseConfigured) {
      // Never fabricate a signed-in user when connected to a real database.
      Alert.alert(
        'Session expired',
        'Your sign-in session was not found. Please sign in again.',
        [{ text: 'OK', onPress: () => navigation.navigate('Welcome') }],
      );
      return;
    }
    // Sample mode (no Supabase configured): continue with a clearly local
    // guest session — this is not a real, verified account.
    setUser({
      id: 'local-user',
      full_name: 'Sample User',
      email: '',
      phone: '',
      mode: 'user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setAuthenticated(true);
  };

  const handleGrantPermission = async () => {
    try {
      await locationService.requestPermission();
    } catch {
      // Permission denied or unavailable — user can still continue.
    }
    completeOnboarding();
  };

  const handleMaybeLater = () => {
    completeOnboarding();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Map Background with Dark Overlay */}
      <View style={styles.mapBackground}>
        <View style={styles.mapOverlay} />
      </View>

      {/* White Card at Bottom */}
      <View style={styles.cardContainer}>
        <View style={styles.card}>
          {/* Location Icon */}
          <View style={styles.iconContainer}>
            <Text style={styles.locationIcon}>📍</Text>
          </View>

          {/* Heading */}
          <Text style={styles.heading}>Enable Location</Text>

          {/* Description */}
          <Text style={styles.description}>
            To be able to use the service, we require permission to access your location.
          </Text>

          {/* Grant Permission Button */}
          <Button
            title="Grant Permission"
            onPress={handleGrantPermission}
            fullWidth
            size="lg"
          />

          {/* Maybe Later Button */}
          <View style={styles.spacer} />
          <Button
            title="Maybe Later"
            onPress={handleMaybeLater}
            fullWidth
            size="lg"
            variant="ghost"
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  mapBackground: {
    flex: 1,
    backgroundColor: '#E8E8E8',
    position: 'relative',
  },
  mapOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cardContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    ...shadows.lg,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.redLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  locationIcon: {
    fontSize: 28,
  },
  heading: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  spacer: {
    height: spacing.md,
  },
});

export default LocationPermissionScreen;
