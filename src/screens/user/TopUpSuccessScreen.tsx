import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Button } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { useWalletStore } from '../../store/walletStore';

const TopUpSuccessScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const amount: number = route.params?.amount ?? 1000;
  const { balance } = useWalletStore();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.checkCircle}>
          <Text style={styles.checkIcon}>✓</Text>
        </View>
        <Text style={styles.title}>Demo Top Up Recorded</Text>
        <Text style={styles.message}>
          Rs. {amount.toLocaleString('en-IN')} was added to the local demo wallet (new demo
          balance: Rs. {balance.toLocaleString('en-IN')}). No real payment was made — payment
          providers are not integrated in this build.
        </Text>
      </View>
      <View style={styles.footer}>
        <Button title="OK" onPress={() => navigation.navigate('Home')} fullWidth />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  checkIcon: { fontSize: 36, color: colors.surface, fontWeight: '700' },
  title: { ...typography.h2, marginBottom: spacing.md },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  footer: { padding: spacing.lg },
});

export default TopUpSuccessScreen;
