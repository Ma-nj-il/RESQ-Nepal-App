import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card, Header } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { APP_NAME, APP_VERSION } from '../../constants/appInfo';

interface LinkRowProps {
  label: string;
  onPress: () => void;
}

const LinkRow: React.FC<LinkRowProps> = ({ label, onPress }) => (
  <TouchableOpacity
    style={styles.linkRow}
    onPress={onPress}
    activeOpacity={0.7}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <Text style={styles.linkLabel}>{label}</Text>
    <Text style={styles.linkChevron}>›</Text>
  </TouchableOpacity>
);

const AboutScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.container}>
      <Header title="About" showBack onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandBlock}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>✚</Text>
          </View>
          <Text style={styles.brandName}>{APP_NAME}</Text>
          <Text style={styles.brandTag}>Ambulance booking</Text>
          <Text style={styles.version}>Version {APP_VERSION}</Text>
        </View>

        <Card elevation="sm" style={styles.card}>
          <Text style={styles.cardTitle}>What RESQ Nepal does</Text>
          <Text style={styles.cardBody}>
            Book a Basic Patient Delivery or an ICU / Emergency Ambulance in Kathmandu Valley,
            follow the request status, and pay the driver in cash after the trip.
          </Text>
        </Card>

        <Card elevation="sm" style={styles.card}>
          <Text style={styles.cardTitle}>What this build does not do yet</Text>
          <Text style={styles.bullet}>• Ambulance assignment depends on the dispatch service and a verified driver partner network.</Text>
          <Text style={styles.bullet}>• Online payments are not active — cash only.</Text>
          <Text style={styles.bullet}>• Nepali translations are not implemented yet.</Text>
          <Text style={styles.bullet}>• Saved hospitals stay on this phone; saved places are stored with your account.</Text>
          <Text style={styles.bullet}>• Driver partner applications are collected as a draft and reviewed once onboarding opens.</Text>
        </Card>

        <Card elevation="sm" style={styles.emergencyCard}>
          <Text style={styles.cardTitle}>Emergency notice</Text>
          <Text style={styles.cardBody}>
            RESQ Nepal is not a replacement for national emergency services. In a life-threatening
            situation, contact your local emergency services or the nearest hospital directly.
          </Text>
        </Card>

        <Card elevation="sm" style={styles.card}>
          <LinkRow label="Privacy Policy" onPress={() => navigation.navigate('PrivacyPolicy')} />
          <LinkRow label="Terms of Service" onPress={() => navigation.navigate('TermsOfService')} />
          <LinkRow label="Help & Support" onPress={() => navigation.navigate('Help')} />
        </Card>

        <Text style={styles.footer}>
          Built on the existing RESQ Nepal mobile app. This screen describes only features that
          exist in this build.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

export default AboutScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  brandBlock: { alignItems: 'center', paddingVertical: spacing.xl },
  brandMark: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  brandMarkText: { color: colors.surface, fontWeight: '800', fontSize: 26 },
  brandName: { ...typography.h2, color: colors.text },
  brandTag: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  version: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.sm },
  card: { padding: spacing.lg, marginBottom: spacing.md },
  cardTitle: { ...typography.body, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  cardBody: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 20 },
  bullet: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.xs },
  emergencyCard: {
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  linkLabel: { ...typography.body, color: colors.primary, fontWeight: '600' },
  linkChevron: { fontSize: 20, color: colors.textTertiary },
  footer: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.lg },
});
