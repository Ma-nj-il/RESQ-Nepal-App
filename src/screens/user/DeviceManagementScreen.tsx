import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';

const DeviceManagementScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Device Management</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.description}>
          Manage the devices that are currently signed in to your RESQ Nepal account.
        </Text>

        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>
            Listing or revoking other sessions is not available in this build — it needs
            server-side session tracking, which this app does not include. Only the session on
            this device exists. To end it, use Logout.
          </Text>
        </View>

        <Card style={styles.deviceCard}>
          <View style={styles.deviceRow}>
            <Text style={styles.deviceIcon}>{Platform.OS === 'ios' ? '📱' : '📱'}</Text>
            <View style={styles.deviceInfo}>
              <View style={styles.deviceNameRow}>
                <Text style={styles.deviceName}>
                  {Platform.OS === 'ios' ? 'iPhone / iPad' : 'Android device'}
                </Text>
                <Text style={styles.currentBadge}>This device</Text>
              </View>
              <Text style={styles.deviceMeta}>Current signed-in session</Text>
            </View>
          </View>
        </Card>
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
  description: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.lg },
  noticeCard: {
    backgroundColor: colors.blueLight,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.lg,
  },
  noticeText: { ...typography.bodySmall, color: colors.text, lineHeight: 18 },
  deviceCard: { marginBottom: spacing.md },
  deviceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  deviceIcon: { fontSize: 28 },
  deviceInfo: { flex: 1 },
  deviceNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deviceName: { ...typography.h4 },
  currentBadge: {
    ...typography.caption,
    color: colors.success,
    backgroundColor: colors.greenLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  deviceMeta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
});

export default DeviceManagementScreen;
