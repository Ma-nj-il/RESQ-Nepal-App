import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Clipboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';

type RouteParams = {
  PromoDetail: { promoId: string };
};

interface PromoDetail {
  id: string;
  title: string;
  description: string;
  code: string;
  validFrom: string;
  validUntil: string;
  minSpend: number;
  terms: string[];
  image: string;
}

const MOCK_PROMO_DETAILS: Record<string, PromoDetail> = {
  '1': {
    id: '1',
    title: '50% Off First Ride',
    description: 'Get 50% off on your first ambulance booking. Valid for new users only. This offer cannot be combined with any other promotion.',
    code: 'FIRST50',
    validFrom: '2026-10-01',
    validUntil: '2026-12-31',
    minSpend: 200,
    terms: [
      'Valid for new users only',
      'Minimum booking fare of NPR 200',
      'Cannot be combined with other offers',
      'Valid for Basic ambulance category only',
      'One-time use per user',
      'Offer valid until December 31, 2026',
    ],
    image: '🎉',
  },
  '2': {
    id: '2',
    title: 'NPR 100 Cashback',
    description: 'Get NPR 100 cashback on your next ride. Minimum fare NPR 300. Cashback will be credited to your RESQ Nepal Wallet within 24 hours.',
    code: 'CASH100',
    validFrom: '2026-10-01',
    validUntil: '2026-11-30',
    minSpend: 300,
    terms: [
      'Minimum booking fare of NPR 300',
      'Cashback credited to wallet within 24 hours',
      'Valid for all ambulance categories',
      'One-time use per user',
      'Offer valid until November 30, 2026',
    ],
    image: '💰',
  },
  '3': {
    id: '3',
    title: 'Grande Hospital Partner',
    description: 'Free pickup when booking to Grande International Hospital. This partnership offer provides complimentary pickup service.',
    code: 'GRANDE',
    validFrom: '2026-09-01',
    validUntil: '2026-10-31',
    minSpend: 0,
    terms: [
      'Valid only for bookings to Grande International Hospital',
      'Free pickup service included',
      'Valid for all ambulance categories',
      'Offer valid until October 31, 2026',
    ],
    image: '🏥',
  },
};

const PromoDetailScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'PromoDetail'>>();
  const { promoId } = route.params;

  const [loading, ] = useState(false);
  const [error, ] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const promo = MOCK_PROMO_DETAILS[promoId] || MOCK_PROMO_DETAILS['1'];

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const handleCopyCode = () => {
    Clipboard.setString(promo.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUseNow = () => {
    navigation.goBack();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading promo details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Go Back" onPress={() => navigation.goBack()} variant="outline" style={{ marginTop: spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Promo</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Promo Banner */}
        <View style={styles.bannerContainer}>
          <Text style={styles.bannerImage}>{promo.image}</Text>
        </View>

        {/* Promo Info */}
        <View style={styles.infoContainer}>
          <Text style={styles.promoTitle}>{promo.title}</Text>
          <Text style={styles.promoDescription}>{promo.description}</Text>

          {/* Promo Code Card */}
          <Card elevation="md" style={styles.codeCard}>
            <Text style={styles.codeLabel}>Promo Code</Text>
            <View style={styles.codeRow}>
              <Text style={styles.codeValue}>{promo.code}</Text>
              <TouchableOpacity
                style={[styles.copyButton, copied && styles.copyButtonCopied]}
                onPress={handleCopyCode}
                activeOpacity={0.7}
              >
                <Text style={[styles.copyButtonText, copied && styles.copyButtonTextCopied]}>
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>
          </Card>

          {/* Validity & Requirements */}
          <Card elevation="sm" style={styles.detailsCard}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Valid From</Text>
              <Text style={styles.detailValue}>{formatDate(promo.validFrom)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Valid Until</Text>
              <Text style={styles.detailValue}>{formatDate(promo.validUntil)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Minimum Spend</Text>
              <Text style={styles.detailValue}>
                {promo.minSpend > 0 ? `NPR ${promo.minSpend}` : 'None'}
              </Text>
            </View>
          </Card>

          {/* Terms and Conditions */}
          <Card elevation="sm" style={styles.termsCard}>
            <Text style={styles.termsTitle}>Terms & Conditions</Text>
            {promo.terms.map((term, index) => (
              <View key={index} style={styles.termRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.termText}>{term}</Text>
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>

      {/* Use Now Button */}
      <View style={styles.bottomContainer}>
        <Button title="Use Now" onPress={handleUseNow} fullWidth size="lg" />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center' },

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
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h2 },
  placeholder: { width: 40 },

  bannerContainer: {
    height: 180,
    backgroundColor: colors.redLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerImage: { fontSize: 80 },

  infoContainer: { padding: spacing.lg },
  promoTitle: { ...typography.h1, marginBottom: spacing.sm },
  promoDescription: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
    lineHeight: 24,
  },

  codeCard: { marginBottom: spacing.lg },
  codeLabel: { ...typography.caption, color: colors.textTertiary, marginBottom: spacing.sm },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codeValue: { ...typography.h2, color: colors.primary, letterSpacing: 2 },
  copyButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  copyButtonCopied: { backgroundColor: colors.success },
  copyButtonText: { ...typography.buttonSmall, color: colors.surface },
  copyButtonTextCopied: { color: colors.surface },

  detailsCard: { marginBottom: spacing.lg },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  detailLabel: { ...typography.bodySmall, color: colors.textSecondary },
  detailValue: { ...typography.bodySmall, fontWeight: '600' },

  termsCard: { marginBottom: spacing.lg },
  termsTitle: { ...typography.h4, marginBottom: spacing.md },
  termRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  bullet: { ...typography.bodySmall, color: colors.primary, marginTop: 2 },
  termText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },

  bottomContainer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});

export default PromoDetailScreen;
