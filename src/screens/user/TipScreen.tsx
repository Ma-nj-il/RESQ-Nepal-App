import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button,  Avatar, Input } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';

const TIP_PRESETS = [1, 2, 3, 5, 10, 25];

const TipScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [paying, setPaying] = useState(false);

  const handlePresetSelect = (amount: number) => {
    setSelectedAmount(amount);
    setCustomAmount('');
  };

  const handleCustomChange = (text: string) => {
    setCustomAmount(text);
    setSelectedAmount(null);
  };

  const handlePayTip = async () => {
    const amount = selectedAmount || parseFloat(customAmount);
    if (!amount || amount <= 0) return;
    setPaying(true);
    // Tips are not charged: capturing money needs a payment provider that
    // is not part of this build. Say so instead of pretending to pay.
    await new Promise((resolve) => setTimeout(resolve, 600));
    setPaying(false);
    Alert.alert(
      'Tipping Not Available Yet',
      `The NPR ${amount} tip was not charged. Tip payments require a payment provider integration — see docs/known-limitations.md.`,
      [{ text: 'OK', onPress: () => navigation.popTo('Activity') }],
    );
  };

  const handleSkip = () => {
    navigation.popTo('Activity');
  };

  const currentAmount = selectedAmount || parseFloat(customAmount) || 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Close Button */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleSkip} style={styles.closeButton}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Driver Avatar */}
        <View style={styles.avatarContainer}>
          <Avatar name="Driver" size="lg" />
        </View>

        {/* Heading */}
        <Text style={styles.heading}>Add a Tip</Text>
        <Text style={styles.subtitle}>
          Would you like to add a tip to make your driver&apos;s day?
        </Text>

        {/* Tip Amount Buttons */}
        <View style={styles.tipGrid}>
          {TIP_PRESETS.map((amount) => (
            <TouchableOpacity
              key={amount}
              style={[
                styles.tipButton,
                selectedAmount === amount && styles.tipButtonSelected,
              ]}
              onPress={() => handlePresetSelect(amount)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.tipButtonText,
                  selectedAmount === amount && styles.tipButtonTextSelected,
                ]}
              >
                NPR {amount}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom Amount Input */}
        <View style={styles.customInputContainer}>
          <Text style={styles.customInputLabel}>Enter custom amount</Text>
          <View style={styles.customInputWrapper}>
            <Text style={styles.currencySymbol}>NPR</Text>
            <Input
              style={styles.customInput}
              placeholder="0"
              keyboardType="numeric"
              value={customAmount}
              onChangeText={handleCustomChange}
            />
          </View>
        </View>

        {/* Wallet Note */}
        <View style={styles.noteContainer}>
          <Text style={styles.noteIcon}>ℹ️</Text>
          <Text style={styles.noteText}>
            Tip will be charged from your RESQ Nepal Wallet
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Buttons */}
      <View style={styles.bottomButtons}>
        <Button
          title="Skip"
          onPress={handleSkip}
          variant="ghost"
          size="lg"
          style={styles.skipButton}
        />
        <Button
          title={paying ? 'Processing...' : `Pay Tip $${currentAmount}`}
          onPress={handlePayTip}
          fullWidth
          size="lg"
          disabled={currentAmount <= 0}
          loading={paying}
          style={styles.payButton}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scrollContent: { padding: spacing.xl, alignItems: 'center' },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 18, color: colors.text },

  avatarContainer: { marginBottom: spacing.lg, marginTop: spacing.md },
  heading: { ...typography.h1, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },

  tipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
    width: '100%',
  },
  tipButton: {
    width: '28%',
    paddingVertical: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  tipButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.redLight,
  },
  tipButtonText: { ...typography.h3, color: colors.text },
  tipButtonTextSelected: { color: colors.primary },

  customInputContainer: { width: '100%', marginBottom: spacing.lg },
  customInputLabel: { ...typography.bodySmall, fontWeight: '600', marginBottom: spacing.sm },
  customInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  currencySymbol: { ...typography.h3, color: colors.textSecondary, marginRight: spacing.sm },
  customInput: { flex: 1, marginBottom: 0 },

  noteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.blueLight,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    width: '100%',
  },
  noteIcon: { fontSize: 16 },
  noteText: { ...typography.caption, color: colors.info, flex: 1 },

  bottomButtons: {
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  skipButton: { paddingHorizontal: spacing.xl },
  payButton: { flex: 1 },
});

export default TipScreen;
