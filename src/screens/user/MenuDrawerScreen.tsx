import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/auth/authService';

const DRAWER_WIDTH = Math.min(340, Math.round(Dimensions.get('window').width * 0.86));

const DESTINATIONS = [
  { label: 'Home', icon: '⌂', route: 'Home', section: 'primary' },
  { label: 'My Trips History', icon: '◷', route: 'Activity', section: 'primary' },
  { label: 'Saved Hospitals', icon: '▣', route: 'SavedHospitals', section: 'primary' },
  { label: 'Saved Places', icon: '⌖', route: 'SavedPlaces', section: 'primary' },
  { label: 'Notifications', icon: '♧', route: 'Notifications', section: 'primary' },
  { label: 'Profile', icon: '●', route: 'PersonalInfo', section: 'account' },
  { label: 'My Account', icon: '◉', route: 'Account', section: 'account' },
  { label: 'Settings', icon: '⚙︎', route: 'Settings', section: 'account' },
  {
    label: 'Application Status',
    icon: '▤',
    route: 'ApplicationStatus',
    section: 'account',
    params: { type: 'USER' },
  },
  { label: 'Help & Support', icon: '?', route: 'Help', section: 'support' },
  { label: 'Legal & Privacy', icon: '§', route: 'PrivacyPolicy', section: 'support' },
  { label: 'About RESQ Nepal', icon: 'ⓘ', route: 'About', section: 'support' },
] as const;

type MenuDestination = (typeof DESTINATIONS)[number];

const ROUTE_LABELS: Record<string, string> = {
  Activity: 'My Trips History',
  PersonalInfo: 'Profile',
  PrivacyPolicy: 'Legal & Privacy',
};

const MenuRow: React.FC<{
  item: MenuDestination;
  active: boolean;
  onPress: () => void;
}> = ({ item, active, onPress }) => (
  <TouchableOpacity
    style={[styles.row, active && styles.activeRow]}
    onPress={onPress}
    activeOpacity={0.75}
    accessibilityRole="button"
    accessibilityLabel={item.label}
    accessibilityState={{ selected: active }}
    hitSlop={2}
  >
    <View style={[styles.activeMarker, active && styles.activeMarkerVisible]} />
    <Text style={[styles.rowIcon, active && styles.activeIcon]}>{item.icon}</Text>
    <Text style={[styles.rowLabel, active && styles.activeLabel]} numberOfLines={1}>
      {item.label}
    </Text>
    <Text style={styles.chevron}>›</Text>
  </TouchableOpacity>
);

const MenuDrawerScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const [slideX] = useState(() => new Animated.Value(-DRAWER_WIDTH));
  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const closingRef = useRef(false);
  const activeRoute = useNavigationState((state) => {
    const current = state.routes[state.index];
    if (current?.name !== 'MenuDrawer') return current?.name ?? 'Home';
    return state.routes[state.index - 1]?.name ?? 'Home';
  });
  const activeLabel = ROUTE_LABELS[activeRoute] ?? activeRoute;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideX, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [backdropOpacity, slideX]);

  const close = useCallback(
    (action: () => void = () => navigation.goBack()) => {
      if (closingRef.current) return;
      closingRef.current = true;
      Animated.parallel([
        Animated.timing(slideX, { toValue: -DRAWER_WIDTH, duration: 160, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start(action);
    },
    [backdropOpacity, navigation, slideX],
  );

  const openDestination = useCallback(
    (item: MenuDestination) => {
      const routes = navigation.getState().routes;
      const targetIndex = routes.findIndex((route) => route.name === item.route);
      close(() => {
        if (targetIndex >= 0) {
          navigation.popTo(item.route, 'params' in item ? item.params : undefined);
        } else {
          navigation.replace(item.route, 'params' in item ? item.params : undefined);
        }
      });
    },
    [close, navigation],
  );

  const handleLogout = useCallback(() => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          try {
            await authService.signOut();
          } catch {
            // Local sign-out still proceeds if the network is unavailable.
          }
          logout();
        },
      },
    ]);
  }, [logout]);

  const handleSwitchToDriverMode = useCallback(() => {
    close(() => navigation.replace('DriverLogin'));
  }, [close, navigation]);

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => close()}
          accessibilityRole="button"
          accessibilityLabel="Dismiss menu"
        />
      </Animated.View>

      <Animated.View
        style={[styles.drawer, { width: DRAWER_WIDTH, transform: [{ translateX: slideX }] }]}
        accessibilityViewIsModal
      >
        <SafeAreaView style={styles.safe} edges={['bottom']}>
          <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
            <View style={styles.brandMark}>
              <Text style={styles.brandCross}>✚</Text>
            </View>
            <Text style={styles.brand}>RESQ Nepal</Text>
            <TouchableOpacity
              style={styles.close}
              onPress={() => close()}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
              hitSlop={4}
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.profile}>
            <Avatar name={user?.full_name || 'User'} uri={user?.avatar_url} size="md" />
            <View style={styles.profileInfo}>
              <Text style={styles.profileName} numberOfLines={1}>
                {user?.full_name || 'Guest User'}
              </Text>
              <Text style={styles.profileRole}>Patient account</Text>
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(insets.bottom, spacing.xl) },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.sectionLabel}>YOUR RESQ</Text>
            <View style={styles.section}>
              {DESTINATIONS.filter((item) => item.section === 'primary').map((item) => (
                <MenuRow
                  key={item.route}
                  item={item}
                  active={activeLabel === item.label}
                  onPress={() => openDestination(item)}
                />
              ))}
            </View>

            <Text style={styles.sectionLabel}>ACCOUNT</Text>
            <View style={styles.section}>
              {DESTINATIONS.filter((item) => item.section === 'account').map((item) => (
                <MenuRow
                  key={item.route}
                  item={item}
                  active={activeLabel === item.label}
                  onPress={() => openDestination(item)}
                />
              ))}
            </View>

            <Text style={styles.sectionLabel}>SUPPORT</Text>
            <View style={styles.section}>
              {DESTINATIONS.filter((item) => item.section === 'support').map((item) => (
                <MenuRow
                  key={item.route}
                  item={item}
                  active={activeLabel === item.label}
                  onPress={() => openDestination(item)}
                />
              ))}
            </View>

            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.footerRow}
                onPress={handleSwitchToDriverMode}
                accessibilityRole="button"
                accessibilityLabel="Switch to Driver Mode"
              >
                <Text style={styles.rowIcon}>⇄</Text>
                <Text style={styles.rowLabel}>Switch to Driver Mode</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.footerRow, styles.logoutRow]}
                onPress={handleLogout}
                accessibilityRole="button"
                accessibilityLabel="Log out"
              >
                <Text style={[styles.rowIcon, styles.danger]}>↪</Text>
                <Text style={[styles.rowLabel, styles.danger]}>Log Out</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
};

export default MenuDrawerScreen;

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
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
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
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.textSecondary, fontSize: 20 },
  profile: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  profileInfo: { flex: 1, marginLeft: spacing.md },
  profileName: { ...typography.body, color: colors.text, fontWeight: '600' },
  profileRole: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  sectionLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.sm,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  row: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingRight: spacing.md,
  },
  activeRow: { backgroundColor: colors.redLight },
  activeMarker: { width: 3, height: 26, backgroundColor: 'transparent', marginRight: spacing.sm },
  activeMarkerVisible: { backgroundColor: colors.primary },
  rowIcon: { width: 34, color: colors.primary, fontSize: 20, textAlign: 'center' },
  activeIcon: { fontWeight: '700' },
  rowLabel: { ...typography.bodySmall, color: colors.text, flex: 1, marginLeft: spacing.sm },
  activeLabel: { color: colors.primaryDark, fontWeight: '700' },
  chevron: { fontSize: 22, color: colors.textTertiary, marginLeft: spacing.sm },
  footer: {
    marginTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  logoutRow: { borderBottomWidth: 0 },
  danger: { color: colors.error, fontWeight: '600' },
});
