import { AppText } from '../../components/ui/AppText';
import React, { useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Avatar } from '../../components/ui';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { driversService, isSupabaseConfigured } from '../../services/database';
import { useAuthStore } from '../../store/authStore';
import { useWalletStore } from '../../store/walletStore';
import { authService } from '../../services/auth/authService';
import { useTripCounts } from '../../hooks/useTripCounts';
import { isDemoMode } from '../../utils/demoMode';
import { isAuthorizedDriverStatus } from '../../utils/homeBooking';
import { confirmAction } from '../../utils/confirmAction';

interface AccountMenuItem {
  id: string;
  label: string;
  icon: string;
  route: string;
  params?: Record<string, unknown>;
}

const menuItems: AccountMenuItem[] = [
  {
    id: 'identity',
    label: 'Identity Verification',
    icon: '🪪',
    route: 'ApplicationStatus',
    params: { type: 'USER' },
  },
  { id: 'notifications', label: 'Notifications', icon: '🔔', route: 'Notifications' },
  { id: 'payment', label: 'Payment Methods', icon: '💳', route: 'PaymentMethods' },
  { id: 'security', label: 'Account & Security', icon: '🔒', route: 'Security' },
  { id: 'appearance', label: 'App Appearance', icon: '🎨', route: 'Appearance' },
  { id: 'help', label: 'Help & Support', icon: '❓', route: 'Help' },
  { id: 'sos', label: 'Emergency SOS', icon: '🆘', route: 'SOS' },
];

