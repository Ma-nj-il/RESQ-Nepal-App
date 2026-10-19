import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Avatar, Card } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/auth/authService';
import { useTripCounts } from '../../hooks/useTripCounts';

const PANEL_WIDTH = Math.min(340, Math.round(Dimensions.get('window').width * 0.86));

interface MenuRowProps {
  icon: string;
  label: string;
  onPress: () => void;
}

const MenuRow: React.FC<MenuRowProps> = ({ icon, label, onPress }) => (
  <TouchableOpacity
    style={styles.menuRow}
    onPress={onPress}
    activeOpacity={0.7}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Text style={styles.menuIcon}>{icon}</Text>
    <Text style={styles.menuLabel}>{label}</Text>
    <Text style={styles.menuChevron}>›</Text>
  </TouchableOpacity>
);

/**
 * The top-left menu: profile header, real trip counters and every account
 * destination in one panel. Presented as a transparent modal; the panel
 * slides in from the left and closes on backdrop tap or Android back.
 */
const MenuDrawerScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user, logout } = useAuthStore();
  const { counts, loading, error, usingSampleData, reload } = useTripCounts();

  // Modal screens can miss the provider's live insets on iOS; fall back to
  // the launch-time window metrics so the panel never sits under the notch.
  const insets = useSafeAreaInsets();
  const topInset = insets.top > 0 ? insets.top : initialWindowMetrics?.insets.top ?? 0;
  const bottomInset = insets.bottom > 0 ? insets.bottom : initialWindowMetrics?.insets.bottom ?? 0;

  // Animated values are created once with lazy state initialisers so they can
  // be used during render without touching a ref's `.current`.
  const [slideX] = useState(() => new Animated.Value(-PANEL_WIDTH));
  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const closingRef = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideX, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [backdropOpacity, slideX]);

  const animateOut = useCallback(
    (done: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      Animated.parallel([
        Animated.timing(slideX, { toValue: -PANEL_WIDTH, duration: 170, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 170, useNativeDriver: true }),
      ]).start(done);
    },
    [backdropOpacity, slideX],
  );

  // Backdrop taps and the ✕ simply close the modal.
  const close = useCallback(() => animateOut(() => navigation.goBack()), [animateOut, navigation]);

  // Menu items replace the drawer with the target screen while it is still
  // mounted — no post-unmount navigation and the back button returns Home.
  const go = useCallback(
    (route: string, params?: Record<string, unknown>) =>
      animateOut(() => navigation.replace(route, params)),
    [animateOut, navigation],
  );

  const handleLogout = useCallback(() => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes, log out',
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

  return (
    <View style={styles.root}>
      {/* Dimmed backdrop — tapping outside the panel closes the menu. */}
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => close()}
          accessibilityRole="button"
          accessibilityLabel="Dismiss menu"
        />
      </Animated.View>

      <Animated.View
        style={[styles.panel, { width: PANEL_WIDTH, transform: [{ translateX: slideX }] }]}
        accessibilityViewIsModal
      >
        <View style={styles.panelSafe}>
          <View style={[styles.panelHeader, { paddingTop: topInset + spacing.sm }]}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkGlyph}>✚</Text>
              </View>
              <Text style={styles.brandName}>RESQ Nepal</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => close()}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: bottomInset + spacing.xxl },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {/* Profile header — tapping it opens the profile screen. */}
            <TouchableOpacity
              style={styles.profileRow}
              activeOpacity={0.7}
              onPress={() => go('PersonalInfo')}
              accessibilityRole="button"
              accessibilityLabel="View profile"
            >
              <Avatar name={user?.full_name || 'User'} uri={user?.avatar_url} size="lg" />
              <View style={styles.profileInfo}>
                <Text style={styles.profileName} numberOfLines={1}>
                  {user?.full_name || 'Guest User'}
                </Text>
                <Text style={styles.profileRole} numberOfLines={1}>
                  Patient
                </Text>
                <Text style={styles.profileLink}>View Profile ›</Text>
              </View>
            </TouchableOpacity>

            {/* Trip counters — real records for the signed-in user. */}
            <Card elevation="sm" style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Your trips</Text>
              {loading ? (
                <View style={styles.summaryLoading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.summaryLoadingText}>Counting your trips…</Text>
                </View>
              ) : error ? (
                <View style={styles.summaryError}>
                  <Text style={styles.summaryErrorText}>{error}</Text>
                  <TouchableOpacity
                    onPress={reload}
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading trip summary"
                  >
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.statsRow}>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{counts.total}</Text>
                    <Text style={styles.statLabel}>Total</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{counts.completed}</Text>
                    <Text style={styles.statLabel}>Completed</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{counts.cancelled}</Text>
                    <Text style={styles.statLabel}>Cancelled</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{counts.active}</Text>
                    <Text style={styles.statLabel}>Active</Text>
                  </View>
                </View>
              )}
              {!loading && !error && usingSampleData && (
                <Text style={styles.sampleNote}>
                  Sample walkthrough data. Your own counts appear once you book with a signed-in account.
                </Text>
              )}
            </Card>

            <Text style={styles.groupLabel}>Bookings &amp; places</Text>
            <View style={styles.group}>
              <MenuRow icon="📋" label="My Trips" onPress={() => go('Activity')} />
              <MenuRow icon="🚑" label="Ambulance" onPress={() => go('AmbulanceList')} />
              <MenuRow icon="🏥" label="Saved Hospitals" onPress={() => go('SavedHospitals')} />
              <MenuRow icon="📍" label="Saved Places" onPress={() => go('SavedPlaces')} />
              <MenuRow icon="🔔" label="Notifications" onPress={() => go('Notifications')} />
            </View>

            <Text style={styles.groupLabel}>Safety &amp; driving</Text>
            <View style={styles.group}>
              <MenuRow icon="🆘" label="Safety & SOS" onPress={() => go('SOS')} />
              <MenuRow
                icon="🪪"
                label="Application Status"
                onPress={() => go('ApplicationStatus', { type: 'USER' })}
              />
              <MenuRow icon="🧑✈️" label="Become a Driver" onPress={() => go('DriverOnboarding')} />
            </View>

            <Text style={styles.groupLabel}>Settings &amp; information</Text>
            <View style={styles.group}>
              <MenuRow icon="👤" label="My Account" onPress={() => go('Account')} />
              <MenuRow icon="⚙️" label="Settings" onPress={() => go('Settings')} />
              <MenuRow icon="❓" label="Help & Support" onPress={() => go('Help')} />
              <MenuRow icon="📄" label="Legal & Privacy" onPress={() => go('PrivacyPolicy')} />
              <MenuRow icon="ℹ️" label="About RESQ Nepal" onPress={() => go('About')} />
            </View>

            <TouchableOpacity
              style={styles.logoutRow}
              onPress={handleLogout}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Log out"
            >
              <Text style={styles.menuIcon}>🚪</Text>
              <Text style={[styles.menuLabel, styles.menuLabelDanger]}>Log Out</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Animated.View>
    </View>
  );
};

