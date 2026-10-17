import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Button, LoadingOverlay } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { useWalletStore } from '../../store/walletStore';

const METHODS = [
  { id: 'esewa', name: 'eSewa', icon: '💚', detail: 'Pay with your eSewa wallet' },
  { id: 'khalti', name: 'Khalti', icon: '💜', detail: 'Pay with your Khalti wallet' },
  { id: 'ime', name: 'IME Pay', icon: '🧡', detail: 'Pay with IME Pay' },
  { id: 'card', name: 'Debit / Credit Card', icon: '💳', detail: 'Visa, Mastercard accepted' },
  { id: 'bank', name: 'Connect IPS', icon: '🏦', detail: 'Direct bank transfer' },
];

const TopUpMethodScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const amount: number = route.params?.amount ?? 1000;
  const { topUp } = useWalletStore();
  const [selected, setSelected] = useState('esewa');
  const [loading, setLoading] = useState(false);

  const handleConfirm = () => {
    setLoading(true);
    setTimeout(() => {
      // Demo wallet only — no payment provider is called and no money moves.
      topUp(amount);
      setLoading(false);
      navigation.replace('TopUpSuccess', { amount, demo: true });
    }, 900);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose Top Up Method</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.navigate('AddPayment')}>
          <Text style={styles.addText}>+</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.methodDetail, { marginBottom: spacing.md }]}>
          Payment providers are not integrated in this build. Confirming adds the amount to a
          local demo wallet only — no money moves and nothing is charged.
        </Text>
        {METHODS.map((method) => {
          const isSelected = selected === method.id;
          return (
            <TouchableOpacity
              key={method.id}
              style={[styles.methodCard, isSelected && styles.methodCardSelected]}
              onPress={() => setSelected(method.id)}
              activeOpacity={0.8}
            >
              <Text style={styles.methodIcon}>{method.icon}</Text>
              <View style={styles.methodInfo}>
                <Text style={styles.methodName}>{method.name}</Text>
                <Text style={styles.methodDetail}>{method.detail}</Text>
              </View>
              {isSelected && <Text style={styles.checkIcon}>✓</Text>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={`Confirm Top Up - Rs. ${amount.toLocaleString('en-IN')}`}
          onPress={handleConfirm}
          fullWidth
        />
      </View>
      <LoadingOverlay visible={loading} message="Recording demo top-up..." />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 24, color: colors.text },
  addText: { fontSize: 26, color: colors.text },
  headerTitle: { ...typography.h3, fontSize: 18 },
  content: { padding: spacing.lg, paddingTop: 0 },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  methodCardSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: '#FFF8F8' },
  methodIcon: { fontSize: 26 },
  methodInfo: { flex: 1 },
  methodName: { ...typography.body, fontWeight: '600' },
  methodDetail: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  checkIcon: { fontSize: 20, color: colors.primary, fontWeight: '700' },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
});

export default TopUpMethodScreen;
