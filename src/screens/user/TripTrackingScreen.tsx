import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Share, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Button, Card, Avatar, Badge } from '../../components/ui';
import { MapCanvas } from '../../components/map/MapCanvas';
import { TripTimeline } from '../../components/booking/TripTimeline';
import { RouteSummary } from '../../components/booking/RouteSummary';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { BOOKING_TIMELINE_STEPS, bookingStatusIndex } from '../../constants/bookingTimeline';
import { SERVICE_CATEGORIES } from '../../constants/serviceCategories';
import { estimateFare } from '../../constants/fares';
import { bookingsService } from '../../services/database/bookings';
import { assignedCrewService } from '../../services/database';
import { driversService } from '../../services/database/drivers';
import { profilesService } from '../../services/database/profiles';
import { tripsService } from '../../services/database/trips';
import { isSupabaseConfigured } from '../../services/database/client';
import { useTrackingRoute } from '../../hooks/useTrackingRoute';
import { useBookingStore } from '../../store/bookingStore';
import { isDemoMode } from '../../utils/demoMode';
import { openNativeDialer } from '../../utils/dialer';
import { straightLineKm } from '../../utils/geo';
import {
  isFreshTrackingLocation,
  isAssignedDriverLocation,
  isTrackableBookingStatus,
  SECURE_TRIP_TRACKING_ENABLED,
  trackingAgeLabel,
  TRACKING_POLL_INTERVAL_MS,
  TrackingCoordinate,
} from '../../utils/tracking';
import { Booking } from '../../types';

type RouteParams = {
  TripTracking: { bookingId?: string; booking?: Booking };
};

const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting for a driver to accept',
  assigned: 'Driver assigned — preparing to depart',
  arriving: 'Ambulance is on the way',
  arrived: 'Ambulance has arrived at the pickup',
  started: 'Trip in progress',
  completed: 'Trip completed',
  cancelled: 'Trip cancelled',
  rejected: 'Trip was rejected',
  draft: 'Waiting to be confirmed',
};

