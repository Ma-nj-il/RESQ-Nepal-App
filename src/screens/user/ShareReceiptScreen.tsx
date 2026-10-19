import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button } from '../../components/ui';
import { SERVICE_CATEGORIES } from '../../constants/serviceCategories';
import { Booking } from '../../types';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Waiting to be confirmed',
  pending: 'Pending',
  assigned: 'Ambulance assigned',
  arriving: 'On the way to pickup',
  arrived: 'Arrived at pickup',
  started: 'Trip in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

/**
 * Trip receipt.
 *
 * Opened with a booking (from a completed trip) it renders the record exactly
 * as stored — including the recorded final fare when present, or an honest
 * "confirmed by the crew" state when it is not. No amount is ever invented.
 *
 * Opened without a booking it keeps the previous honest behaviour: a text
 * summary through the device share sheet, because no receipt document is
 * generated in this build.
 */
const ShareReceiptScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const booking: Booking | undefined = route.params?.booking;

  const fareLine = booking
    ? booking.final_fare != null
      ? `Final fare: NPR ${Number(booking.final_fare).toLocaleString('en-IN')} (recorded)`
      : 'Fare: confirmed by the crew after the trip'
    : null;

  const handleShare = async () => {
    const message = booking
      ? [
          'RESQ Nepal — trip receipt',
          `Booking ref: ${booking.id}`,
          `Requested: ${formatDateTime(booking.created_at)}`,
          `Service: ${SERVICE_CATEGORIES[booking.category]?.name ?? booking.category}`,
          `From: ${booking.pickup_address}`,
          `To: ${booking.destination_address}`,
          `Status: ${STATUS_LABEL[booking.status] ?? booking.status}`,
          'Payment: Cash — paid to the crew',
          fareLine,
        ]
          .filter(Boolean)
          .join('\n')
      : 'RESQ Nepal — Thank you for using the app.';

    try {
      await Share.share({ message });
    } catch {
      // Sharing cancelled or unavailable
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => navigation.goBack()} />
      <View style={styles.sheet}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>{booking ? 'Trip Receipt' : 'Share Receipt'}</Text>

          {booking ? (
            <>
              <View style={styles.brandRow}>
                <Text style={styles.brandIcon}>🚑</Text>
                <View>
                  <Text style={styles.brandName}>RESQ Nepal</Text>
                  <Text style={styles.brandTag}>Ambulance service</Text>
                </View>
              </View>

              <View style={styles.detailCard}>
                <DetailRow label="Booking ref" value={booking.id} />
                <DetailRow label="Requested" value={formatDateTime(booking.created_at)} />
                <DetailRow
                  label="Service"
                  value={SERVICE_CATEGORIES[booking.category]?.name ?? booking.category}
                />
                <DetailRow label="From" value={booking.pickup_address} />
                <DetailRow label="To" value={booking.destination_address} />
                <DetailRow
                  label="Status"
                  value={STATUS_LABEL[booking.status] ?? booking.status}
                />
                <DetailRow label="Payment" value="Cash — paid to the crew" />
                <DetailRow
                  label="Fare"
                  value={
                    booking.final_fare != null
                      ? `NPR ${Number(booking.final_fare).toLocaleString('en-IN')} (recorded)`
                      : 'Confirmed by the crew after the trip'
                  }
                />
              </View>

              <Text style={styles.note}>
                This receipt mirrors the record stored for this booking. No document file is
                generated in this build; sharing sends this summary through your device.
              </Text>

              <Button title="Share receipt summary" onPress={handleShare} fullWidth />
              <Button
                title="Close"
                variant="ghost"
                onPress={() => navigation.goBack()}
                fullWidth
                style={styles.closeButton}
              />
            </>
          ) : (
            <>
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
            </>
          )}
        </ScrollView>
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
    maxHeight: '86%',
  },
  title: { ...typography.h4, textAlign: 'center', marginBottom: spacing.lg },

  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  brandIcon: { fontSize: 32, marginRight: spacing.md },
  brandName: { ...typography.h4, color: colors.text },
  brandTag: { ...typography.caption, color: colors.textSecondary },

  detailCard: {
    backgroundColor: colors.input,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  detailLabel: { ...typography.bodySmall, color: colors.textSecondary, marginRight: spacing.md },
  detailValue: { ...typography.bodySmall, color: colors.text, fontWeight: '600', flex: 1, textAlign: 'right' },
  note: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
  closeButton: { marginTop: spacing.sm },

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
