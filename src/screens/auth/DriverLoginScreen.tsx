import { AppText } from '../../components/ui/AppText';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../../store/authStore';
import { Button, Card, Header } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { isDemoMode } from '../../utils/demoMode';
import { driversService, isSupabaseConfigured } from '../../services/database';
import { isAuthorizedDriverStatus } from '../../utils/homeBooking';

const DriverLoginScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { user, loginDemoDriver, returnToUserMode, setMode } = useAuthStore();
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canContinueAsVerifiedDriver = Boolean(user?.id && isSupabaseConfigured && !isDemoMode());

  const handleDemoLogin = () => {
    if (!isDemoMode()) {
      setError('Driver demo login is available only when EXPO_PUBLIC_DEMO_MODE=true.');
      return;
    }
    if (!loginDemoDriver()) {
      setError('Enable demo mode to preview Driver Mode.');
    } else {
      setError(null);
    }
  };

  const handleVerifiedDriverLogin = async () => {
    if (!user?.id || !canContinueAsVerifiedDriver || verifying) return;
    setVerifying(true);
    try {
      const driver = await driversService.getByUserId(user.id);
      if (isAuthorizedDriverStatus(driver?.status)) {
        setError(null);
        setMode('driver');
      } else {
        setError('This account does not have an approved driver profile. Driver applications require review.');
      }
    } catch {
      setError('We could not verify this driver account. Try again.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Driver Login" showBack />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brand}>
          <AppText style={styles.icon}>🚑</AppText>
          <AppText style={styles.title}>Driver Mode</AppText>
          <AppText style={styles.subtitle}>
            Preview the RESQ Nepal driver experience. Demo mode only.
          </AppText>
          {error && <AppText style={styles.error}>{error}</AppText>}
        </View>
        <Card elevation="sm" style={styles.card}>
          <AppText style={styles.demoLabel}>DEMO DRIVER</AppText>
          <AppText style={styles.note}>
            This local walkthrough uses fictional sample information. It does not sign in a real
            driver or update any server records.
          </AppText>
          <Button
            title="Login via Demo"
            onPress={handleDemoLogin}
            fullWidth
            size="lg"
            style={styles.loginButton}
          />
          {canContinueAsVerifiedDriver && (
            <Button
              title="Continue as approved driver"
              onPress={handleVerifiedDriverLogin}
              loading={verifying}
              disabled={verifying}
              variant="outline"
              fullWidth
              style={styles.loginButton}
            />
          )}
        </Card>
        <Button
          title="Return to User Mode"
          variant="outline"
          fullWidth
          onPress={() => {
            if (useAuthStore.getState().isDemoDriver) returnToUserMode();
            else navigation.goBack();
          }}
          style={styles.returnButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  brand: { alignItems: 'center', marginBottom: spacing.xxl },
  icon: { fontSize: 48, marginBottom: spacing.md },
  title: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  error: { ...typography.bodySmall, color: colors.error, textAlign: 'center', marginTop: spacing.md },
  card: { padding: spacing.lg },
  demoLabel: { ...typography.h4, color: colors.primary, marginBottom: spacing.sm },
  note: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 20 },
  loginButton: { marginTop: spacing.lg },
  returnButton: { marginTop: spacing.md },
});

export default DriverLoginScreen;