export default MenuDrawerScreen;

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.background,
    borderTopRightRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    overflow: 'hidden',
  },
  panelSafe: { flex: 1 },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkGlyph: { color: colors.surface, fontSize: 15, fontWeight: '800' },
  brandName: { ...typography.h4, color: colors.text },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 20, color: colors.textSecondary, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  profileInfo: { flex: 1 },
  profileName: { ...typography.h4, color: colors.text },
  profileRole: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  profileLink: { ...typography.caption, color: colors.primary, marginTop: 4, fontWeight: '600' },
  summaryCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.lg,
  },
  summaryTitle: { ...typography.bodySmall, fontWeight: '600', color: colors.text },
  summaryLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  summaryLoadingText: { ...typography.caption, color: colors.textSecondary },
  summaryError: { marginTop: spacing.sm },
  summaryErrorText: { ...typography.bodySmall, color: colors.textSecondary },
  retryText: { ...typography.bodySmall, color: colors.primary, fontWeight: '600', marginTop: spacing.sm },
  statsRow: { flexDirection: 'row', marginTop: spacing.md },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { ...typography.h3, color: colors.text },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  sampleNote: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.md },
  groupLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.xl,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    marginHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuIcon: { fontSize: 18, width: 30, textAlign: 'center' },
  menuLabel: { ...typography.body, color: colors.text, flex: 1 },
  menuLabelDanger: { color: colors.error, fontWeight: '600' },
  menuChevron: { fontSize: 20, color: colors.textTertiary },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
