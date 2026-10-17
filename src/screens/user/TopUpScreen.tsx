import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { useWalletStore } from '../../store/walletStore';

const QUICK_AMOUNTS = [500, 1000, 2000, 2500, 5000, 7500, 10000, 15000, 20000];

const TopUpScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { balance } = useWalletStore();
  const [amount, setAmount] = useState('1000');

  const handleKeyPress = (key: string) => {
    if (key === 'del') {
      setAmount((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
    } else if (key === '.') {
      if (!amount.includes('.')) setAmount((prev) => prev + '.');
    } else {
      if (amount === '0') {
        setAmount(key);
      } else if (amount.length < 7) {
        setAmount((prev) => prev + key);
      }
    }
  };

  const handleContinue = () => {
    const value = parseFloat(amount || '0');
    if (value <= 0) return;
    navigation.navigate('TopUpMethod', { amount: value });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Top Up</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.amountBox}>
          <View style={styles.amountRow}>
            <Text style={styles.amountText}>{amount || '0'}</Text>
            <Text style={styles.currencyText}>Rs.</Text>
          </View>
          <Text style={styles.balanceText}>
            Available balance (demo): Rs. {balance.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.balanceText}>
            Demo wallet — no real money is stored in this build.
          </Text>
        </View>

        <View style={styles.quickGrid}>
          {QUICK_AMOUNTS.map((value) => {
            const label = value >= 1000 ? `${value / 1000}K` : `${value}`;
            const selected = amount === String(value);
            return (
              <TouchableOpacity
                key={value}
                style={[styles.quickChip, selected && styles.quickChipSelected]}
                onPress={() => setAmount(String(value))}
                activeOpacity={0.7}
              >
                <Text style={[styles.quickChipText, selected && styles.quickChipTextSelected]}>
                  Rs. {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Button title="Continue" onPress={handleContinue} fullWidth style={{ marginTop: spacing.lg }} />

        <View style={styles.keypad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map((key) => (
            <TouchableOpacity
              key={key}
              style={styles.key}
              onPress={() => handleKeyPress(key)}
              activeOpacity={0.6}
            >
              <Text style={styles.keyText}>{key === 'del' ? '⌫' : key}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
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
  headerTitle: { ...typography.h3 },
  content: { padding: spacing.lg, paddingTop: 0 },
  amountBox: {
    backgroundColor: colors.input,
    borderRadius: radii.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  amountText: { fontSize: 44, fontWeight: '700', color: colors.text },
  currencyText: { fontSize: 22, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
  balanceText: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.sm },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  quickChip: {
    width: '31%',
    paddingVertical: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  quickChipSelected: { backgroundColor: colors.redLight, borderColor: colors.primary },
  quickChipText: { ...typography.bodySmall, fontWeight: '600', color: colors.text },
  quickChipTextSelected: { color: colors.primary },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.xl,
  },
  key: { width: '33.33%', paddingVertical: spacing.lg, alignItems: 'center' },
  keyText: { fontSize: 24, fontWeight: '600', color: colors.text },
});

export default TopUpScreen;
