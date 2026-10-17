import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Avatar} from '../../components/ui';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { useWalletStore } from '../../store/walletStore';
import { authService } from '../../services/auth/authService';

const menuItems = [
  { id: 'notifications', label: 'Notifications', icon: '🔔', route: 'Notifications' },
  { id: 'payment', label: 'Payment Methods', icon: '💳', route: 'PaymentMethods' },
  { id: 'security', label: 'Account & Security', icon: '🔒', route: 'Security' },
  { id: 'linked', label: 'Linked Accounts', icon: '🔗', route: 'Security' },
  { id: 'appearance', label: 'App Appearance', icon: '🎨', route: 'Appearance' },
  { id: 'data', label: 'Data & Analytics', icon: '📊', route: 'Security' },
  { id: 'help', label: 'Help & Support', icon: '❓', route: 'Help' },
  { id: 'rate', label: 'Rate us', icon: '⭐', route: 'Help' },
];

const tabs = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'ambulances', label: 'Ambulances', icon: '🚑' },
  { id: 'activity', label: 'Activity', icon: '📋' },
  { id: 'account', label: 'Account', icon: '👤' },
];

export const AccountScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user, logout, setMode } = useAuthStore();
  const { balance } = useWalletStore();
  const [isLoading, ] = useState(false);

  const handleLogout = useCallback(() => {
    Alert.alert('Logout', 'Sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes, Logout',
        style: 'destructive',
        onPress: async () => {
          // End the real Supabase session (clears the persisted session),
          // then clear local state so AppNavigator swaps to the auth stack.
          try {
            await authService.signOut();
          } catch {
            // Local sign-out still proceeds.
          }
          logout();
        },
      },
    ]);
  }, [logout]);

  const handleSwitchToDriver = useCallback(() => {
    setMode('driver');
  }, [setMode]);

  const handleMenuPress = useCallback(
    (route: string) => {
      navigation.navigate(route);
    },
    [navigation]
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Account</Text>
        <TouchableOpacity style={styles.menuButton}>
          <Text style={styles.menuIcon}>⋮</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => handleMenuPress('PersonalInfo')}
          style={styles.profileCard}
        >
          <Avatar name={user?.full_name || 'User'} uri={user?.avatar_url} size="lg" />
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user?.full_name || 'Guest User'}</Text>
            <Text style={styles.profilePhone}>{user?.phone || '+977 XXX XXX XXX'}</Text>
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>

        {/* Wallet Card */}
        <Card elevation="md" style={styles.walletCard}>
          <View style={styles.walletContent}>
            <View>
              <Text style={styles.walletLabel}>Wallet Balance (demo)</Text>
              <Text style={styles.walletBalance}>NPR {balance.toLocaleString('en-IN')}</Text>
              <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                Demo balance — no real money is stored in this build.
              </Text>
            </View>
            <Button title="Top Up" variant="primary" size="sm" onPress={() => navigation.navigate('TopUp')} />
          </View>
        </Card>

        {/* Driver Mode Switch */}
        <Card elevation="sm" style={styles.driverCard}>
          <View style={styles.driverRow}>
            <Text style={styles.driverIcon}>🚑</Text>
            <View style={styles.driverInfo}>
              <Text style={styles.driverTitle}>Drive with RESQ Nepal</Text>
              <Text style={styles.driverSubtitle}>
                Switch to Driver Mode to manage your ambulance and requests
              </Text>
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
              onPress={() => handleMenuPress(item.route)}
            >
              <View style={styles.menuItemLeft}>
                <Text style={styles.menuIcon}>{item.icon}</Text>
                <Text style={styles.menuLabel}>{item.label}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </Card>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutButton} activeOpacity={0.7} onPress={handleLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={styles.navItem}
            activeOpacity={0.7}
            onPress={() => {
              if (tab.id === 'account') return;
              navigation.navigate(tab.id.charAt(0).toUpperCase() + tab.id.slice(1));
            }}
          >
            <Text style={[styles.navIcon, tab.id === 'account' && styles.navIconActive]}>
              {tab.icon}
            </Text>
            <Text style={[styles.navLabel, tab.id === 'account' && styles.navLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { ...typography.body, color: colors.textSecondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { ...typography.h2 },
  menuButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { fontSize: 28, color: colors.text, fontWeight: '700' },
  scrollView: { flex: 1 },
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
  walletLabel: { ...typography.bodySmall, color: 'rgba(255,255,255,0.8)' },
  walletBalance: { ...typography.h2, color: colors.surface, marginTop: 2 },
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
  menuLabel: { ...typography.body, marginLeft: spacing.md },
  menuArrow: { fontSize: 20, color: colors.textTertiary },
  logoutButton: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.xxxl,
  },
  logoutText: { ...typography.button, color: colors.primary },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
  },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  navIcon: { fontSize: 22, color: colors.textTertiary },
  navIconActive: { color: colors.primary },
  navLabel: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  navLabelActive: { color: colors.primary, fontWeight: '600' },
});
