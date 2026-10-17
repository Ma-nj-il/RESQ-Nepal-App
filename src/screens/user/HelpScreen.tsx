import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Header } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';

const helpItems = [
  { id: 'faq', label: 'FAQ', icon: '❓', route: 'FAQ' },
  { id: 'contact', label: 'Contact Support', icon: '📞', route: 'ContactSupport' },
  { id: 'privacy', label: 'Privacy Policy', icon: '🔒', route: 'PrivacyPolicy' },
  { id: 'terms', label: 'Terms of Service', icon: '📄', route: 'TermsOfService' },
  { id: 'partner', label: 'Partner', icon: '🤝', route: 'Partner' },
  { id: 'jobs', label: 'Job Vacancy', icon: '💼', route: 'JobVacancy' },
  { id: 'accessibility', label: 'Accessibility', icon: '♿', route: 'Accessibility' },
  { id: 'feedback', label: 'Feedback', icon: '💬', route: 'Feedback' },
  { id: 'about', label: 'About us', icon: 'ℹ️', route: 'About' },
  { id: 'rate', label: 'Rate us', icon: '⭐', route: 'RateUs' },
  { id: 'website', label: 'Visit Our Website', icon: '🌐', externalUrl: 'https://resq.com.np' },
  { id: 'social', label: 'Follow us on Social Media', icon: '📱', route: 'SocialMedia' },
];

// Only routes that are actually registered in the navigator may be opened;
// the rest show an honest notice instead of navigating nowhere.
const BUILT_ROUTES = ['FAQ', 'PrivacyPolicy', 'TermsOfService'];

export const HelpScreen: React.FC = () => {
  const navigation = useNavigation<any>();


  const handlePress = useCallback(
    (item: typeof helpItems[0]) => {
      if (item.externalUrl) {
        Linking.openURL(item.externalUrl).catch(() => {
          Alert.alert('Link unavailable', 'Could not open the website on this device.');
        });
      } else if (item.route && BUILT_ROUTES.includes(item.route)) {
        navigation.navigate(item.route);
      } else {
        Alert.alert(item.label, `${item.label} is not available in this build yet.`);
      }
    },
    [navigation]
  );

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Help & Support" showBack onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.listContainer}>
          {helpItems.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.menuItem, index < helpItems.length - 1 && styles.menuItemBorder]}
              activeOpacity={0.7}
              onPress={() => handlePress(item)}
            >
              <View style={styles.menuLeft}>
                <Text style={styles.menuIcon}>{item.icon}</Text>
                <Text style={styles.menuLabel}>{item.label}</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  listContainer: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radii.lg,
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
  menuLeft: { flexDirection: 'row', alignItems: 'center' },
  menuIcon: { fontSize: 20, marginRight: spacing.md },
  menuLabel: { ...typography.body },
  arrow: { fontSize: 20, color: colors.textTertiary },
});
