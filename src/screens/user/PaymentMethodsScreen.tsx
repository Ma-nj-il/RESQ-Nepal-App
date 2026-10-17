import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Header, Button, Badge } from '../../components/ui';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';

interface Provider {
  id: string;
  name: string;
  icon: string;
  type: 'wallet' | 'card' | 'bank';
}

/**
 * The providers the design lists. None of them is connected in this build —
 * payment gateway integration is not part of this app (see
 * docs/known-limitations.md). No account details are stored or fabricated.
 */
const providers: Provider[] = [
  { id: 'esewa', name: 'eSewa', icon: '💚', type: 'wallet' },
  { id: 'khalti', name: 'Khalti', icon: '💜', type: 'wallet' },
  { id: 'imepay', name: 'IME Pay', icon: '🟠', type: 'wallet' },
  { id: 'connectips', name: 'Connect IPS', icon: '🏦', type: 'bank' },
  { id: 'card', name: 'Card (Visa / Mastercard)', icon: '💳', type: 'card' },
];

export const PaymentMethodsScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const handleConnect = useCallback((name: string) => {
    Alert.alert(
      `${name} not available`,
      `Connecting ${name} needs a payment provider integration that is not part of this build. No account has been linked and no card data is stored.`,
    );
  }, []);

  const handleAddPayment = useCallback(() => {
    navigation.navigate('AddPayment');
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Payment Methods" showBack onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Honest demo notice */}
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>
            Demo — no payment gateway is integrated in this build. Nothing below is a real
            account, and no money can be moved.
          </Text>
        </View>

        {/* Providers list */}
        <View style={styles.listContainer}>
          {providers.map((provider) => (
            <View key={provider.id} style={styles.methodCard}>
              <View style={styles.methodLeft}>
                <Text style={styles.methodIcon}>{provider.icon}</Text>
                <View style={styles.methodInfo}>
                  <Text style={styles.methodName}>{provider.name}</Text>
                </View>
              </View>
              <View style={styles.methodRight}>
                <Badge label="Not connected" variant="neutral" />
              </View>
              <View style={styles.methodActions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleConnect(provider.name)}
                >
                  <Text style={[styles.actionText, styles.connectText]}>Connect</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* Add Payment Button */}
        <Button
          title="+ Add New Payment"
          variant="primary"
          size="lg"
          fullWidth
          onPress={handleAddPayment}
          style={styles.addButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  noticeCard: {
    backgroundColor: colors.redLight,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  noticeText: { ...typography.bodySmall, color: colors.text, lineHeight: 18 },
  listContainer: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radii.lg,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  methodLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  methodIcon: { fontSize: 28, marginRight: spacing.md },
  methodInfo: { flex: 1 },
  methodName: { ...typography.body, fontWeight: '600' },
  methodRight: { marginRight: spacing.sm },
  methodActions: { marginLeft: spacing.sm },
  actionButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  actionText: { ...typography.bodySmall, color: colors.textSecondary },
  connectText: { color: colors.primary, fontWeight: '600' },
  addButton: { marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xxxl },
});
