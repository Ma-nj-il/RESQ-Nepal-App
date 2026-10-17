import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';

/**
 * Payment provider integration is NOT part of this build. This screen never
 * collects card numbers or any payment credentials — previously it rendered a
 * full card form that only pretended to save. It now explains the actual
 * situation instead.
 */
const supportedPayments = [
  { name: 'eSewa', icon: '💚' },
  { name: 'Khalti', icon: '💜' },
  { name: 'IME Pay', icon: '🟠' },
  { name: 'Connect IPS', icon: '🏦' },
  { name: 'Cards', icon: '💳' },
];

export const AddPaymentScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const handleClose = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add New Payment</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Honest notice: no form is shown because nothing could be saved or charged. */}
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Not available in this build</Text>
          <Text style={styles.noticeText}>
            RESQ Nepal does not collect or store card numbers, and no payment gateway (eSewa,
            Khalti, IME Pay, Connect IPS or cards) is integrated yet. Nothing entered here could
            be charged or saved, so this form is disabled.
          </Text>
        </View>

        {/* Supported Payments */}
        <View style={styles.supportedSection}>
          <Text style={styles.supportedTitle}>Planned Payment Methods</Text>
          <View style={styles.supportedList}>
            {supportedPayments.map((payment) => (
              <View key={payment.name} style={styles.supportedItem}>
                <Text style={styles.supportedIcon}>{payment.icon}</Text>
                <Text style={styles.supportedName}>{payment.name}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Done Button */}
        <Button
          title="Done"
          variant="primary"
          size="lg"
          fullWidth
          onPress={handleClose}
          style={styles.saveButton}
        />
      </ScrollView>
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
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeIcon: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h3 },
  placeholder: { width: 40 },
  scrollView: { flex: 1 },
  noticeCard: {
    backgroundColor: colors.redLight,
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.md,
  },
  noticeTitle: { ...typography.body, fontWeight: '700', marginBottom: spacing.xs },
  noticeText: { ...typography.bodySmall, color: colors.text, lineHeight: 19 },
  supportedSection: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  supportedTitle: { ...typography.h4, marginBottom: spacing.md },
  supportedList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  supportedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  supportedIcon: { fontSize: 20, marginRight: spacing.xs },
  supportedName: { ...typography.bodySmall, fontWeight: '600' },
  saveButton: { marginHorizontal: spacing.lg, marginTop: spacing.xxl, marginBottom: spacing.xxxl },
});

export default AddPaymentScreen;
