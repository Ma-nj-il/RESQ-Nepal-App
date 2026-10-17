import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, radii} from '../../constants/theme';

/**
 * Receipt documents are not generated in this build. Previously this sheet
 * listed fake files and invented contacts; it now shares an honest text
 * summary through the device share sheet.
 */
const ShareReceiptScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const handleShare = async () => {
    try {
      await Share.share({
        message: 'RESQ Nepal — Thank you for using the app.',
      });
    } catch {
      // Sharing cancelled or unavailable
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => navigation.goBack()} />
      <View style={styles.sheet}>
        <Text style={styles.title}>Share Receipt</Text>

        <Text style={styles.sectionLabel}>Receipt document</Text>
        <View style={styles.fileRow}>
          <Text style={styles.fileIcon}>📄</Text>
          <Text style={styles.fileName} numberOfLines={2}>
            Receipt documents are not generated in this build. Sharing sends a text summary
            through your device instead.
          </Text>
        </View>

        <TouchableOpacity style={styles.fileRow} onPress={handleShare} activeOpacity={0.7}>
          <Text style={styles.fileIcon}>📤</Text>
          <Text style={styles.fileName} numberOfLines={2}>
            Share via your device
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  overlay: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: { ...typography.h4, textAlign: 'center', marginBottom: spacing.lg },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  fileIcon: { fontSize: 24, marginRight: spacing.md },
  fileName: { ...typography.bodySmall, flex: 1, color: colors.textSecondary },
  sectionLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
});

export default ShareReceiptScreen;
