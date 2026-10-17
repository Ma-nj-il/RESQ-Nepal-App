import React from 'react';
import { View, Text, StyleSheet, ScrollView , TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Button } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';


const TopUpDetailsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const amount: number = route.params?.amount ?? 2500;
  const method: string = route.params?.method ?? 'eSewa';

  const now = new Date();
  const dateString = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Top Up Details</Text>
        <TouchableOpacity style={styles.backButton}>
          <Text style={styles.menuText}>⋮</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.amountCard}>
          <View style={styles.plusCircle}>
            <Text style={styles.plusIcon}>+</Text>
          </View>
          <Text style={styles.amountText}>Rs. {amount.toLocaleString('en-IN')}.00</Text>
          <Text style={styles.walletLabel}>RESQ Nepal Wallet (demo)</Text>
          <Text style={styles.methodLabel}>Demo top-up via {method}</Text>
        </View>

        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Status</Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>Demo</Text>
            </View>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Payment</Text>
            <Text style={styles.detailValue}>{method} (not integrated)</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date</Text>
            <Text style={styles.detailValue}>{dateString}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Time</Text>
            <Text style={styles.detailValue}>{timeString}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Transaction ID</Text>
            <Text style={styles.detailValue}>None — no real payment was made</Text>
          </View>
        </View>

        <Button
          title="Share Receipt"
          variant="outline"
          onPress={() => navigation.navigate('ShareReceipt')}
          fullWidth
          style={{ marginTop: spacing.lg }}
        />
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
  menuText: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h3, fontSize: 18 },
  content: { padding: spacing.lg, paddingTop: 0 },
  amountCard: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.lg,
  },
  plusCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  plusIcon: { fontSize: 26, color: colors.primary, fontWeight: '600' },
  amountText: { ...typography.h1, marginBottom: spacing.xs },
  walletLabel: { ...typography.body, fontWeight: '600', marginBottom: 2 },
  methodLabel: { ...typography.bodySmall, color: colors.textSecondary },
  detailsCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  detailLabel: { ...typography.body, color: colors.textSecondary },
  detailValue: { ...typography.body, fontWeight: '600' },
  statusBadge: {
    backgroundColor: colors.greenLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  statusText: { ...typography.caption, color: colors.success, fontWeight: '600' },
});

export default TopUpDetailsScreen;
