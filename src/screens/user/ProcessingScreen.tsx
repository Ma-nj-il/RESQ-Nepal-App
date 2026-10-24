import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { Avatar, Badge, Button, Card } from '../../components/ui';
import { MapCanvas } from '../../components/map/MapCanvas';
import { SearchRadar } from '../../components/booking/SearchRadar';
import {
  assignedCrewService,
  bookingsService,
  isSupabaseConfigured,
  tripsService,
} from '../../services/database';
import type { AssignedCrew } from '../../services/database/assignedCrew';
import { useTrackingRoute } from '../../hooks/useTrackingRoute';
import { useAuthStore } from '../../store/authStore';
import { useBookingStore } from '../../store/bookingStore';
import { openNativeDialer } from '../../utils/dialer';
import { isDemoMode } from '../../utils/demoMode';
import { buildDemoAssignmentPreview } from '../../utils/demoAssignmentPreview';
import { createDemoTripReceipt } from '../../utils/demoTrip';
import {
  isAssignedDriverLocation,
  isFreshTrackingLocation,
  isTrackableBookingStatus,
  SECURE_TRIP_TRACKING_ENABLED,
  trackingAgeLabel,
  TRACKING_POLL_INTERVAL_MS,
  TrackingCoordinate,
} from '../../utils/tracking';
import { Booking, BookingStatus } from '../../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEMO_ASSIGNMENT_TRANSITION_MS = 8000;

function toMapPoint(lat: number | null | undefined, lng: number | null | undefined): TrackingCoordinate | null {
  if (lat == null || lng == null) return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
    ? point
    : null;
}

function getProcessingStatusTitle(status: BookingStatus, assigned: boolean): string {
  if (status === 'pending') return assigned ? 'Ambulance Assigned' : 'Finding an Ambulance…';
  const titles: Record<BookingStatus, string> = {
    draft: 'Booking not submitted',
    pending: assigned ? 'Ambulance Assigned' : 'Finding an Ambulance…',
    assigned: 'Ambulance Assigned',
    arriving: 'Ambulance approaching pickup',
    arrived: 'Ambulance arrived',
    started: 'Trip in progress',
    completed: 'Trip completed',
    cancelled: 'Booking cancelled',
    rejected: 'No ambulance available',
  };
  return titles[status];
}

/**
 * Booking creation, search, assignment and tracking stay on this screen.
 * Demo assignment previews are local-only and separate from live tracking.
 */
const ProcessingScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const { user } = useAuthStore();
  const {
    pickup,
    destination,
    selectedCategory,
    setBooking: saveBooking,
    setBookingStatus,
  } = useBookingStore();

  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [demoWaiting, setDemoWaiting] = useState(false);
  const [demoAssigned, setDemoAssigned] = useState(false);
  const [crewResult, setCrewResult] = useState<{
    key: string;
    value: AssignedCrew;
  } | null>(null);
  const [latestLocation, setLatestLocation] = useState<
    Awaited<ReturnType<typeof tripsService.getLatestLocation>>
  >(null);
  const [trackingError, setTrackingError] = useState(false);
  const [trackingNow, setTrackingNow] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const cancelledRef = useRef(false);
  const refreshInFlight = useRef(false);
  // Prevents overlapping create calls (e.g. rapid Retry taps) from inserting
  // two bookings for the same request.
  const creatingRef = useRef(false);

  const bookingData = route.params?.bookingData;
  const demoRun = isDemoMode();
  const isLiveBooking = isSupabaseConfigured && !demoRun;

  const createBooking = useCallback(async () => {
    if (creatingRef.current) return;
    const currentBooking = useBookingStore.getState().currentBooking;
    if (
      isLiveBooking &&
      currentBooking &&
      currentBooking.user_id === user?.id &&
      ['pending', 'assigned', 'arriving', 'arrived', 'started'].includes(currentBooking.status)
    ) {
      setBooking(currentBooking);
      setBookingStatus(currentBooking.status);
      return;
    }
    creatingRef.current = true;
    try {
      // Yield once so this function never calls setState synchronously from
      // the mount effect (avoids cascading renders).
      await Promise.resolve();

      // ── Demo mode / database not configured: walk through the flow without
      // persisting anything. The UI labels this clearly.
      if (!isSupabaseConfigured || demoRun) {
        if (cancelledRef.current) return;
        if (demoRun) setDemoWaiting(true);
        return;
      }

      // ── Database configured: create the real booking row.
      const userId = user?.id;
      if (!userId) {
        setError('You need to be signed in to create a booking.');
        return;
      }
      if (!pickup?.address || !destination?.address) {
        setError('Pickup and destination are required. Go back and select both addresses.');
        return;
      }

      const ambulance = bookingData?.ambulance;
      const record = await bookingsService.create({
        user_id: userId,
        // Only pass ambulance_id when it is a real database UUID; sample and
        // category options use placeholder ids that would fail the foreign key.
        ambulance_id:
          typeof ambulance?.id === 'string' && UUID_RE.test(ambulance.id)
            ? ambulance.id
            : undefined,
        category: ambulance?.category ?? selectedCategory,
        pickup_address: pickup.address,
        pickup_lat: pickup.lat ?? undefined,
        pickup_lng: pickup.lng ?? undefined,
        destination_address: destination.address,
        dest_lat: destination.lat ?? undefined,
        dest_lng: destination.lng ?? undefined,
        status: 'pending',
        patient_name: bookingData?.patientName,
        patient_age: bookingData?.patientAge,
        patient_condition: bookingData?.patientCondition,
        patient_phone: bookingData?.patientPhone,
        notes: bookingData?.notes ?? undefined,
        emergency_level: bookingData?.emergencyLevel ?? 'medium',
        // Only sent when a real rate-card estimate exists; otherwise the fare
        // stays pending until it is confirmed after the trip.
        estimated_fare: bookingData?.totalFare ?? undefined,
        payment_method: bookingData?.paymentMethod ?? 'cash',
      });

      saveBooking(record);
      setBookingStatus(record.status);
      if (cancelledRef.current) return;
      creatingRef.current = false;
      setBooking(record);
    } catch {
      if (cancelledRef.current) return;
      setError(
        'We could not create your booking. Check your connection and try again — no booking was placed.',
      );
    } finally {
      creatingRef.current = false;
    }
  }, [
    bookingData,
    demoRun,
    destination,
    isLiveBooking,
    pickup,
    saveBooking,
    selectedCategory,
    setBookingStatus,
    user,
  ]);

  useEffect(() => {
    cancelledRef.current = false;

    // Kick off booking creation on the next tick so no setState is called
    // synchronously from the effect body.
    const kickoff = setTimeout(() => {
      void createBooking();
    }, 0);

    return () => {
      cancelledRef.current = true;
      clearTimeout(kickoff);
    };
  }, [attempt, createBooking]);

  useEffect(() => {
    if (!demoRun || !demoWaiting || demoAssigned) return;
    const transition = setTimeout(
      () => setDemoAssigned(true),
      DEMO_ASSIGNMENT_TRANSITION_MS,
    );
    return () => clearTimeout(transition);
  }, [demoAssigned, demoRun, demoWaiting]);

  useEffect(() => {
    if (!booking?.id || !isLiveBooking || !isFocused) return;
    let active = true;
    const refreshInFlightRef = refreshInFlight;
    const refresh = async () => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      try {
        const record = await bookingsService.getById(booking.id);
        if (!active || !record) return;
        setBooking(record);
        saveBooking(record);
        setBookingStatus(record.status);
        setStatusError(null);
        if (
          SECURE_TRIP_TRACKING_ENABLED &&
          record.driver_id &&
          isTrackableBookingStatus(record.status)
        ) {
          try {
            const location = await tripsService.getLatestLocation(record.id);
            if (!active) return;
            setLatestLocation(
              isAssignedDriverLocation(location, record.driver_id) ? location : null,
            );
            setTrackingError(false);
          } catch {
            if (active) {
              setLatestLocation(null);
              setTrackingError(true);
            }
          }
        } else {
          setLatestLocation(null);
          setTrackingError(false);
        }
      } catch {
        if (active) setStatusError('Booking status could not be refreshed. Retrying automatically…');
      } finally {
        refreshInFlightRef.current = false;
        if (active) setTrackingNow(Date.now());
      }
    };

    void refresh();
    const interval = setInterval(() => void refresh(), TRACKING_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [booking?.id, isFocused, isLiveBooking, saveBooking, setBookingStatus]);

  const hasAssignedIdentity = Boolean(booking?.driver_id || booking?.ambulance_id);
  const hasAssignment =
    demoAssigned ||
    hasAssignedIdentity ||
    ['assigned', 'arriving', 'arrived', 'started'].includes(booking?.status ?? '');
  const crewKey = booking
    ? `${booking.id}:${booking.driver_id ?? ''}:${booking.ambulance_id ?? ''}`
    : null;
  const assignedBookingId = booking?.id;

  useEffect(() => {
    if (!assignedBookingId || !hasAssignedIdentity || !isLiveBooking) return;
    const key = `${assignedBookingId}:${booking?.driver_id ?? ''}:${booking?.ambulance_id ?? ''}`;
    let active = true;
    void assignedCrewService
      .getForBooking(assignedBookingId)
      .then((result) => {
        if (active) setCrewResult({ key, value: result });
      })
      .catch(() => {
        if (active) {
          setCrewResult({
            key,
            value: {
              assigned: true,
              driverName: null,
              driverAvatarUrl: null,
              driverVerified: null,
              driverPhone: null,
              plateNumber: null,
              model: null,
              source: 'restricted',
            },
          });
        }
      });
    return () => {
      active = false;
    };
  }, [
    assignedBookingId,
    booking?.driver_id,
    booking?.ambulance_id,
    hasAssignedIdentity,
    isLiveBooking,
  ]);

  const crew = crewResult?.key === crewKey ? crewResult.value : null;
  const bookingStatus = booking?.status ?? 'pending';
  const statusTitle = getProcessingStatusTitle(bookingStatus, hasAssignment);
  const isTerminal = ['completed', 'cancelled', 'rejected'].includes(bookingStatus);
  const canCancel = ['pending', 'assigned'].includes(bookingStatus) && isLiveBooking;
  const visibleLocation =
    isLiveBooking &&
    SECURE_TRIP_TRACKING_ENABLED &&
    booking?.driver_id &&
    isTrackableBookingStatus(booking.status) &&
    isAssignedDriverLocation(latestLocation, booking.driver_id) &&
    isFreshTrackingLocation(latestLocation, trackingNow)
      ? latestLocation
      : null;
  const ambulancePoint: TrackingCoordinate | null = visibleLocation
    ? { lat: visibleLocation.lat, lng: visibleLocation.lng }
    : null;
  const pickupPoint = useMemo(
    () => toMapPoint(booking?.pickup_lat ?? pickup?.lat, booking?.pickup_lng ?? pickup?.lng),
    [booking?.pickup_lat, booking?.pickup_lng, pickup?.lat, pickup?.lng],
  );
  const destinationPoint = useMemo(
    () => toMapPoint(booking?.dest_lat ?? destination?.lat, booking?.dest_lng ?? destination?.lng),
    [booking?.dest_lat, booking?.dest_lng, destination?.lat, destination?.lng],
  );
  const demoPreview = useMemo(
    () => buildDemoAssignmentPreview(demoRun && demoAssigned, pickupPoint),
    [demoAssigned, demoRun, pickupPoint],
  );
  const trackingStart = demoPreview?.ambulanceLocation ?? ambulancePoint;
  const routeTarget = demoPreview
    ? pickupPoint
    : bookingStatus === 'started'
      ? destinationPoint
      : pickupPoint;
  const routeKey = demoPreview
    ? `demo:${demoPreview.ambulanceLocation?.lat}:${demoPreview.ambulanceLocation?.lng}:${routeTarget?.lat}:${routeTarget?.lng}`
    : booking
      ? `${booking.id}:${bookingStatus}:${routeTarget?.lat}:${routeTarget?.lng}`
      : '';
  const trackingRoute = useTrackingRoute(
    trackingStart,
    routeTarget,
    routeKey,
    Boolean(
      routeTarget &&
      trackingStart &&
      isFocused &&
      (demoPreview || (SECURE_TRIP_TRACKING_ENABLED && isLiveBooking))
    ),
  );

  const handleCallDriver = async () => {
    if (demoRun && demoAssigned) {
      Alert.alert('Demo preview', 'Driver calling is not connected in this demo.');
      return;
    }
    const result = await openNativeDialer(crew?.driverPhone, (url) => Linking.openURL(url));
    if (result === 'invalid') {
      Alert.alert('Driver contact unavailable', 'The assigned driver has not shared a dialable number.');
    } else if (result === 'failed') {
      Alert.alert('Could not open the dialer', 'Your device could not open the phone dialer.');
    }
  };

  const handleCancel = () => {
    if (!booking || cancelling) return;
    Alert.alert('Cancel ambulance request?', 'The active ambulance request will be cancelled.', [
      { text: 'Keep request', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: async () => {
          setCancelling(true);
          try {
            const updated = await bookingsService.cancel(booking.id);
            setBooking(updated);
            saveBooking(updated);
            setBookingStatus(updated.status);
          } catch {
            Alert.alert('Cancellation failed', 'Could not cancel the request. Check your connection and retry.');
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  };

  const handleRetry = () => {
    setError(null);
    setDemoWaiting(false);
    setDemoAssigned(false);
    setAttempt((n) => n + 1);
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  const handleCompleteDemoTrip = () => {
    if (!demoRun || !demoAssigned) return;
    const demoTrip = createDemoTripReceipt({
      demoModeEnabled: demoRun,
      category: bookingData?.ambulance?.category ?? selectedCategory,
      pickupAddress: bookingData?.pickup?.address ?? pickup?.address,
      destinationAddress: bookingData?.destination?.address ?? destination?.address,
      pickupPoint: toMapPoint(
        bookingData?.pickup?.lat ?? pickup?.lat,
        bookingData?.pickup?.lng ?? pickup?.lng,
      ),
      destinationPoint: toMapPoint(
        bookingData?.destination?.lat ?? destination?.lat,
        bookingData?.destination?.lng ?? destination?.lng,
      ),
      routeEstimateDistanceKm: bookingData?.fareBreakdown?.distanceKm,
    });
    if (!demoTrip) return;
    navigation.navigate('Arrival', { demoTrip });
  };

  const isSearching = !hasAssignment && (bookingStatus === 'pending' || demoWaiting);
  const canShowRadar = !error && isSearching;
  const locationCaption = demoPreview
    ? demoPreview.ambulanceLocation
      ? 'DEMO PREVIEW · simulated location, not live GPS'
      : 'DEMO PREVIEW · set pickup coordinates to preview a map marker'
    : visibleLocation?.recorded_at
    ? `Live ambulance · ${trackingAgeLabel(visibleLocation.recorded_at, trackingNow) ?? 'location received'}`
    : hasAssignment
      ? 'Live location unavailable'
      : undefined;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.mapArea}>
        <MapCanvas
          pickup={pickupPoint}
          destination={destinationPoint}
          ambulance={demoPreview?.ambulanceLocation ?? ambulancePoint}
          route={trackingRoute.route?.coordinates}
          pickupLabel={booking?.pickup_address ?? pickup?.address}
          destinationLabel={booking?.destination_address ?? destination?.address}
          caption={locationCaption}
          interactive
          style={styles.map}
        />
        {canShowRadar ? <SearchRadar active={isFocused} /> : null}
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => navigation.navigate('MenuDrawer')}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          accessibilityHint="Opens the RESQ Nepal menu"
        >
          <Text style={styles.menuButtonIcon}>☰</Text>
        </TouchableOpacity>
        <View style={styles.topPill}>
          <Text style={styles.topPillText}>
            {hasAssignment ? 'Ambulance tracking' : 'Ambulance search'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={styles.sheet}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.handleBar} />

        {error ? (
          <View style={styles.errorBody}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.title}>Booking not created</Text>
            <Text style={styles.subtitle}>{error}</Text>
            <Button title="Try again" onPress={handleRetry} fullWidth style={styles.retryButton} />
            <Button title="Go back" variant="ghost" onPress={handleGoBack} fullWidth />
          </View>
        ) : (
          <>
            <View style={styles.statusRow}>
              <View style={[styles.statusIconWrap, hasAssignment && styles.statusIconAssigned]}>
                {canShowRadar ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.statusIconText}>
                    {bookingStatus === 'completed'
                      ? '✓'
                      : bookingStatus === 'cancelled' || bookingStatus === 'rejected'
                        ? '!'
                        : '🚑'}
                  </Text>
                )}
              </View>
              <View style={styles.statusCopy}>
                <Text style={styles.title}>{statusTitle}</Text>
                <Text style={styles.subtitle}>
                  {hasAssignment
                    ? demoAssigned
                      ? 'Local-only demo preview — no dispatch booking or driver data is connected.'
                      : 'Your assigned ambulance and trip status are shown below.'
                    : demoRun
                      ? 'Demo mode — no booking was sent to dispatch.'
                      : isSupabaseConfigured
                        ? 'Looking for a verified crew near your pickup.'
                        : 'Sample mode — the database is not configured, so nothing was saved.'}
                </Text>
              </View>
            </View>

            {(pickup?.address || destination?.address) ? (
              <View style={styles.routeRow}>
              <View style={styles.routeRail}>
                <View style={[styles.routeDot, styles.routeDotPickup]} />
                <View style={styles.routeLine} />
                <View style={[styles.routeDot, styles.routeDotDestination]} />
              </View>
              <View style={styles.routeCopy}>
                <Text style={styles.routeText} numberOfLines={1}>
                  {booking?.pickup_address || pickup?.address || 'Pickup location'}
                </Text>
                <Text style={styles.routeText} numberOfLines={1}>
                  {booking?.destination_address || destination?.address || 'Destination'}
                </Text>
              </View>
              </View>
            ) : null}

            <Text style={styles.helper}>
              {demoAssigned
                ? 'This preview uses simulated local coordinates and illustrative estimates only.'
                : hasAssignment
                ? 'Booking status refreshes automatically. The search radar is illustrative, not GPS.'
                : demoRun
                  ? demoWaiting
                    ? 'The radar is illustrative only. No real ambulance, driver or GPS data is attached.'
                    : 'Demo walkthrough — no dispatch server is contacted. The radar is illustrative, not live GPS.'
                  : isSupabaseConfigured
                    ? 'This may take a few moments. The radar is illustrative, not live GPS.'
                    : 'Sample mode — the database is not configured, so nothing is saved.'}
            </Text>

            {statusError ? <Text style={styles.statusError}>{statusError}</Text> : null}

            {demoRun && demoWaiting && !demoAssigned ? (
              <Button
                title="Preview Assigned Ambulance"
                onPress={() => setDemoAssigned(true)}
                fullWidth
                style={styles.demoPreviewButton}
              />
            ) : null}

            {demoPreview ? (
              <>
                <Card style={styles.assignedCard} elevation="sm">
                  <View style={styles.assignedHeading}>
                    <Text style={styles.assignedTitle}>Assigned ambulance</Text>
                    <Badge label="DEMO PREVIEW" variant="info" />
                  </View>
                  <View style={styles.driverRow}>
                    <Avatar name={demoPreview.driverName} size="lg" />
                    <View style={styles.driverCopy}>
                      <Text style={styles.driverName}>{demoPreview.driverName}</Text>
                      <Text style={styles.detailText}>Sample driver · fictitious</Text>
                    </View>
                  </View>
                  <View style={styles.vehicleRow}>
                    <Text style={styles.vehicleIcon}>🚑</Text>
                    <View style={styles.vehicleCopy}>
                      <Text style={styles.vehiclePlate}>
                        {demoPreview.vehicleRegistration} · SAMPLE
                      </Text>
                      <Text style={styles.detailText}>{demoPreview.vehicleModel}</Text>
                    </View>
                  </View>
                  <Button
                    title="Call Driver"
                    onPress={() => void handleCallDriver()}
                    fullWidth
                    size="lg"
                    style={styles.callButton}
                  />
                </Card>
                <Card style={styles.trackingCard} elevation="sm">
                  <View style={styles.assignedHeading}>
                    <Text style={styles.assignedTitle}>Driver is on the way</Text>
                    <Badge label="ILLUSTRATIVE" variant="warning" />
                  </View>
                  {trackingRoute.route ? (
                    <>
                      <Text style={styles.etaText}>
                        Approx. {trackingRoute.route.durationMinutes} min to pickup
                      </Text>
                      <Text style={styles.distanceText}>
                        Approx. {trackingRoute.route.distanceKm.toFixed(1)} km to pickup
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.etaText}>{demoPreview.etaLabel} to pickup</Text>
                      <Text style={styles.distanceText}>{demoPreview.distanceLabel} to pickup</Text>
                    </>
                  )}
                  <Text style={styles.routeDisclaimer}>
                    Simulated demo location and illustrative route/ETA only. Not live GPS, dispatch,
                    traffic, or a real arrival prediction.
                  </Text>
                  {!demoPreview.ambulanceLocation ? (
                    <Text style={styles.detailText}>
                      Add pickup coordinates to preview the simulated ambulance marker and route.
                    </Text>
                  ) : trackingRoute.unavailable ? (
                    <Text style={styles.detailText}>
                      The road-route preview is unavailable; displayed sample estimates remain illustrative.
                    </Text>
                  ) : null}
                </Card>
                {demoRun && demoAssigned ? (
                  <Button
                    title="Complete Demo Trip"
                    onPress={handleCompleteDemoTrip}
                    fullWidth
                    size="lg"
                    style={styles.demoPreviewButton}
                  />
                ) : null}
              </>
            ) : null}

            {hasAssignment && booking ? (
              <>
                <Card style={styles.assignedCard} elevation="sm">
                  <View style={styles.assignedHeading}>
                    <Text style={styles.assignedTitle}>Assigned ambulance</Text>
                    <Badge label={booking.status.toUpperCase()} variant="info" />
                  </View>
                  {crew?.driverName ? (
                    <View style={styles.driverRow}>
                      <Avatar
                        name={crew.driverName}
                        uri={crew.driverAvatarUrl ?? undefined}
                        size="lg"
                      />
                      <View style={styles.driverCopy}>
                        <View style={styles.driverNameRow}>
                          <Text style={styles.driverName} numberOfLines={1}>
                            {crew.driverName}
                          </Text>
                          {crew.driverVerified === true ? (
                            <Badge label="VERIFIED" variant="success" />
                          ) : null}
                        </View>
                        <Text style={styles.detailText}>Driver</Text>
                      </View>
                    </View>
                  ) : null}

                  <View style={styles.vehicleRow}>
                    <Text style={styles.vehicleIcon}>🚑</Text>
                    <View style={styles.vehicleCopy}>
                      <Text style={styles.vehiclePlate}>
                        {crew?.plateNumber ?? 'Vehicle registration unavailable'}
                      </Text>
                      {crew?.model ? <Text style={styles.detailText}>{crew.model}</Text> : null}
                    </View>
                  </View>
                  {!crew?.driverName ? (
                    <Text style={styles.detailText}>
                      Driver details are unavailable for this booking.
                    </Text>
                  ) : null}

                  {!isTerminal ? (
                    <Button
                      title={crew?.driverPhone ? 'Call Driver' : 'Driver contact unavailable'}
                      onPress={() => void handleCallDriver()}
                      disabled={!crew?.driverPhone}
                      fullWidth
                      size="lg"
                      style={styles.callButton}
                    />
                  ) : null}
                </Card>

                <Card style={styles.trackingCard} elevation="sm">
                  <Text style={styles.assignedTitle}>
                    {bookingStatus === 'started' ? 'Trip in progress' : 'Ambulance location'}
                  </Text>
                  {visibleLocation && trackingRoute.route ? (
                    <>
                      <Text style={styles.etaText}>
                        {bookingStatus === 'arriving'
                          ? `Ambulance arriving in approximately ${trackingRoute.route.durationMinutes} min`
                          : bookingStatus === 'started'
                            ? `Estimated trip time: approximately ${trackingRoute.route.durationMinutes} min`
                            : `Estimated route to pickup: approximately ${trackingRoute.route.durationMinutes} min`}
                      </Text>
                      <Text style={styles.distanceText}>
                        {trackingRoute.route.distanceKm.toFixed(1)} km
                        {bookingStatus === 'started' ? ' to destination' : ' to pickup'}
                      </Text>
                      <Text style={styles.routeDisclaimer}>
                        Route estimate; traffic conditions are not verified.
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.detailText}>
                      {trackingError
                        ? 'Live location is temporarily unavailable. Waiting for a fresh GPS update.'
                        : !SECURE_TRIP_TRACKING_ENABLED
                          ? 'Live tracking is unavailable until the secure tracking migration is reviewed and the feature is enabled.'
                          : visibleLocation && trackingRoute.loading
                            ? 'Fresh ambulance location received. Calculating a road route and ETA…'
                            : visibleLocation && trackingRoute.unavailable
                              ? 'Live location is available, but a road route could not be calculated. Distance and ETA are unavailable.'
                              : visibleLocation
                                ? 'Live location is available. A valid road route and ETA are not available yet.'
                                : 'Waiting for a fresh ambulance GPS location. Distance and ETA are unavailable.'}
                    </Text>
                  )}
                </Card>
              </>
            ) : null}

            {isTerminal ? (
              <Button
                title="Back to Home"
                onPress={handleGoBack}
                variant="outline"
                fullWidth
                style={styles.retryButton}
              />
            ) : canCancel ? (
              <Button
                title="Cancel request"
                onPress={handleCancel}
                variant="outline"
                fullWidth
                loading={cancelling}
                disabled={cancelling}
                style={styles.retryButton}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapArea: { flex: 1, minHeight: 220, position: 'relative' },
  map: { ...StyleSheet.absoluteFill },
  menuButton: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  menuButtonIcon: { fontSize: 20, color: colors.text, fontWeight: '700' },
  topPill: {
    position: 'absolute',
    top: spacing.md + 48,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    ...shadows.sm,
  },
  topPillText: { ...typography.bodySmall, fontWeight: '700', color: colors.text },

  sheetScroll: { flexGrow: 0, flexShrink: 1, maxHeight: '56%' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    ...shadows.lg,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.redLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconAssigned: { backgroundColor: colors.greenLight },
  statusIconText: { fontSize: 20, fontWeight: '800', color: colors.success },
  statusCopy: { flex: 1 },
  title: { ...typography.h3, color: colors.primary },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },

  routeRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  routeRail: { width: 18, alignItems: 'center', paddingTop: 5 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeDotPickup: { backgroundColor: colors.success },
  routeDotDestination: { backgroundColor: colors.primary },
  routeLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 3 },
  routeCopy: { flex: 1, marginLeft: spacing.sm, gap: 7 },
  routeText: { ...typography.bodySmall, color: colors.text },
  helper: {
    ...typography.caption,
    color: colors.textTertiary,
    lineHeight: 17,
    marginTop: spacing.md,
  },
  statusError: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.sm,
  },
  assignedCard: { marginTop: spacing.md, padding: spacing.md },
  trackingCard: { marginTop: spacing.md, padding: spacing.md },
  assignedHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  assignedTitle: { ...typography.h4, color: colors.text, flex: 1 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  driverCopy: { flex: 1 },
  driverNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  driverName: { ...typography.h4, color: colors.text, flexShrink: 1 },
  detailText: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.xs },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  vehicleIcon: { fontSize: 26 },
  vehicleCopy: { flex: 1 },
  vehiclePlate: { ...typography.body, color: colors.text, fontWeight: '700' },
  callButton: { marginTop: spacing.md },
  demoPreviewButton: { marginTop: spacing.md },
  etaText: { ...typography.body, color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  distanceText: { ...typography.bodySmall, color: colors.text, marginTop: spacing.xs },
  routeDisclaimer: { ...typography.caption, color: colors.textTertiary, marginTop: spacing.xs },

  errorBody: { alignItems: 'center' },
  errorIcon: { fontSize: 34, marginBottom: spacing.sm },
  retryButton: { marginTop: spacing.lg, marginBottom: spacing.sm },
});

export default ProcessingScreen;
