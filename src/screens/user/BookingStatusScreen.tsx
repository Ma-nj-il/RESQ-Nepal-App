import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Animated,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button, Card, Avatar, Badge } from '../../components/ui';
import { TripTimeline } from '../../components/booking/TripTimeline';
import { MapCanvas } from '../../components/map/MapCanvas';
import { SearchRadar } from '../../components/booking/SearchRadar';
import { BOOKING_TIMELINE_STEPS } from '../../constants/bookingTimeline';
import { bookingsService, isSupabaseConfigured, assignedCrewService } from '../../services/database';
import type { AssignedCrew } from '../../services/database/assignedCrew';
import { SERVICE_CATEGORIES } from '../../constants/serviceCategories';
import { useBookingStore } from '../../store/bookingStore';
import { isDemoMode } from '../../utils/demoMode';
import { openNativeDialer } from '../../utils/dialer';
import { Booking, BookingStatus } from '../../types';

const STATUS_STEPS = BOOKING_TIMELINE_STEPS;

const STATUS_INFO: Record<
  BookingStatus,
  { title: string; message: string; icon: string; tone: 'progress' | 'success' | 'danger' | 'neutral' }
> = {
  draft: {
    title: 'Draft booking',
    message: 'This booking has not been submitted yet.',
    icon: '📝',
    tone: 'neutral',
  },
  pending: {
    title: 'Searching for driver…',
    message:
      'Your request is with verified ambulance crews. The assigned crew appears here as soon as one accepts.',
    icon: '✚',
    tone: 'progress',
  },
  assigned: {
    title: 'Booking confirmed',
    message: 'Your ambulance is on the way.',
    icon: '✓',
    tone: 'success',
  },
  arriving: {
    title: 'Ambulance is on the way',
    message: 'The crew is on the way to your pickup location.',
    icon: '🚑',
    tone: 'progress',
  },
  arrived: {
    title: 'Ambulance arrived',
    message: 'The crew is at your pickup point.',
    icon: '📍',
    tone: 'progress',
  },
  started: {
    title: 'Trip in progress',
    message: 'You are on the way to the destination hospital.',
    icon: '🏥',
    tone: 'progress',
  },
  completed: {
    title: 'Trip completed',
    message: 'The trip is complete. You can rate the service or book another ambulance.',
    icon: '✅',
    tone: 'success',
  },
  cancelled: {
    title: 'Booking cancelled',
    message: 'This request was cancelled — no ambulance is coming for it.',
    icon: '🚫',
    tone: 'danger',
  },
  rejected: {
    title: 'No ambulance available',
    message:
      'No crew accepted this request. This usually means every nearby ambulance is busy. Try again, or call the nearest hospital directly if this is life-threatening.',
    icon: '⚠️',
    tone: 'danger',
  },
};

const POLL_INTERVAL_MS = 8000;

/**
 * Fictional crew used only in the demo/sample walkthrough so the assigned
 * stage can be reviewed without a real assignment. It is never written to
 * the database, the plate is not a real registration, and the card labels it
 * as a sample.
 */
const DEMO_CREW_SAMPLE = {
  name: 'Sample crew',
};

const BookingStatusScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const bookingData = route.params?.bookingData;
  const bookingId: string | undefined = route.params?.bookingId;
  const { pickup, destination } = useBookingStore();

  const demoRun = isDemoMode();
  const isLiveBooking = Boolean(bookingId && isSupabaseConfigured && !demoRun);

  const [currentStatus, setCurrentStatus] = useState<BookingStatus>('pending');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [crew, setCrew] = useState<AssignedCrew | null>(null);

  // Live booking: poll the real row while this screen is focused so the UI
  // always reflects the database without a background polling loop.
  useEffect(() => {
    if (!isLiveBooking || !bookingId || !isFocused) return;
    let active = true;

    const refresh = async () => {
      try {
        const record = await bookingsService.getById(bookingId);
        if (!active || !record) return;
        setBooking(record);
        setCurrentStatus(record.status);
        setStatusError(null);
      } catch {
        if (active) setStatusError('Could not refresh the booking status. Retrying automatically…');
      }
    };

    void refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [bookingId, isFocused, isLiveBooking]);

  // Assigned crew — resolved only for the authenticated patient's own booking
  // through the reviewed service (which re-checks ownership server-side). If
  // the current policies do not expose the crew rows, the card shows neutral
  // fallbacks instead of inventing a driver or plate.
  useEffect(() => {
    if (!isLiveBooking || !bookingId) return;
    if (!booking?.driver_id && !booking?.ambulance_id) return;
    let active = true;
    (async () => {
      try {
        const result = await assignedCrewService.getForBooking(bookingId);
        if (active) setCrew(result);
      } catch {
        if (active) setCrew(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [isLiveBooking, bookingId, booking?.driver_id, booking?.ambulance_id]);

  // Sample/demo: walk through the statuses slowly so the flow is reviewable
  // while this screen is focused. Clearly labelled below — never presented as
  // a real match.
  useEffect(() => {
    if (isLiveBooking || !isFocused) return;
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
  }, [isFocused, isLiveBooking]);

  const currentIndex = STATUS_STEPS.findIndex((s) => s.key === currentStatus);
  const isFailed = currentStatus === 'rejected';
  const info = STATUS_INFO[currentStatus];

  const canCancel = ['pending', 'assigned'].includes(currentStatus);
  const canTrack = ['assigned', 'arriving', 'arrived', 'started'].includes(currentStatus);
  // The crew's contact number is only shared while the trip is operationally
  // active (see supabase/patches/assigned_crew_visibility.sql), so the call
  // action appears in exactly that window. Demo always shows it with a
  // no-call explanation.
  const canCallDriver = !isLiveBooking || canTrack;
  const isCompleted = currentStatus === 'completed';
  const isCancelled = currentStatus === 'cancelled';

  const category = SERVICE_CATEGORIES[(bookingData?.ambulance?.category ?? 'basic') as 'basic' | 'icu'];
  const hasDriverAssigned = isLiveBooking
    ? Boolean(booking?.driver_id)
    : ['assigned', 'arriving', 'arrived', 'started', 'completed'].includes(currentStatus);

  // Real fare data only: rate-card estimate from the confirmation step, the
  // database estimate, or a "pending" label. Never a made-up number.
  const fareValue: number | null = (() => {
    if (booking?.final_fare != null) return Number(booking.final_fare);
    if (booking?.estimated_fare != null) return Number(booking.estimated_fare);
    if (bookingData?.totalFare != null) return Number(bookingData.totalFare);
    return null;
  })();

  // Real coordinates only — the booking row when it exists, the in-progress
  // selection otherwise. Without coordinates no map is shown at all.
  const mapPickup =
    booking?.pickup_lat != null && booking?.pickup_lng != null
      ? { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) }
      : pickup && pickup.lat != null && pickup.lng != null
        ? { lat: pickup.lat, lng: pickup.lng }
        : null;
  const mapDestination =
    booking?.dest_lat != null && booking?.dest_lng != null
      ? { lat: Number(booking.dest_lat), lng: Number(booking.dest_lng) }
      : destination && destination.lat != null && destination.lng != null
        ? { lat: destination.lat, lng: destination.lng }
        : null;

  // Addresses shown in Trip Details — the stored booking row first, then the
  // in-progress selection. Nothing is invented when both are missing.
  const tripPickupAddress = booking?.pickup_address || pickup?.address || null;
  const tripDestinationAddress = booking?.destination_address || destination?.address || null;

  const handleCancelBooking = () => {
    Alert.alert(
      'Cancel this request?',
      isLiveBooking
        ? 'The ambulance crews will no longer see this request.'
        : 'This cancels the sample request in this demo walkthrough.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Yes, cancel',
          style: 'destructive',
          onPress: async () => {
            if (isLiveBooking && bookingId) {
              setCancelling(true);
              try {
                await bookingsService.updateStatus(bookingId, 'cancelled');
                setCurrentStatus('cancelled');
              } catch {
                Alert.alert(
                  'Cancellation failed',
                  'Could not cancel the booking. Check your connection and try again, or call the dispatch line.',
                );
              } finally {
                setCancelling(false);
              }
            } else {
              setCurrentStatus('cancelled');
            }
          },
        },
      ],
    );
  };

  const handleTrackLive = () => {
    if (bookingId && isSupabaseConfigured && !demoRun) {
      navigation.navigate('TripTracking', { bookingId });
      return;
    }
    if (demoRun || !isSupabaseConfigured) {
      Alert.alert(
        'Demo walkthrough',
        'Live driver tracking needs a real booking created against the database. In demo mode the request stays on this device.',
      );
      return;
    }
    Alert.alert('Live tracking', 'Tracking becomes available once the booking row exists in the database.');
  };

  const handleCallDriver = async () => {
    if (!isLiveBooking) {
      Alert.alert(
        'Demo walkthrough',
        'No call is placed in the demo — nothing is dialled and no real crew is attached. With a real assignment this button opens your phone’s dialer with the crew’s contact number.',
      );
      return;
    }
    // The number is only handed to the native dialer — it is never rendered
    // as text and never logged.
    const result = await openNativeDialer(crew?.driverPhone ?? null, (url) => Linking.openURL(url));
    if (result === 'invalid') {
      Alert.alert(
        'Driver contact is currently unavailable',
        'The assigned crew’s contact number has not been shared with this app yet. If dispatch gave you a number, use your phone app to call it.',
      );
    } else if (result === 'failed') {
      Alert.alert(
        'Could not open the dialer',
        'Your device could not open the phone dialer. Try again or call from your phone app.',
      );
    }
  };

  const handleRetry = () => {
    navigation.navigate('AmbulanceList');
  };

  return currentStatus === 'pending' ? (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchMapArea}>
        <MapCanvas
          pickup={mapPickup}
          pickupLabel={tripPickupAddress || undefined}
          style={styles.mapFill}
        />
        <SearchRadar active={isFocused} />
        <View style={styles.searchTopBar}>
          <TouchableOpacity
            style={styles.searchBackButton}
            onPress={() => navigation.navigate('Home')}
            accessibilityRole="button"
            accessibilityLabel="Back to home"
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <View style={styles.searchTitlePill}>
            <Text style={styles.searchTitleText}>Booking Status</Text>
          </View>
          <View style={styles.searchTopSpacer} />
        </View>
      </View>

      <View style={styles.searchSheet}>
        <View style={styles.handleBar} />

        <View style={styles.searchStatusRow}>
          <View style={styles.searchStatusIcon}>
            <Text style={styles.searchStatusGlyph}>✚</Text>
          </View>
          <View style={styles.searchStatusCopy}>
            <Text style={styles.searchStatusTitle}>
              {isLiveBooking ? 'Searching for driver…' : 'Finding an ambulance…'}
            </Text>
            <Text style={styles.searchStatusMessage}>
              {isLiveBooking
                ? 'Your request is visible to verified crews. The assigned crew appears as soon as one accepts.'
                : 'Demo search — no dispatch server is contacted and no real ambulance is requested.'}
            </Text>
          </View>
        </View>

        {(tripPickupAddress || tripDestinationAddress) && (
          <View style={styles.searchRouteRow}>
            <View style={styles.searchRouteRail}>
              <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
              <View style={styles.searchRouteLine} />
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
            </View>
            <View style={styles.searchRouteCopy}>
              <Text style={styles.searchRouteText} numberOfLines={1}>
                {tripPickupAddress || 'Pickup location'}
              </Text>
              <Text style={styles.searchRouteText} numberOfLines={1}>
                {tripDestinationAddress || 'Destination'}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.searchProgressPill}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.searchProgressText}>This may take a few moments…</Text>
        </View>
        <Text style={styles.searchMapNote}>Radar is illustrative — not live GPS.</Text>

        {statusError ? <Text style={styles.searchError}>{statusError}</Text> : null}

        <Button
          title="Cancel request"
          onPress={handleCancelBooking}
          variant="outline"
          fullWidth
          loading={cancelling}
          disabled={cancelling}
          style={styles.searchCancelButton}
        />
      </View>
    </SafeAreaView>
  ) : (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.navigate('Home')}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Booking Status</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
        {/* State hero — confirmed stages show a filled green check. */}
        <Card style={styles.heroCard} elevation="md">
          <View style={styles.heroRow}>
            <Animated.View
              style={[
                styles.heroIconWrap,
                info.tone === 'success' && styles.heroIconSuccess,
                info.tone === 'danger' && styles.heroIconDanger,
                info.tone === 'progress' && styles.heroIconProgress,
              ]}
            >
              <Text
                style={[
                  styles.heroIcon,
                  info.tone === 'success' && styles.heroIconGlyphSuccess,
                ]}
              >
                {info.tone === 'success' ? '✓' : info.icon}
              </Text>
            </Animated.View>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroTitle}>
                {!isLiveBooking ? 'Sample: ' : ''}
                {info.title}
              </Text>
              <Text style={styles.heroMessage}>
                {!isLiveBooking
                  ? 'Demo walkthrough only — no real crew, vehicle or trip state is attached.'
                  : info.message}
              </Text>
            </View>
          </View>
        </Card>

        {/* Assigned crew — driver, vehicle and actions in the reference's
            composition. Real data only; the demo state is clearly labelled. */}
        {hasDriverAssigned && !isCancelled && !isFailed && (
          <Card style={styles.card} elevation="md">
            <View style={styles.crewHeader}>
              <Text style={styles.crewTitle}>{isLiveBooking ? 'Assigned crew' : 'Sample crew state'}</Text>
              {!isLiveBooking && <Badge label="SAMPLE" variant="info" />}
            </View>

            {isLiveBooking ? (
              <>
                <View style={styles.driverRow}>
                  <Avatar
                    name={crew?.driverName || 'RESQ crew'}
                    uri={crew?.driverAvatarUrl ?? undefined}
                    size="lg"
                  />
                  <View style={styles.driverInfo}>
                    <View style={styles.driverNameRow}>
                      <Text style={styles.driverName} numberOfLines={1}>
                        {crew?.driverName || 'Assigned ambulance crew'}
                      </Text>
                      {crew?.driverVerified === true && (
                        <Badge label="VERIFIED" variant="success" />
                      )}
                    </View>
                    <Text style={styles.driverMeta}>Driver</Text>
                  </View>
                </View>

                <View style={styles.vehicleRow}>
                  <View style={styles.vehicleIconWrap}>
                    <Text style={styles.vehicleIcon}>🚑</Text>
                  </View>
                  <View style={styles.vehicleInfo}>
                    {crew?.plateNumber ? (
                      <>
                        <Text style={styles.vehiclePlate}>{crew.plateNumber}</Text>
                        <Text style={styles.vehicleMeta}>Ambulance vehicle</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.vehicleMetaStrong}>Assigned vehicle</Text>
                        <Text style={styles.vehicleMeta}>
                          Registration details are not shared with your account yet.
                        </Text>
                      </>
                    )}
                  </View>
                  <Badge label={`Type: ${category.badge}`} variant="info" />
                </View>

                <View style={styles.actionRow}>
                  {canCallDriver && (
                    <Button
                      title="Call Driver"
                      onPress={() => void handleCallDriver()}
                      size="sm"
                      style={styles.actionButton}
                      icon={<Text style={styles.callIcon}>📞</Text>}
                    />
                  )}
                  {canTrack && (
                    <Button
                      title="Track Ambulance"
                      onPress={handleTrackLive}
                      variant="secondary"
                      size="sm"
                      style={styles.actionButton}
                      icon={<Text style={styles.callIcon}>📍</Text>}
                    />
                  )}
                </View>

                {canCallDriver && (
                  <View style={styles.footnoteBlock}>
                    <Text style={styles.footnote}>ⓘ Driver’s phone number is not shown in the app.</Text>
                    <Text style={styles.footnote}>
                      ⓘ “Call Driver” opens your phone’s dialer to place the call.
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={styles.driverRow}>
                  <Avatar name={DEMO_CREW_SAMPLE.name} size="lg" />
                  <View style={styles.driverInfo}>
                    <Text style={styles.driverName} numberOfLines={1}>
                      {DEMO_CREW_SAMPLE.name}
                    </Text>
                    <Text style={styles.driverMeta}>Demo placeholder</Text>
                  </View>
                </View>

                <View style={styles.vehicleRow}>
                  <View style={styles.vehicleIconWrap}>
                    <Text style={styles.vehicleIcon}>🚑</Text>
                  </View>
                  <View style={styles.vehicleInfo}>
                    <Text style={styles.vehiclePlate}>Vehicle not assigned</Text>
                    <Text style={styles.vehicleMeta}>Demo walkthrough</Text>
                  </View>
                  <Badge label={`Type: ${category.badge}`} variant="info" />
                </View>

                <Text style={styles.driverSampleNote}>
                  Sample state — no real driver, vehicle or registration is attached.
                </Text>

                <View style={styles.actionRow}>
                  <Button
                    title="Call Driver"
                    onPress={() => void handleCallDriver()}
                    style={styles.actionButton}
                    icon={<Text style={styles.callIcon}>📞</Text>}
                  />
                  <Button
                    title="Track Ambulance"
                    onPress={handleTrackLive}
                    variant="secondary"
                    style={styles.actionButton}
                    icon={<Text style={styles.callIcon}>📍</Text>}
                  />
                </View>
              </>
            )}
          </Card>
        )}

        {/* Trip details — From/To as in the reference's assigned state. The
            pending/searching state keeps the reference's shorter layout. */}
        {(hasDriverAssigned || isCancelled || isFailed || currentStatus === 'completed') && (
          <Card style={styles.card} elevation="md">
            <Text style={styles.sectionTitle}>Trip Details</Text>
            <View style={styles.tripRow}>
              <View style={[styles.tripDotWrap, { backgroundColor: colors.greenLight }]}>
                <View style={[styles.tripDot, { backgroundColor: colors.success }]} />
              </View>
              <View style={styles.tripInfo}>
                <Text style={styles.tripLabel}>From</Text>
                <Text style={styles.tripValue} numberOfLines={2}>
                  {tripPickupAddress || 'Pickup not recorded'}
                </Text>
              </View>
            </View>
            <View style={styles.tripConnector} />
            <View style={styles.tripRow}>
              <View style={[styles.tripDotWrap, { backgroundColor: colors.redLight }]}>
                <View style={[styles.tripDot, { backgroundColor: colors.primary }]} />
              </View>
              <View style={styles.tripInfo}>
                <Text style={styles.tripLabel}>To</Text>
                <Text style={styles.tripValue} numberOfLines={2}>
                  {tripDestinationAddress || 'Destination not recorded'}
                </Text>
              </View>
            </View>
          </Card>
        )}

        {/* Map context — real pickup/destination markers, straight-line only */}
        {(mapPickup || mapDestination) && (
          <Card style={styles.mapCard} elevation="sm">
            <View style={styles.mapWrap}>
              <MapCanvas
                pickup={mapPickup}
                destination={mapDestination}
                pickupLabel={pickup?.address || booking?.pickup_address}
                destinationLabel={destination?.address || booking?.destination_address}
                caption="Pickup and destination — straight-line preview, not live GPS"
                style={styles.mapFill}
              />
            </View>
          </Card>
        )}

        {/* Honest notices — demo/sample disclosure kept as a small footnote
            so it stays truthful without competing with the booking status. */}
        {!isLiveBooking && (
          <Text style={styles.demoFootnote}>
            {demoRun
              ? 'Demo walkthrough — this request stays on this device. Nothing was sent to a dispatch server and no real ambulance is attached.'
              : 'Sample mode — database not configured. This booking was not saved; status changes are example data.'}
          </Text>
        )}
        {statusError ? (
          <Card style={styles.noticeCard} elevation="sm">
            <Text style={styles.noticeText}>{statusError}</Text>
          </Card>
        ) : null}

        {/* Timeline */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Request progress</Text>
          <TripTimeline
            steps={STATUS_STEPS}
            currentIndex={currentIndex}
            failed={isFailed}
            failedLabel="No crew accepted this request."
          />
        </Card>

        {/* Route + booking details */}
        <Card style={styles.card} elevation="md">
          <Text style={styles.sectionTitle}>Booking details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Service</Text>
            <Text style={styles.detailValue}>{category.name}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>
              {booking?.final_fare != null ? 'Final fare' : fareValue != null ? 'Indicative fare' : 'Fare'}
            </Text>
            <Text style={styles.detailValue}>
              {fareValue != null ? `NPR ${fareValue.toLocaleString('en-IN')}` : 'Confirmed after trip'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Patient</Text>
            <Text style={styles.detailValue}>{bookingData?.patientName || booking?.patient_name || 'Not recorded'}</Text>
          </View>
          <Badge
            label={currentStatus.toUpperCase()}
            variant={isCompleted ? 'success' : isCancelled || isFailed ? 'error' : 'info'}
            style={styles.statusBadge}
          />
        </Card>

        <View style={{ height: 140 }} />
      </ScrollView>

      <View style={styles.bottomBar}>
        {canCancel && (
          <Button
            title="Cancel request"
            onPress={handleCancelBooking}
            variant="outline"
            fullWidth
            loading={cancelling}
            disabled={cancelling}
          />
        )}
        {isFailed && (
          <Button title="Try again" onPress={handleRetry} fullWidth />
        )}
        {isCompleted && (
          <>
            {bookingId && !demoRun ? (
              <Button
                title="Rate this trip"
                onPress={() => navigation.navigate('Rating', { bookingId })}
                fullWidth
              />
            ) : null}
            <Button title="Book another ambulance" onPress={() => navigation.navigate('Home')} variant="outline" fullWidth />
          </>
        )}
        {isCancelled && (
          <Button title="Book another ambulance" onPress={() => navigation.navigate('Home')} fullWidth />
        )}
        {isFailed && (
          <Button title="Back to home" onPress={() => navigation.navigate('Home')} variant="ghost" fullWidth />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { ...typography.h3, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 40 },
  scrollView: { flex: 1 },

  // Map-first searching state ------------------------------------------------
  searchMapArea: { flex: 1, position: 'relative' },
  searchTopBar: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchBackButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchTitlePill: {
    backgroundColor: colors.surface,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  searchTitleText: { ...typography.bodySmall, fontWeight: '700', color: colors.text },
  searchTopSpacer: { width: 44 },
  searchSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  searchStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  searchStatusIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.redLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchStatusGlyph: { fontSize: 22, fontWeight: '800', color: colors.primary },
  searchStatusCopy: { flex: 1 },
  searchStatusTitle: { ...typography.h3, color: colors.primary },
  searchStatusMessage: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 19,
  },
  searchRouteRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  searchRouteRail: { width: 18, alignItems: 'center', paddingTop: 5 },
  searchRouteLine: { height: 14, width: 2, backgroundColor: colors.border, marginVertical: 3 },
  searchRouteCopy: { flex: 1, marginLeft: spacing.sm, gap: 7 },
  searchRouteText: { ...typography.bodySmall, color: colors.text },
  searchProgressPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.input,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  searchProgressText: { ...typography.caption, color: colors.textSecondary },
  searchMapNote: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
  searchError: {
    ...typography.caption,
    color: colors.warning,
    backgroundColor: colors.amberLight,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  searchCancelButton: { marginTop: spacing.md },
  routeDot: { width: 8, height: 8, borderRadius: 4 },

  heroCard: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  heroIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconProgress: { backgroundColor: colors.redLight },
  heroIconSuccess: { backgroundColor: colors.success },
  heroIconDanger: { backgroundColor: colors.redLight },
  heroIcon: { fontSize: 26 },
  heroIconGlyphPending: { color: colors.primary, fontWeight: '800' },
  heroIconGlyphSuccess: { color: colors.surface, fontWeight: '800' },
  heroTextWrap: { flex: 1 },
  heroTitle: { ...typography.h3, color: colors.text },
  heroTitlePending: { color: colors.primary },
  heroMessage: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 20 },
  searchingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  searchingText: { ...typography.caption, color: colors.textSecondary },

  noticeCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.amberLight,
  },
  noticeText: { ...typography.bodySmall, color: colors.warning },
  demoFootnote: {
    ...typography.caption,
    color: colors.textTertiary,
    lineHeight: 16,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
  },

  mapCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: 0,
    overflow: 'hidden',
  },
  mapWrap: { height: 150 },
  mapFill: { flex: 1 },

  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  previewTitle: { marginBottom: 0 },
  offerStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.input,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  stepperButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperDisabled: { opacity: 0.4 },
  stepperButtonText: { fontSize: 22, color: colors.textSecondary, lineHeight: 26 },
  offerValueWrap: { flex: 1, alignItems: 'center' },
  offerValue: { ...typography.h4, color: colors.text },
  offerCaption: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  previewNote: { ...typography.caption, color: colors.textSecondary, lineHeight: 16 },

  card: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  sectionTitle: { ...typography.h4, color: colors.text, marginBottom: spacing.md },

  crewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  crewTitle: { ...typography.h4, color: colors.text },
  driverRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  driverInfo: { flex: 1, marginLeft: spacing.md },
  driverNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  driverName: { ...typography.h4, color: colors.text, flexShrink: 1 },
  driverMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  driverSampleNote: {
    ...typography.caption,
    color: colors.textTertiary,
    marginBottom: spacing.md,
  },
  callIcon: { fontSize: 16 },

  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  vehicleIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.redLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleIcon: { fontSize: 18 },
  vehicleInfo: { flex: 1 },
  vehiclePlate: { fontSize: 15, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
  vehicleMetaStrong: { fontSize: 15, fontWeight: '600', color: colors.text },
  vehicleMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flex: 1, paddingHorizontal: spacing.xs },
  footnoteBlock: { marginTop: spacing.md },
  footnote: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },

  tripRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tripDotWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripDot: { width: 12, height: 12, borderRadius: 6 },
  tripInfo: { flex: 1 },
  tripLabel: { ...typography.caption, color: colors.textTertiary },
  tripValue: { ...typography.bodySmall, color: colors.text, fontWeight: '600', marginTop: 1 },
  tripConnector: {
    width: 2,
    height: 14,
    backgroundColor: colors.border,
    marginLeft: 16,
    marginVertical: 2,
  },

  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  detailLabel: { ...typography.body, color: colors.textSecondary },
  detailValue: { ...typography.body, color: colors.text, flex: 1, textAlign: 'right', marginLeft: spacing.md },
  statusBadge: { marginTop: spacing.md },

  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
});

export default BookingStatusScreen;