function pickupPointFromBooking(booking: Booking | null): TrackingCoordinate | null {
  if (!booking) return null;
  if (booking.pickup_lat == null || booking.pickup_lng == null) return null;
  const lat = Number(booking.pickup_lat);
  const lng = Number(booking.pickup_lng);
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

function destPointFromBooking(booking: Booking | null): TrackingCoordinate | null {
  if (!booking) return null;
  if (booking.dest_lat == null || booking.dest_lng == null) return null;
  const lat = Number(booking.dest_lat);
  const lng = Number(booking.dest_lng);
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

const TripTrackingScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'TripTracking'>>();
  const bookingId = route.params?.bookingId;
  const paramBooking = route.params?.booking;
  const { pickup, destination, setPickup, setDestination } = useBookingStore();

  const demoRun = isDemoMode();
  const trackingBookingId = bookingId ?? paramBooking?.id;
  const shouldFetch = Boolean(trackingBookingId && isSupabaseConfigured && !demoRun);

  const [booking, setBooking] = useState<Booking | null>(paramBooking ?? null);
  const [loading, setLoading] = useState(shouldFetch && !paramBooking);
  const [error, setError] = useState<string | null>(
    !paramBooking && !shouldFetch
      ? demoRun
        ? 'Open an active trip from your Activity list in demo mode.'
        : 'No booking was provided to track.'
      : null,
  );
  const [driverName, setDriverName] = useState<string | null>(null);
  const [driverRating, setDriverRating] = useState<number | null>(null);
  const [latestLocation, setLatestLocation] = useState<Awaited<ReturnType<typeof tripsService.getLatestLocation>>>(null);
  const [trackingError, setTrackingError] = useState(false);
  const [trackingNow, setTrackingNow] = useState(0);
  const refreshInFlight = useRef(false);
  const hasLoadedBooking = useRef(Boolean(paramBooking));

  useEffect(() => {
    if (!shouldFetch || !trackingBookingId) return;
    let active = true;
    const refresh = async () => {
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const data = await bookingsService.getById(trackingBookingId);
        if (!active) return;
        if (data) {
          hasLoadedBooking.current = true;
          setBooking(data);
          setError(null);
          if (
            SECURE_TRIP_TRACKING_ENABLED &&
            data.driver_id &&
            isTrackableBookingStatus(data.status)
          ) {
            try {
              const location = await tripsService.getLatestLocation(data.id);
              if (!active) return;
              setLatestLocation(
                isAssignedDriverLocation(location, data.driver_id) ? location : null,
              );
              setTrackingError(false);
            } catch {
              if (active) setTrackingError(true);
            }
          } else {
            setLatestLocation(null);
            setTrackingError(false);
          }
        } else {
          hasLoadedBooking.current = true;
          setBooking(null);
          setLatestLocation(null);
          setError('Booking not found.');
        }
      } catch {
        if (active) {
          setTrackingError(true);
          if (!hasLoadedBooking.current) setError('Failed to load trip details.');
        }
      } finally {
        refreshInFlight.current = false;
        if (active) {
          setLoading(false);
          setTrackingNow(Date.now());
        }
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), TRACKING_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [trackingBookingId, shouldFetch]);

  // Real driver identity only — never an invented person.
  useEffect(() => {
    const driverId = booking?.driver_id;
    if (!driverId || !isSupabaseConfigured || demoRun) return;
    let active = true;
    (async () => {
      try {
        const driver = await driversService.getById(driverId);
        if (!driver || !active) return;
        setDriverRating(driver.rating > 0 ? driver.rating : null);
        try {
          const profile = await profilesService.getById(driver.user_id);
          if (active && profile?.full_name && profile.full_name.trim()) {
            setDriverName(profile.full_name.trim());
          }
        } catch {
          // Keep the generic label.
        }
      } catch {
        // Driver details unavailable — the bar stays minimal.
      }
    })();
    return () => {
      active = false;
    };
  }, [booking?.driver_id, demoRun]);

  const routeDistanceKm = useMemo(() => {
    if (!booking) return null;
    if (booking.distance_km != null) return Number(booking.distance_km);
    if (
      booking.pickup_lat != null &&
      booking.pickup_lng != null &&
      booking.dest_lat != null &&
      booking.dest_lng != null
    ) {
      return straightLineKm(
        { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) },
        { lat: Number(booking.dest_lat), lng: Number(booking.dest_lng) },
      );
    }
    return null;
  }, [booking]);

  const liveLocation =
    booking &&
    latestLocation &&
    isAssignedDriverLocation(latestLocation, booking.driver_id) &&
    isTrackableBookingStatus(booking.status) &&
    isFreshTrackingLocation(latestLocation, trackingNow)
      ? latestLocation
      : null;
  const ambulancePoint: TrackingCoordinate | null = liveLocation
    ? { lat: liveLocation.lat, lng: liveLocation.lng }
    : null;
  const trackingTarget =
    booking?.status === 'started' ? destPointFromBooking(booking) : pickupPointFromBooking(booking);
  const trackingRoute = useTrackingRoute(
    ambulancePoint,
    trackingTarget,
    booking ? `${booking.id}:${booking.status}:${trackingTarget?.lat}:${trackingTarget?.lng}` : '',
    Boolean(
      SECURE_TRIP_TRACKING_ENABLED &&
      ambulancePoint &&
      trackingTarget &&
      !demoRun &&
      isSupabaseConfigured,
    ),
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading trip details…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !booking) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{error || 'Something went wrong.'}</Text>
          <Button title="Go Back" onPress={() => navigation.goBack()} variant="outline" style={{ marginTop: spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  const category = SERVICE_CATEGORIES[booking.category] ?? SERVICE_CATEGORIES.basic;
  const statusText = STATUS_TEXT[booking.status] ?? booking.status;
  const currentIndex = bookingStatusIndex(booking.status);
  const isTerminal = ['completed', 'cancelled', 'rejected'].includes(booking.status);
  const isCancelled = booking.status === 'cancelled' || booking.status === 'rejected';
  const fare = estimateFare(booking.category, routeDistanceKm);
  const finalFare = booking.final_fare != null ? Number(booking.final_fare) : null;

  const pickupPoint =
    booking.pickup_lat != null && booking.pickup_lng != null
      ? { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) }
      : pickup && pickup.lat != null && pickup.lng != null
        ? { lat: pickup.lat, lng: pickup.lng }
        : null;

  const destPoint =
    booking.dest_lat != null && booking.dest_lng != null
      ? { lat: Number(booking.dest_lat), lng: Number(booking.dest_lng) }
      : destination && destination.lat != null && destination.lng != null
        ? { lat: destination.lat, lng: destination.lng }
        : null;

  const handleShareTrip = async () => {
    if (!booking) return;
    try {
      await Share.share({
        message: [
          'RESQ Nepal trip update',
          `Status: ${STATUS_TEXT[booking.status] ?? booking.status}`,
          `From: ${booking.pickup_address}`,
          `To: ${booking.destination_address}`,
          `Category: ${booking.category === 'icu' ? 'ICU / Emergency Ambulance' : 'Basic Patient Delivery'}`,
          `Booking ref: ${booking.id}`,
          'Shared from the RESQ Nepal app. This is a status summary, not a live tracking link.',
        ].join('\n'),
      });
    } catch {
      // Sharing was cancelled or is unavailable on this device.
    }
  };

  const isLiveTrip = Boolean(trackingBookingId && isSupabaseConfigured && !demoRun);

  // Native dialer only — the crew's number is fetched through the
  // ownership-checked service and never rendered as text.
  const handleCallDriver = async () => {
    if (!isLiveTrip || !bookingId) {
      Alert.alert(
        'Demo walkthrough',
        'No call is placed in the demo — nothing is dialled and no real crew is attached. With a real assignment this button opens your phone’s dialer with the crew’s contact number.',
      );
      return;
    }
    let phone: string | null = null;
    try {
      const crew = await assignedCrewService.getForBooking(bookingId);
      phone = crew?.driverPhone ?? null;
    } catch {
      phone = null;
    }
    const result = await openNativeDialer(phone, (url) => Linking.openURL(url));
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

  const handleBookAgain = () => {
    if (!booking) return;
    // Pre-fill the route so the user only reviews and confirms — nothing is
    // submitted until they go through the booking steps again.
    setPickup({
      address: booking.pickup_address,
      lat: booking.pickup_lat ?? null,
      lng: booking.pickup_lng ?? null,
    });
    setDestination({
      address: booking.destination_address,
      lat: booking.dest_lat ?? null,
      lng: booking.dest_lng ?? null,
    });
    navigation.navigate('Home');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.mapArea}>
        <MapCanvas
          pickup={pickupPoint}
          destination={destPoint}
          ambulance={ambulancePoint}
          route={trackingRoute.route?.coordinates}
          caption={
            ambulancePoint && liveLocation?.recorded_at
              ? `Live ambulance · ${trackingAgeLabel(liveLocation.recorded_at, trackingNow) ?? 'location received'}`
              : 'Live ambulance location unavailable'
          }
          style={styles.map}
        />

        {/* Back control floating over the map, as in the reference. */}
        <TouchableOpacity
          style={styles.mapBackButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.mapBackArrow}>←</Text>
        </TouchableOpacity>

        {/* Driver bar — only when a driver is actually assigned */}
        {booking.driver_id && !isCancelled && (
          <View style={styles.driverBar}>
            <Avatar name={driverName ?? 'Driver'} size="sm" />
            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>{driverName ?? 'Assigned driver'}</Text>
              <View style={styles.ratingRow}>
                {driverRating !== null ? (
                  <>
                    <Text style={styles.starIcon}>★</Text>
                    <Text style={styles.ratingText}>{driverRating.toFixed(1)}</Text>
                  </>
                ) : (
                  <Text style={styles.ratingText}>Rating not available yet</Text>
                )}
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Bottom sheet */}
      <View style={styles.bottomCard}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.bottomScroll}
          contentContainerStyle={styles.bottomScrollContent}
        >
          <View style={styles.handleBar} />

          {/* Status banner — the real booking status, with honest notes about
              what this version can and cannot show. */}
          <View style={[styles.statusBanner, isCancelled && styles.statusBannerDanger]}>
            <View style={[styles.bannerDot, isCancelled && styles.bannerDotDanger]} />
            <View style={styles.bannerInfo}>
              <Text style={[styles.bannerTitle, isCancelled && styles.bannerTitleDanger]}>
                {statusText}
              </Text>
              {demoRun && (
                <Text style={styles.bannerMeta}>
                  Demo walkthrough trip — status changes are samples on this device.
                </Text>
              )}
              {!demoRun && !isSupabaseConfigured && (
                <Text style={styles.bannerMeta}>Sample mode — no live GPS tracking in this build.</Text>
              )}
              {isLiveTrip && !isTerminal && (
                <Text style={styles.bannerMeta}>
                  {demoRun
                    ? 'Live tracking is disabled in demo mode.'
                    : !SECURE_TRIP_TRACKING_ENABLED
                      ? 'Live tracking is disabled until the approved database policy is enabled.'
                    : !booking.driver_id
                      ? 'Tracking starts after a driver is assigned.'
                      : ambulancePoint && liveLocation?.recorded_at
                        ? `Ambulance ${trackingAgeLabel(liveLocation.recorded_at, trackingNow) ?? 'location received'}.`
                        : latestLocation && !isFreshTrackingLocation(latestLocation, trackingNow)
                          ? 'Last ambulance location is stale; waiting for a fresh update.'
                          : trackingError
                            ? 'Live location is temporarily unavailable. Retrying automatically.'
                            : 'Waiting for the ambulance’s first location update.'}
                </Text>
              )}
              {ambulancePoint && trackingRoute.route && (
                <Text style={styles.bannerMeta}>
                  {booking.status === 'started' ? 'To destination' : 'To pickup'}: {trackingRoute.route.distanceKm.toFixed(1)} km · ETA about {trackingRoute.route.durationMinutes} min
                </Text>
              )}
              {ambulancePoint && trackingRoute.unavailable && (
                <Text style={styles.bannerMeta}>Road distance and ETA are unavailable right now.</Text>
              )}
              {booking.duration_min != null && booking.status !== 'completed' && (
                <Text style={styles.bannerMeta}>
                  Recorded trip time: about {Math.round(Number(booking.duration_min))} min
                </Text>
              )}
            </View>
          </View>

          {/* Reference action — “Call Driver” uses the native dialer (no call
              is placed in demo mode). The share action stays in the sheet's
              action list below. */}
          {booking.driver_id && !isCancelled && !isTerminal && (
            <Button
              title="Call Driver"
              onPress={() => void handleCallDriver()}
              size="sm"
              fullWidth
              style={styles.callButton}
              icon={<Text style={styles.actionIcon}>📞</Text>}
            />
          )}

          <Card elevation="sm" style={styles.card}>
            <TripTimeline steps={BOOKING_TIMELINE_STEPS} currentIndex={currentIndex} failed={isCancelled} failedLabel="This trip did not complete." />
          </Card>

          <Card elevation="sm" style={styles.card}>
            <View style={styles.ambulanceRow}>
              <Text style={styles.ambulanceIcon}>🚑</Text>
              <View style={styles.ambulanceInfo}>
                <Text style={styles.ambulanceModel}>{category.name}</Text>
                <Text style={styles.plateNumber}>
                  {booking.ambulance_id ? 'Vehicle recorded against this booking' : 'Vehicle assigned by dispatch'}
                </Text>
              </View>
              <Badge
                label={booking.status.toUpperCase()}
                variant={booking.status === 'completed' ? 'success' : isCancelled ? 'error' : 'info'}
              />
            </View>

            <View style={styles.divider} />

            <RouteSummary
              pickup={{ address: booking.pickup_address, lat: null, lng: null }}
              destination={{ address: booking.destination_address, lat: null, lng: null }}
            />
          </Card>

          <Card elevation="sm" style={styles.card}>
            <Text style={styles.fareTitle}>Fare</Text>
            {finalFare != null ? (
              <View style={styles.fareRow}>
                <Text style={styles.totalLabel}>Final fare (recorded)</Text>
                <Text style={styles.totalValue}>NPR {finalFare.toLocaleString('en-IN')}</Text>
              </View>
            ) : fare ? (
              <>
                <View style={styles.fareRow}>
                  <Text style={styles.fareLabel}>Base fare</Text>
                  <Text style={styles.fareValue}>NPR {fare.baseFare}</Text>
                </View>
                <View style={styles.fareRow}>
                  <Text style={styles.fareLabel}>
                    Distance ({routeDistanceKm?.toFixed(1)} km{booking.distance_km != null ? '' : ', straight line'})
                  </Text>
                  <Text style={styles.fareValue}>NPR {fare.distanceCharge}</Text>
                </View>
                <View style={styles.fareRow}>
                  <Text style={styles.fareLabel}>Service fee</Text>
                  <Text style={styles.fareValue}>NPR {fare.serviceFee}</Text>
                </View>
                <View style={[styles.fareRow, styles.totalRow]}>
                  <Text style={styles.totalLabel}>Indicative total</Text>
                  <Text style={styles.totalValue}>NPR {fare.totalFare}</Text>
                </View>
              </>
            ) : (
              <Text style={styles.farePending}>
                Fare is confirmed after the trip — the recorded distance is not available yet.
              </Text>
            )}
            <Text style={styles.fareNote}>
              {finalFare != null
                ? 'As recorded on the completed booking. Paid in cash.'
                : 'Rate-card estimate — final fare is confirmed after the trip. Paid in cash.'}
            </Text>
          </Card>

          <View style={styles.actions}>
            {!isTerminal && (
              <Button
                title="Cancel ride"
                onPress={() => navigation.navigate('CancelRide', { bookingId: booking.id, booking })}
                variant="outline"
                fullWidth
              />
            )}
            <Button title="Share trip summary" onPress={handleShareTrip} variant="outline" fullWidth />
            {booking.status === 'completed' && (
              <Button
                title="View receipt"
                variant="outline"
                onPress={() => navigation.navigate('ShareReceipt', { booking })}
                fullWidth
              />
            )}
            {booking.status === 'completed' && (
              <Button
                title="Rate this trip"
                onPress={() => navigation.navigate('Rating', { bookingId, booking })}
                fullWidth
              />
            )}
            {isTerminal && (
              <Button title="Book again" onPress={handleBookAgain} fullWidth />
            )}
            {isTerminal && (
              <Button
                title={demoRun || !isSupabaseConfigured ? 'Back to activity' : 'Back to home'}
                onPress={() => navigation.navigate(demoRun || !isSupabaseConfigured ? 'Activity' : 'Home')}
                variant="ghost"
                fullWidth
              />
            )}
          </View>
          <View style={{ height: spacing.xl }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  loadingText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center' },

  mapArea: { flex: 1, position: 'relative' },
  map: { ...StyleSheet.absoluteFill },
  mapBackButton: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  mapBackArrow: { fontSize: 22, color: colors.text },

  driverBar: {
    position: 'absolute',
    top: 68,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.md,
  },
  driverInfo: { flex: 1 },
  driverName: { ...typography.body, fontWeight: '600' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  starIcon: { color: colors.warning, fontSize: 14 },
  ratingText: { ...typography.caption, color: colors.textSecondary },

  bottomCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    maxHeight: '62%',
    ...shadows.lg,
  },
  bottomScroll: { paddingHorizontal: spacing.lg },
  bottomScrollContent: { paddingBottom: spacing.xxl },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginVertical: spacing.sm,
  },

  statusBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.greenLight,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  statusBannerDanger: { backgroundColor: colors.redLight },
  bannerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
    marginTop: 4,
  },
  bannerDotDanger: { backgroundColor: colors.error },
  bannerInfo: { flex: 1 },
  bannerTitle: { ...typography.body, fontWeight: '700', color: colors.success },
  bannerTitleDanger: { color: colors.error },
  bannerMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },

  callButton: { marginBottom: spacing.md },
  actionIcon: { fontSize: 15 },

  card: { marginBottom: spacing.md },

  ambulanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ambulanceIcon: { fontSize: 28 },
  ambulanceInfo: { flex: 1 },
  ambulanceModel: { ...typography.body, fontWeight: '600' },
  plateNumber: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },

  fareTitle: { ...typography.h4, marginBottom: spacing.sm },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  fareLabel: { ...typography.bodySmall, color: colors.textSecondary, flex: 1, paddingRight: spacing.sm },
  fareValue: { ...typography.bodySmall, fontWeight: '500' },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.xs },
  totalLabel: { ...typography.body, fontWeight: '700', flex: 1 },
  totalValue: { ...typography.body, fontWeight: '700', color: colors.primary },
  farePending: { ...typography.bodySmall, color: colors.textSecondary },
  fareNote: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  actions: { gap: spacing.sm, marginTop: spacing.xs },
});

export default TripTrackingScreen;