export const AccountScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user, logout, setMode } = useAuthStore();
  const { balance } = useWalletStore();
  const { counts, loading: countsLoading, error: countsError, usingSampleData } = useTripCounts();

  const handleLogout = useCallback(() => {
    confirmAction(
      'Logout',
      'Sure you want to log out?',
      async () => {
        await authService.signOut();
        logout();
      },
      { confirmLabel: 'Yes, Logout', destructive: true },
    );
  }, [logout]);

  const handleSwitchToDriver = useCallback(async () => {
    if (!user?.id || !isSupabaseConfigured || isDemoMode()) {
      navigation.navigate('DriverOnboarding');
      return;
    }
    try {
      const driver = await driversService.getByUserId(user.id);
      if (isAuthorizedDriverStatus(driver?.status)) {
        setMode('driver');
      } else {
        navigation.navigate('DriverOnboarding');
      }
    } catch {
      Alert.alert(
        'Driver access unavailable',
        'We could not verify driver authorization. Please try again or continue with driver registration.',
        [
          { text: 'Try registration', onPress: () => navigation.navigate('DriverOnboarding') },
          { text: 'Close', style: 'cancel' },
        ],
      );
    }
  }, [navigation, setMode, user]);

  const handleMenuPress = useCallback(
    (route: string, params?: Record<string, unknown>) => {
      navigation.navigate(route, params);
    },
    [navigation]
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <AppText style={styles.backArrow}>←</AppText>
        </TouchableOpacity>
        <AppText style={styles.headerTitle}>Account</AppText>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Card */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => handleMenuPress('PersonalInfo')}
          style={styles.profileCard}
        >
          <Avatar name={user?.full_name || 'User'} uri={user?.avatar_url} size="lg" />
          <View style={styles.profileInfo}>
            <AppText style={styles.profileName}>{user?.full_name || 'Guest User'}</AppText>
            <AppText style={styles.profilePhone}>{user?.phone || '+977 XXX XXX XXX'}</AppText>
          </View>
          <AppText style={styles.arrow}>›</AppText>
        </TouchableOpacity>

        {/* Wallet Card — the booking journey is cash-only in this version, so
            the card is informational: no top-up or online payment is offered. */}
        <Card elevation="md" style={styles.walletCard}>
          <View style={styles.walletContent}>
            <View style={styles.walletInfo}>
              <AppText style={styles.walletLabel}>Wallet Balance (demo)</AppText>
              <AppText style={styles.walletBalance}>NPR {balance.toLocaleString('en-IN')}</AppText>
              <AppText style={styles.walletNote}>
                Cash only in this version. Wallet top-up and online payments are not active.
              </AppText>
            </View>
          </View>
        </Card>

        {/* Trip summary — real counts from the user's booking records. */}
        <Card elevation="sm" style={styles.tripsCard}>
          <AppText style={styles.tripsTitle}>Your trips</AppText>
          {countsLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: spacing.md }} />
          ) : countsError ? (
            <AppText style={styles.tripsError}>{countsError}</AppText>
          ) : (
            <View style={styles.tripsRow}>
              <View style={styles.tripsStat}>
                <AppText style={styles.tripsValue}>{counts.total}</AppText>
                <AppText style={styles.tripsLabel}>Total</AppText>
              </View>
              <View style={styles.tripsStat}>
                <AppText style={styles.tripsValue}>{counts.completed}</AppText>
                <AppText style={styles.tripsLabel}>Completed</AppText>
              </View>
              <View style={styles.tripsStat}>
                <AppText style={styles.tripsValue}>{counts.cancelled}</AppText>
                <AppText style={styles.tripsLabel}>Cancelled</AppText>
              </View>
              <View style={styles.tripsStat}>
                <AppText style={styles.tripsValue}>{counts.active}</AppText>
                <AppText style={styles.tripsLabel}>Active</AppText>
              </View>
            </View>
          )}
          {!countsLoading && !countsError && usingSampleData && (
            <AppText style={styles.tripsNote}>
              Sample walkthrough data — your real counts appear when signed in.
            </AppText>
          )}
        </Card>

        {/* Driver Mode Switch */}
        <Card elevation="sm" style={styles.driverCard}>
          <View style={styles.driverRow}>
            <AppText style={styles.driverIcon}>🚑</AppText>
            <View style={styles.driverInfo}>
              <AppText style={styles.driverTitle}>Drive with RESQ Nepal</AppText>
              <AppText style={styles.driverSubtitle}>
                Switch to Driver Mode to manage your ambulance and requests
              </AppText>
            </View>
          </View>
          <Button
            title="Switch to Driver Mode"
            variant="outline"
            size="sm"
            fullWidth
            onPress={handleSwitchToDriver}
            style={{ marginTop: spacing.md }}
          />
        </Card>

        {/* Menu List */}
        <Card elevation="sm" style={styles.menuCard}>
          {menuItems.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.menuItem, index < menuItems.length - 1 && styles.menuItemBorder]}
              activeOpacity={0.7}
              onPress={() => handleMenuPress(item.route, item.params)}
            >
              <View style={styles.menuItemLeft}>
                <AppText style={styles.menuIcon}>{item.icon}</AppText>
                <AppText style={styles.menuLabel}>{item.label}</AppText>
              </View>
              <AppText style={styles.menuArrow}>›</AppText>
            </TouchableOpacity>
          ))}
        </Card>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutButton} activeOpacity={0.7} onPress={handleLogout}>
          <AppText style={styles.logoutText}>Logout</AppText>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.md,
  },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h2 },
  scrollView: { flex: 1 },
  // Breathing room for the last row above the home indicator.
  scrollContent: { paddingBottom: spacing.xxxl },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    ...shadows.sm,
  },
  profileInfo: { flex: 1, marginLeft: spacing.md },
  profileName: { ...typography.h4 },
  profilePhone: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  arrow: { fontSize: 24, color: colors.textTertiary, marginLeft: spacing.sm },
  walletCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.primary,
  },
  walletContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  walletInfo: { flex: 1 },
  walletLabel: { ...typography.bodySmall, color: 'rgba(255,255,255,0.8)' },
  walletBalance: { ...typography.h2, color: colors.surface, marginTop: 2 },
  walletNote: { ...typography.caption, color: 'rgba(255,255,255,0.9)', marginTop: spacing.xs },
  tripsCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  tripsTitle: { ...typography.bodySmall, fontWeight: '600', color: colors.text },
  tripsRow: { flexDirection: 'row', marginTop: spacing.md },
  tripsStat: { flex: 1, alignItems: 'center' },
  tripsValue: { ...typography.h3, color: colors.text },
  tripsLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  tripsNote: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.md },
  tripsError: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.sm },
  driverCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  driverRow: { flexDirection: 'row', alignItems: 'center' },
  driverIcon: { fontSize: 28, marginRight: spacing.md },
  driverInfo: { flex: 1 },
  driverTitle: { ...typography.body, fontWeight: '600' },
  driverSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  menuCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: 0,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center' },
  menuIcon: { fontSize: 20 },
  menuLabel: { ...typography.body, marginLeft: spacing.md },
  menuArrow: { fontSize: 20, color: colors.textTertiary },
  logoutButton: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.xxxl,
  },
  logoutText: { ...typography.button, color: colors.primary },
});
