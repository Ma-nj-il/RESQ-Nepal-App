import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button } from '../../components/ui';
import { SERVICE_CATEGORIES } from '../../constants/serviceCategories';
import { Booking } from '../../types';
import { isDemoMode } from '../../utils/demoMode';
import { DemoTripReceipt } from '../../utils/demoTrip';

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
 * unavailable state when no final fare was recorded. No amount is invented.
 *
 * Opened without a booking it keeps the previous honest behaviour: a text
 * summary through the device share sheet, because no receipt document is
 * generated in this build.
 */
const ShareReceiptScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const booking: Booking | undefined = route.params?.booking;
  const demoTrip: DemoTripReceipt | undefined = isDemoMode() && route.params?.demoTrip?.isDemo
    ? route.params.demoTrip
    : undefined;

  const fareLine = booking
    ? booking.final_fare != null
      ? `NPR ${Number(booking.final_fare).toLocaleString('en-IN')} (recorded final fare)`
      : 'Unavailable · final fare not recorded'
    : null;

  const handleShare = async () => {
    const message = demoTrip
      ? [
          'RESQ Nepal — DEMO receipt preview (not a real trip)',
          `Demo trip ref: ${demoTrip.id}`,
          `Demo completion time: ${formatDateTime(demoTrip.completedAt)}`,
          `Service: ${SERVICE_CATEGORIES[demoTrip.category].name}`,
          `From: ${demoTrip.pickupAddress}`,
          `To: ${demoTrip.destinationAddress}`,
          `Illustrative planned-route estimate: ${
            demoTrip.estimatedDistanceKm === null
              ? 'Unavailable'
              : `about ${demoTrip.estimatedDistanceKm.toFixed(1)} km`
          }`,
          'Trip duration: Unavailable — not measured in demo mode',
          demoTrip.fare
            ? `Estimated fare from current RESQ fare card: NPR ${demoTrip.fare.totalFare.toLocaleString('en-IN')} (base NPR ${demoTrip.fare.baseFare}, distance NPR ${demoTrip.fare.distanceCharge}, service NPR ${demoTrip.fare.serviceFee})`
            : 'Fare: Unavailable — route estimate missing',
          'Payment method: Cash (demo only)',
        ].join('\n')
      : booking
      ? [
          'RESQ Nepal — trip receipt',
          `Booking ref: ${booking.id}`,
          `Requested: ${formatDateTime(booking.created_at)}`,
          `Service: ${SERVICE_CATEGORIES[booking.category]?.name ?? booking.category}`,
          `From: ${booking.pickup_address}`,
          `To: ${booking.destination_address}`,
          `Status: ${STATUS_LABEL[booking.status] ?? booking.status}`,
          `Payment: ${booking.payment_method === 'cash' ? 'Cash' : booking.payment_method}`,
          fareLine,
          `Distance: ${booking.distance_km == null ? 'Unavailable' : `${Number(booking.distance_km).toFixed(1)} km (recorded)`}`,
          `Duration: ${booking.duration_min == null ? 'Unavailable' : `${Math.round(Number(booking.duration_min))} min (recorded)`}`,
          booking.estimated_fare == null
            ? null
            : `Original fare estimate: NPR ${Number(booking.estimated_fare).toLocaleString('en-IN')}`,
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
          <Text style={styles.title}>
            {demoTrip ? 'Demo Trip Receipt' : booking ? 'Trip Receipt' : 'Share Receipt'}
          </Text>

          {demoTrip ? (
            <>
              <View style={styles.brandRow}>
                <Text style={styles.brandIcon}>🚑</Text>
                <View>
                  <Text style={styles.brandName}>RESQ Nepal</Text>
                  <Text style={styles.brandTag}>DEMO PREVIEW · not a real trip receipt</Text>
                </View>
              </View>
              <View style={styles.detailCard}>
                <DetailRow label="Demo trip ref" value={demoTrip.id} />
                <DetailRow label="Demo completion time" value={formatDateTime(demoTrip.completedAt)} />
                <DetailRow label="Service" value={SERVICE_CATEGORIES[demoTrip.category].name} />
                <DetailRow label="Pickup" value={demoTrip.pickupAddress} />
                <DetailRow label="Destination" value={demoTrip.destinationAddress} />
                <DetailRow
                  label="Illustrative planned-route distance"
                  value={
                    demoTrip.estimatedDistanceKm === null
                      ? 'Unavailable'
                      : `About ${demoTrip.estimatedDistanceKm.toFixed(1)} km · estimate only`
                  }
                />
                <DetailRow label="Trip duration" value="Unavailable · not measured in demo mode" />
                <DetailRow label="Driver / vehicle" value="Unavailable · no real assignment" />
                <DetailRow label="Payment" value="Cash · demo only" />
                {demoTrip.fare ? (
                  <>
                    <DetailRow
                      label="Base fare"
                      value={`NPR ${demoTrip.fare.baseFare.toLocaleString('en-IN')}`}
                    />
                    <DetailRow
                      label={`Distance fare (${demoTrip.fare.distanceKm.toFixed(1)} km estimate)`}
                      value={`NPR ${demoTrip.fare.distanceCharge.toLocaleString('en-IN')}`}
                    />
                    <DetailRow
                      label="Service fee"
                      value={`NPR ${demoTrip.fare.serviceFee.toLocaleString('en-IN')}`}
                    />
                    <DetailRow
                      label="Estimated total · current fare card"
                      value={`NPR ${demoTrip.fare.totalFare.toLocaleString('en-IN')}`}
                    />
                  </>
                ) : (
                  <DetailRow label="Fare" value="Unavailable · route estimate missing" />
                )}
              </View>
              <Text style={styles.note}>
                Local UI preview only. No trip, payment, GPS distance, or receipt was recorded.
              </Text>
              <Button title="Share demo summary" onPress={handleShare} fullWidth />
              <Button
                title="Continue to Rating"
                onPress={() => navigation.navigate('Rating', { demoTrip })}
                fullWidth
                size="lg"
                style={styles.closeButton}
              />
            </>
          ) : booking ? (
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
                <DetailRow
                  label="Payment"
                  value={booking.payment_method === 'cash' ? 'Cash' : booking.payment_method}
                />
                <DetailRow
                  label="Trip distance"
                  value={
                    booking.distance_km == null
                      ? 'Unavailable · not recorded'
                      : `${Number(booking.distance_km).toFixed(1)} km (recorded)`
                  }
                />
                <DetailRow
                  label="Trip duration"
                  value={
                    booking.duration_min == null
                      ? 'Unavailable · not recorded'
                      : `${Math.round(Number(booking.duration_min))} min (recorded)`
                  }
                />
                {booking.estimated_fare == null ? null : (
                  <DetailRow
                    label="Original fare estimate"
                    value={`NPR ${Number(booking.estimated_fare).toLocaleString('en-IN')}`}
                  />
                )}
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
              {booking.status === 'completed' ? (
                <Button
                  title="Continue to Rating"
                  onPress={() => navigation.navigate('Rating', { booking, bookingId: booking.id })}
                  fullWidth
                  size="lg"
                  style={styles.closeButton}
                />
              ) : null}
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
