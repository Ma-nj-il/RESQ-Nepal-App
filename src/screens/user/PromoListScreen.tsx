import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Button, EmptyState, BottomSheet, Input } from '../../components/ui';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';

type CategoryTab = 'all' | 'discount' | 'cashback' | 'partnership';

const CATEGORY_TABS: { key: CategoryTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'discount', label: 'Discount' },
  { key: 'cashback', label: 'Cashback' },
  { key: 'partnership', label: 'Partnership' },
];

interface Promo {
  id: string;
  title: string;
  description: string;
  code: string;
  expiry: string;
  category: 'discount' | 'cashback' | 'partnership';
  image: string;
}

const MOCK_PROMOS: Promo[] = [
  {
    id: '1',
    title: '50% Off First Ride',
    description: 'Get 50% off on your first ambulance booking. Valid for new users only.',
    code: 'FIRST50',
    expiry: '2026-12-31',
    category: 'discount',
    image: '🎉',
  },
  {
    id: '2',
    title: 'NPR 100 Cashback',
    description: 'Get NPR 100 cashback on your next ride. Minimum fare NPR 300.',
    code: 'CASH100',
    expiry: '2026-11-30',
    category: 'cashback',
    image: '💰',
  },
  {
    id: '3',
    title: 'Grande Hospital Partner',
    description: 'Free pickup when booking to Grande International Hospital.',
    code: 'GRANDE',
    expiry: '2026-10-31',
    category: 'partnership',
    image: '🏥',
  },
  {
    id: '4',
    title: '20% Off ICU Booking',
    description: 'Get 20% off on ICU ambulance bookings. Limited time offer.',
    code: 'ICU20',
    expiry: '2026-11-15',
    category: 'discount',
    image: '🚑',
  },
  {
    id: '5',
    title: 'Refer & Earn NPR 200',
    description: 'Refer a friend and earn NPR 200 wallet credit for each successful booking.',
    code: 'REFER200',
    expiry: '2026-12-31',
    category: 'cashback',
    image: '👥',
  },
];

const PromoListScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  const [activeCategory, setActiveCategory] = useState<CategoryTab>('all');
  const [loading, ] = useState(false);
  const [redeemVisible, setRedeemVisible] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [redeemState, setRedeemState] = useState<'idle' | 'applied' | 'invalid'>('idle');
  const [appliedPromo, setAppliedPromo] = useState<Promo | null>(null);

  const filteredPromos = activeCategory === 'all'
    ? MOCK_PROMOS
    : MOCK_PROMOS.filter((p) => p.category === activeCategory);

  const formatExpiry = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleRedeem = () => {
    const entered = codeInput.trim().toUpperCase();
    const match = MOCK_PROMOS.find((p) => p.code.toUpperCase() === entered);
    if (!entered) return;
    if (match) {
      setAppliedPromo(match);
      setRedeemState('applied');
    } else {
      setAppliedPromo(null);
      setRedeemState('invalid');
    }
  };

  const closeRedeem = () => {
    setRedeemVisible(false);
    setRedeemState('idle');
    setCodeInput('');
  };

  const renderPromoCard = ({ item }: { item: Promo }) => (
    <Card
      elevation="sm"
      style={styles.promoCard}
      onPress={() => navigation.navigate('PromoDetail', { promoId: item.id })}
    >
      <View style={styles.promoImageContainer}>
        <Text style={styles.promoImage}>{item.image}</Text>
      </View>
      <View style={styles.promoContent}>
        <Text style={styles.promoTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.promoDescription} numberOfLines={2}>{item.description}</Text>
        <View style={styles.promoFooter}>
          <View style={styles.codeContainer}>
            <Text style={styles.codeText}>{item.code}</Text>
          </View>
          <Text style={styles.expiryText}>Expires: {formatExpiry(item.expiry)}</Text>
        </View>
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Promos</Text>
        <TouchableOpacity style={styles.menuButton}>
          <Text style={styles.menuIcon}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* Promo Code Card */}
      <TouchableOpacity
        style={styles.promoCodeCard}
        activeOpacity={0.7}
        onPress={() => setRedeemVisible(true)}
      >
        <Text style={styles.promoCodeText}>Have a Promo Code?</Text>
        <Text style={styles.promoCodeArrow}>→</Text>
      </TouchableOpacity>

      {/* Category Tabs */}
      <View style={styles.categoryTabs}>
        {CATEGORY_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.categoryTab, activeCategory === tab.key && styles.activeCategoryTab]}
            onPress={() => setActiveCategory(tab.key)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.categoryTabText,
                activeCategory === tab.key && styles.activeCategoryTabText,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Promo List */}
      {loading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredPromos}
          renderItem={renderPromoCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="🎁"
              title="No Promos Found"
              message="There are no promotions in this category right now."
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* OK Button */}
      <View style={styles.bottomContainer}>
        <Button title="OK" onPress={() => navigation.goBack()} fullWidth size="lg" />
      </View>

      {/* Redeem Promo Code Sheet */}
      <BottomSheet visible={redeemVisible} onClose={closeRedeem}>
        {redeemState === 'idle' && (
          <View style={styles.redeemContent}>
            <Text style={styles.redeemPercent}>%</Text>
            <Text style={styles.redeemTitle}>Have a Promo Code?</Text>
            <Input
              placeholder="Enter promo code"
              value={codeInput}
              onChangeText={setCodeInput}
              autoCapitalize="characters"
            />
            <Button title="Redeem" onPress={handleRedeem} fullWidth />
          </View>
        )}

        {redeemState === 'applied' && appliedPromo && (
          <View style={styles.redeemContent}>
            <View style={styles.redeemSuccessCircle}>
              <Text style={styles.redeemSuccessIcon}>✓</Text>
            </View>
            <Text style={styles.redeemTitle}>Promo Code Applied!</Text>
            <Text style={styles.redeemMessage}>
              Your promo code has been successfully redeemed. Enjoy your discounted ride!
            </Text>
            <View style={styles.redeemActions}>
              <Button
                title="Use Later"
                variant="outline"
                onPress={closeRedeem}
                style={{ flex: 1 }}
              />
              <Button
                title="Use Now"
                onPress={() => {
                  closeRedeem();
                  navigation.navigate('Home');
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}

        {redeemState === 'invalid' && (
          <View style={styles.redeemContent}>
            <View style={styles.redeemErrorCircle}>
              <Text style={styles.redeemErrorIcon}>✕</Text>
            </View>
            <Text style={styles.redeemTitle}>Whoops!</Text>
            <Text style={styles.redeemMessage}>
              It looks like the promo code you entered is invalid or expired.
            </Text>
            <Button title="Try Again" onPress={() => setRedeemState('idle')} fullWidth />
          </View>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

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
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: { fontSize: 24, color: colors.text },

  promoCodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    ...shadows.md,
  },
  promoCodeText: { ...typography.h4, color: colors.surface },
  promoCodeArrow: { fontSize: 24, color: colors.surface },

  categoryTabs: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  categoryTab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeCategoryTab: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryTabText: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '500' },
  activeCategoryTabText: { color: colors.surface, fontWeight: '700' },

  listContent: { padding: spacing.md, flexGrow: 1 },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  promoCard: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  promoImageContainer: {
    width: 80,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.redLight,
  },
  promoImage: { fontSize: 36 },
  promoContent: { flex: 1, padding: spacing.md },
  promoTitle: { ...typography.h4, marginBottom: spacing.xs },
  promoDescription: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.sm },
  promoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codeContainer: {
    backgroundColor: colors.input,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  codeText: { ...typography.caption, fontWeight: '700', color: colors.primary },
  expiryText: { ...typography.caption, color: colors.textTertiary },

  bottomContainer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  redeemContent: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  redeemPercent: { fontSize: 44, fontWeight: '700', color: colors.primary },
  redeemTitle: { ...typography.h4, textAlign: 'center' },
  redeemMessage: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  redeemSuccessCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redeemSuccessIcon: { fontSize: 28, color: colors.surface, fontWeight: '700' },
  redeemErrorCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redeemErrorIcon: { fontSize: 28, color: colors.surface, fontWeight: '700' },
  redeemActions: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
    marginTop: spacing.sm,
  },
});

export default PromoListScreen;
