import React, { useCallback } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/auth/authService';
import { colors, radii, spacing, typography } from '../../constants/theme';

const DRAWER_WIDTH = Math.min(340, Math.round(Dimensions.get('window').width * 0.86));

const DESTINATIONS = [
  { label: 'Home & Map', icon: '⌂', route: 'DriverHome' },
  { label: 'Requests & Alerts', icon: '⚑', route: 'DriverRequests' },
  { label: 'Earnings', icon: '◉', route: 'DriverEarnings' },
  { label: 'Profile', icon: '●', route: 'DriverProfile' },
  { label: 'My Ambulance', icon: '🚑', route: 'VehicleManagement' },
  { label: 'Driver Application', icon: '▤', route: 'DriverRegistration' },
  { label: 'Application Status', icon: '◷', route: 'ApplicationStatus' },
  { label: 'Settings', icon: '⚙', route: 'DriverSettings' },
] as const;

const DriverDrawerScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const insets = useSafeAreaInsets();
  const { logout, returnToUserMode, isDemoDriver } = useAuthStore();
  const [slideX] = React.useState(() => new Animated.Value(-DRAWER_WIDTH));
  const [backdropOpacity] = React.useState(() => new Animated.Value(0));

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(slideX, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [backdropOpacity, slideX]);

  const close = useCallback((action: () => void) => {
    Animated.parallel([
      Animated.timing(slideX, { toValue: -DRAWER_WIDTH, duration: 160, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(action);
  }, [backdropOpacity, slideX]);

  const handleLogout = () => {
    Alert.alert('Log out', 'Log out of Driver Mode?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => close(() => {
          if (isDemoDriver) {
            logout();
            return;
          }
          void authService.signOut().catch(() => undefined).finally(logout);
        }),
      },
    ]);
  };

  const openDestination = (
    routeName: string,
    params?: Record<string, string>,
  ) => {
    const routes = navigation.getState().routes as { name: string }[];
    const targetIndex = routes.findIndex((route) => route.name === routeName);
    const tripIndex = routes.findIndex((route) => route.name === 'DriverTrip');
    close(() => {
      if (tripIndex >= 0 && targetIndex >= 0 && targetIndex < tripIndex) {
        navigation.replace(routeName, params);
      } else if (targetIndex >= 0) {
        navigation.popTo(routeName, params);
      } else {
        navigation.replace(routeName, params);
      }
    });
  };

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => close(() => navigation.goBack())}
          accessibilityRole="button"
          accessibilityLabel="Close driver menu"
        />
      </Animated.View>
      <Animated.View
        style={[styles.drawer, { width: DRAWER_WIDTH, transform: [{ translateX: slideX }] }]}
        accessibilityViewIsModal
      >
        <SafeAreaView style={styles.safe} edges={['bottom']}>
          <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
            <View style={styles.brandMark}><Text style={styles.brandCross}>✚</Text></View>
            <Text style={styles.brand}>RESQ Nepal</Text>
            <TouchableOpacity
              style={styles.close}
              onPress={() => close(() => navigation.goBack())}
              accessibilityRole="button"
              accessibilityLabel="Close driver menu"
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            {DESTINATIONS.map((item) => (
              <TouchableOpacity
                key={item.route}
                style={styles.row}
                onPress={() => openDestination(
                  item.route,
                  item.route === 'ApplicationStatus' ? { type: 'DRIVER' } : undefined,
                )}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <Text style={styles.rowIcon}>{item.icon}</Text>
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.row}
              onPress={() => close(returnToUserMode)}
              accessibilityRole="button"
              accessibilityLabel="Switch to User Mode"
            >
              <Text style={styles.rowIcon}>⇄</Text>
              <Text style={styles.rowLabel}>Switch to User Mode</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.row}
              onPress={handleLogout}
              accessibilityRole="button"
              accessibilityLabel="Log out"
            >
              <Text style={styles.rowIcon}>↪</Text>
              <Text style={[styles.rowLabel, styles.danger]}>Log Out</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.background,
    borderTopRightRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    overflow: 'hidden',
  },
  safe: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    paddingHorizontal: spacing.lg,
  },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  brandCross: { color: colors.surface, fontSize: 16, fontWeight: '800' },
  brand: { ...typography.h4, color: colors.text, flex: 1 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.textSecondary, fontSize: 20 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIcon: { width: 34, color: colors.primary, fontSize: 20, textAlign: 'center' },
  rowLabel: { ...typography.body, color: colors.text, flex: 1, marginLeft: spacing.sm },
  chevron: { fontSize: 22, color: colors.textTertiary },
  divider: { height: spacing.lg },
  danger: { color: colors.error, fontWeight: '600' },
});

export default DriverDrawerScreen;
