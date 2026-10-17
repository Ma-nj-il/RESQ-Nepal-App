import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { Button, Card,  Avatar } from '../../components/ui';
import { bookingsService, isSupabaseConfigured } from '../../services/database';
import { Booking, BookingStatus } from '../../types';

const STATUS_STEPS: { key: BookingStatus; label: string; icon: string }[] = [
  { key: 'pending', label: 'Submitted', icon: '📝' },
  { key: 'assigned', label: 'Assigned', icon: '👤' },
  { key: 'arriving', label: 'Arriving', icon: '🚑' },
  { key: 'arrived', label: 'Arrived', icon: '📍' },
  { key: 'started', label: 'Started', icon: '🏥' },
  { key: 'completed', label: 'Completed', icon: '✅' },
];

const POLL_INTERVAL_MS = 8000;

const BookingStatusScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const bookingData = route.params?.bookingData;
  const bookingId: string | undefined = route.params?.bookingId;

  const isLiveBooking = Boolean(bookingId && isSupabaseConfigured);

  const [currentStatus, setCurrentStatus] = useState<BookingStatus>('pending');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // When a real booking exists, poll its status from the database.
  useEffect(() => {
    if (!isLiveBooking || !bookingId) {
      return;
    }
    let active = true;

    const refresh = async () => {
      try {
        const record = await bookingsService.getById(bookingId);
        if (!active || !record) return;
        setBooking(record);
        setCurrentStatus(record.status);
        setStatusError(null);
      } catch {
        if (active) {
          setStatusError('Could not refresh booking status. Retrying automatically...');
        }
      }
    };

    void refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [bookingId, isLiveBooking]);

  // Without a database, walk through the statuses slowly so the flow is
  // reviewable. This is clearly labelled as sample mode in the UI.
  useEffect(() => {
    if (isLiveBooking) return;
    const statusFlow: BookingStatus[] = ['pending', 'assigned', 'arriving', 'arrived', 'started', 'completed'];
    let currentIndex = 0;

    const interval = setInterval(() => {
      if (currentIndex < statusFlow.length - 1) {
        currentIndex++;
        setCurrentStatus(statusFlow[currentIndex]);
      } else {
        clearInterval(interval);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [isLiveBooking]);

  const getCurrentStepIndex = () => {
    return STATUS_STEPS.findIndex((s) => s.key === currentStatus);
  };

  const handleCancelBooking = () => {
    Alert.alert(
      'Cancel Booking',
      'Are you sure you want to cancel this booking? Cancellation fees may apply.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            if (isLiveBooking && bookingId) {
              setCancelling(true);
              try {
                await bookingsService.updateStatus(bookingId, 'cancelled');
                setCurrentStatus('cancelled');
                Alert.alert('Booking Cancelled', 'Your booking has been cancelled.');
              } catch {
                Alert.alert(
                  'Cancellation Failed',
                  'Could not cancel the booking. Check your connection and try again, or call the dispatch line.'
                );
              } finally {
                setCancelling(false);
              }
            } else {
              setCurrentStatus('cancelled');
              Alert.alert(
                'Booking Cancelled',
                'Sample booking cancelled. (No database is configured, so nothing was stored.)'
              );
            }
          },
        },
      ]
    );
  };

  const handleTrackLive = () => {
    if (isLiveBooking && bookingId) {
      navigation.navigate('TripTracking', { bookingId });
      return;
    }
    Alert.alert(
      'Live Tracking',
      'Live tracking follows a real booking. Configure the database and create a booking to track it here.'
    );
  };

  const handleCallDriver = () => {
    Alert.alert(
      'Call Driver',
      'Driver contact details are shared when a driver is assigned to your booking. In-app calling is not part of this build.'
    );
  };

  const currentStepIndex = getCurrentStepIndex();
  const canCancel = ['pending', 'assigned'].includes(currentStatus);
  const canTrack = ['started', 'arrived'].includes(currentStatus);
  const isCompleted = currentStatus === 'completed';
  const isCancelled = currentStatus === 'cancelled';

  // With a live booking the driver card appears once a driver row is
  // actually attached to the booking; in sample mode it follows the
  // example timeline.
  const hasDriverAssigned = isLiveBooking
    ? Boolean(booking?.driver_id)
    : currentStepIndex >= 1;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Booking Status</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
        {/* Sample mode / live status notices */}
        {!isLiveBooking && (
          <Card style={styles.sampleCard} elevation="sm">
            <Text style={styles.sampleText}>
              ⚠️ Sample mode — this booking was not saved to a database. Status changes here are
              example data.
            </Text>
          </Card>
        )}

        {statusError && (
          <Card style={styles.sampleCard} elevation="sm">
            <Text style={styles.sampleText}>{statusError}</Text>
          </Card>
        )}

        {/* Status Timeline */}
        <Card style={styles.timelineCard} elevation="md">
          <Text style={styles.sectionTitle}>Booking Progress</Text>
          <View style={styles.timeline}>
            {STATUS_STEPS.map((step, index) => {
              const isCompleted = index < currentStepIndex;
              const isCurrent = index === currentStepIndex;
              const isCancelled = currentStatus === 'cancelled' && index === 0;

              return (
                <View key={step.key} style={styles.timelineItem}>
                  <View style={styles.timelineLeft}>
                    <View
                      style={[
                        styles.timelineIcon,
                        isCompleted && styles.timelineIconCompleted,
                        isCurrent && styles.timelineIconCurrent,
                        isCancelled && styles.timelineIconCancelled,
                      ]}
                    >
                      <Text style={styles.timelineEmoji}>
                        {isCompleted ? '✓' : step.icon}
                      </Text>
                    </View>
                    {index < STATUS_STEPS.length - 1 && (
                      <View
                        style={[
                          styles.timelineLine,
                          index < currentStepIndex && styles.timelineLineCompleted,
                        ]}
                      />
                    )}
                  </View>
                  <View style={styles.timelineContent}>
                    <Text
                      style={[
                        styles.timelineLabel,
                        isCurrent && styles.timelineLabelCurrent,
                        isCompleted && styles.timelineLabelCompleted,
                      ]}
                    >
                      {step.label}
                    </Text>
                    {isCurrent && (
                      <Text style={styles.timelineStatus}>
                        {isCancelled ? 'Booking cancelled' : 'In progress...'}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </Card>

        {/* Driver Info (when assigned) */}
        {hasDriverAssigned && !isCancelled && (
          <Card style={styles.driverCard} elevation="md">
            <Text style={styles.sectionTitle}>Driver Information</Text>
            <View style={styles.driverRow}>
              <Avatar name={bookingData?.ambulance?.driverName || 'ResQ'} size="lg" />
              <View style={styles.driverInfo}>
                <Text style={styles.driverName}>
                  {bookingData?.ambulance?.driverName || 'Driver assigned'}
                </Text>
                {bookingData?.ambulance?.driverRating ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.star}>★</Text>
                    <Text style={styles.ratingText}>
                      {bookingData.ambulance.driverRating}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.vehicleInfo}>
                    Contact details are shared by dispatch
                  </Text>
                )}
                <Text style={styles.vehicleInfo}>
                  {bookingData?.ambulance?.model ??
                    (bookingData?.ambulance?.category === 'icu'
                      ? 'ICU Ambulance'
                      : 'Basic Ambulance')}
                  {bookingData?.ambulance?.plate_number
                    ? ` • ${bookingData.ambulance.plate_number}`
                    : ''}
                </Text>
              </View>
            </View>
            <View style={styles.driverActions}>
              <TouchableOpacity style={styles.callButton} onPress={handleCallDriver}>
                <Text style={styles.callIcon}>📞</Text>
                <Text style={styles.callText}>Call</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.messageButton}
                onPress={() =>
                  Alert.alert(
                    'Message Driver',
                    'In-app messaging is not part of this build. Your driver will coordinate by phone once assigned.'
                  )
                }
              >
                <Text style={styles.messageIcon}>💬</Text>
                <Text style={styles.messageText}>Message</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {/* Map Placeholder */}
        <Card style={styles.mapCard} elevation="md">
          <Text style={styles.sectionTitle}>Route Map</Text>
          <View style={styles.mapPlaceholder}>
            <View style={styles.mapBackground}>
              <View style={styles.mapGrid}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View key={`h-${i}`} style={[styles.gridLine, { top: `${(i + 1) * 16.66}%` }]} />
                ))}
                {Array.from({ length: 4 }).map((_, i) => (
                  <View key={`v-${i}`} style={[styles.gridLineVertical, { left: `${(i + 1) * 25}%` }]} />
                ))}
              </View>
              {/* Route line */}
              <View style={styles.routeLine} />
              {/* Pickup marker */}
              <View style={[styles.mapMarker, styles.mapMarkerPickup]}>
                <Text style={styles.mapMarkerEmoji}>📍</Text>
              </View>
              {/* Destination marker */}
              <View style={[styles.mapMarker, styles.mapMarkerDest]}>
                <Text style={styles.mapMarkerEmoji}>🏥</Text>
              </View>
              {/* Ambulance marker (when assigned) */}
              {currentStepIndex >= 1 && !isCancelled && (
                <View style={styles.ambulanceMarker}>
                  <Text style={styles.ambulanceEmoji}>🚑</Text>
                </View>
              )}
            </View>
          </View>
        </Card>

        {/* Trip Summary */}
        <Card style={styles.summaryCard} elevation="md">
          <Text style={styles.sectionTitle}>Trip Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Pickup</Text>
            <Text style={styles.summaryValue}>
              {bookingData?.pickup?.address || 'Current Location'}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Destination</Text>
            <Text style={styles.summaryValue}>
              {bookingData?.destination?.address || 'Not specified'}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Patient</Text>
            <Text style={styles.summaryValue}>
              {bookingData?.patientName || 'N/A'}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Payment</Text>
            <Text style={styles.summaryValue}>
              {bookingData?.paymentMethod?.toUpperCase() || 'WALLET'}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryTotalLabel}>Total Fare</Text>
            <Text style={styles.summaryTotalValue}>
              NPR {bookingData?.totalFare?.toFixed(0) || '1,500'}
            </Text>
          </View>
        </Card>

        {/* Bottom spacing */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom Actions */}
      <View style={styles.bottomBar}>
        {canCancel && (
          <Button
            title="Cancel Booking"
            onPress={handleCancelBooking}
            variant="danger"
            fullWidth
            loading={cancelling}
            disabled={cancelling}
          />
        )}
        {canTrack && (
          <Button
            title="Track Live"
            onPress={handleTrackLive}
            fullWidth
          />
        )}
        {isCompleted && (
          <Button
            title="Book Another"
            onPress={() => navigation.navigate('Home')}
            fullWidth
          />
        )}
        {isCancelled && (
          <Button
            title="Book Again"
            onPress={() => navigation.navigate('Home')}
            fullWidth
          />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sampleCard: {
    backgroundColor: colors.amberLight,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  sampleText: { ...typography.bodySmall, color: colors.warning },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 24,
    color: colors.text,
  },
  headerTitle: {
    ...typography.h3,
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  timelineCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.text,
    marginBottom: spacing.md,
  },
  timeline: {
    paddingLeft: spacing.sm,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  timelineLeft: {
    alignItems: 'center',
    marginRight: spacing.md,
  },
  timelineIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineIconCompleted: {
    backgroundColor: colors.success,
  },
  timelineIconCurrent: {
    backgroundColor: colors.primary,
  },
  timelineIconCancelled: {
    backgroundColor: colors.error,
  },
  timelineEmoji: {
    fontSize: 16,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  timelineLineCompleted: {
    backgroundColor: colors.success,
  },
  timelineContent: {
    flex: 1,
    paddingTop: spacing.xs,
  },
  timelineLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  timelineLabelCurrent: {
    color: colors.primary,
    fontWeight: '600',
  },
  timelineLabelCompleted: {
    color: colors.success,
  },
  timelineStatus: {
    ...typography.caption,
    color: colors.primary,
    marginTop: 2,
  },
  driverCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  driverInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  driverName: {
    ...typography.h4,
    color: colors.text,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  star: {
    fontSize: 14,
    color: colors.warning,
  },
  ratingText: {
    ...typography.bodySmall,
    color: colors.text,
    marginLeft: 4,
  },
  vehicleInfo: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  driverActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  callButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenLight,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    gap: spacing.sm,
  },
  callIcon: {
    fontSize: 16,
  },
  callText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '600',
  },
  messageButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blueLight,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    gap: spacing.sm,
  },
  messageIcon: {
    fontSize: 16,
  },
  messageText: {
    ...typography.bodySmall,
    color: colors.info,
    fontWeight: '600',
  },
  mapCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  mapPlaceholder: {
    height: 200,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  mapBackground: {
    flex: 1,
    backgroundColor: '#E8E4DE',
    position: 'relative',
  },
  mapGrid: {
    ...StyleSheet.absoluteFill,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  routeLine: {
    position: 'absolute',
    top: '30%',
    left: '20%',
    width: '60%',
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  mapMarker: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  mapMarkerPickup: {
    top: '25%',
    left: '15%',
  },
  mapMarkerDest: {
    top: '60%',
    right: '15%',
  },
  mapMarkerEmoji: {
    fontSize: 16,
  },
  ambulanceMarker: {
    position: 'absolute',
    top: '40%',
    left: '45%',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  ambulanceEmoji: {
    fontSize: 18,
  },
  summaryCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  summaryLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  summaryValue: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
    marginLeft: spacing.md,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  summaryTotalLabel: {
    ...typography.h4,
    color: colors.text,
  },
  summaryTotalValue: {
    ...typography.h3,
    color: colors.primary,
  },
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

export default BookingStatusScreen;
