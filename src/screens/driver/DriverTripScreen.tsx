import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Button, Card, Badge, Avatar } from '../../components/ui';
import { MapCanvas } from '../../components/map/MapCanvas';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { bookingsService, driversService } from '../../services/database';
import { useDriverDemoStore } from '../../store/driverDemoStore';
import { useAuthStore } from '../../store/authStore';
import { isDemoMode } from '../../utils/demoMode';
import { SECURE_TRIP_TRACKING_ENABLED } from '../../utils/tracking';
import {
  ArrivalDetectionResult,
  ArrivalDetectorState,
  ArrivalLocationFix,
  createSimulatedArrivalFixes,
  emptyArrivalDetector,
  isUsableArrivalFix,
  updateArrivalDetection,
} from '../../utils/arrivalDetection';
import { useDriverTripLocation } from '../../hooks/useDriverTripLocation';
import { useTrackingRoute } from '../../hooks/useTrackingRoute';
import { Booking } from '../../types';
import {
  buildGoogleMapsDirectionsUrl,
  canAdvanceDriverTripPhase,
  getDriverTripDestination,
  phaseFromBookingStatus,
  DriverTripPhase,
} from '../../utils/driverTrip';
import DriverNavigationHeader from '../../components/driver/DriverNavigationHeader';

type TripPhase = DriverTripPhase;

const DriverTripScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const bookingId = route.params?.bookingId;

  // Demo walkthrough — the sample trip lives in an isolated in-memory store;
  // every phase change here is local and never written to the database.
  const isDemoDriver = useAuthStore((state) => state.isDemoDriver);
  const walkthrough = isDemoMode() && isDemoDriver;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<TripPhase>('pickup');
  const [navigating, setNavigating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [routeRetry, setRouteRetry] = useState(0);
  const [arrivalResult, setArrivalResult] = useState<{
    key: string;
    result: ArrivalDetectionResult;
  } | null>(null);
  const [demoLocation, setDemoLocation] = useState<{
    key: string;
    fix: ArrivalLocationFix;
  } | null>(null);
  const refreshInFlight = useRef(false);
  const assignedDriverId = useRef<string | null>(null);
  const arrivalDetector = useRef<{
    key: string;
    state: ArrivalDetectorState;
    lastGpsTimestamp: number | null;
  }>({ key: '', state: emptyArrivalDetector(), lastGpsTimestamp: null });
  const destinationPhase = phase === 'started' || phase === 'hospital-arrived';
  const routeDestination = booking
    ? getDriverTripDestination(
        phase,
        { lat: booking.pickup_lat, lng: booking.pickup_lng },
        { lat: booking.dest_lat, lng: booking.dest_lng },
      )
    : null;
  const arrivalPhase = phase === 'pickup' || phase === 'started';
  const arrivalTargetName = phase === 'started' ? 'Hospital' : 'Pickup';
  const arrivalTarget = arrivalPhase ? routeDestination : null;
  const arrivalTargetLatitude = arrivalTarget?.lat;
  const arrivalTargetLongitude = arrivalTarget?.lng;
  const arrivalKey = `${booking?.id ?? ''}:${arrivalTargetName}`;
  const arrivalResultForTarget =
    arrivalResult?.key === arrivalKey ? arrivalResult.result : null;
  const demoLocationForTarget =
    demoLocation?.key === arrivalKey ? demoLocation.fix : null;
  const processGpsFix = useCallback(
    (fix: ArrivalLocationFix | null) => {
      if (
        !arrivalPhase ||
        arrivalTargetLatitude == null ||
        arrivalTargetLongitude == null
      ) return;
      const detector = arrivalDetector.current;
      if (detector.key !== arrivalKey) {
        detector.key = arrivalKey;
        detector.state = emptyArrivalDetector();
      }
      if (!fix) {
        detector.state = emptyArrivalDetector();
        setArrivalResult(null);
        return;
      }
      if (detector.lastGpsTimestamp === fix.timestamp) return;
      detector.lastGpsTimestamp = fix.timestamp;
      const result = updateArrivalDetection(detector.state, fix, {
        lat: arrivalTargetLatitude,
        lng: arrivalTargetLongitude,
      });
      detector.state = result.state;
      setArrivalResult({ key: arrivalKey, result });
    },
    [
      arrivalKey,
      arrivalPhase,
      arrivalTargetLatitude,
      arrivalTargetLongitude,
    ],
  );
  const driverLocation = useDriverTripLocation({
    bookingId: booking?.id,
    driverId: booking?.driver_id,
    status: booking?.status,
    demoMode: walkthrough,
    onLocationFix: processGpsFix,
  });
  const mapLocation = walkthrough
    ? demoLocationForTarget
    : driverLocation.currentLocation;
  const routeDestinationValid = Boolean(routeDestination);
  const routeResult = useTrackingRoute(
      mapLocation,
    routeDestinationValid ? routeDestination : null,
    `${bookingId ?? ''}:${destinationPhase ? 'hospital' : 'pickup'}:${routeRetry}`,
    Boolean(routeDestinationValid && mapLocation),
  );

  const simulateArrival = () => {
    if (!walkthrough || !arrivalPhase || !arrivalTarget) return;
    if (arrivalDetector.current.key !== arrivalKey) {
      arrivalDetector.current.key = arrivalKey;
      arrivalDetector.current.state = emptyArrivalDetector();
    }
    const samples = createSimulatedArrivalFixes(arrivalTarget);
    let result: ArrivalDetectionResult | null = null;
    const now = Date.now();
    for (const sample of samples) {
      result = updateArrivalDetection(
        arrivalDetector.current.state,
        sample,
        arrivalTarget,
        now,
      );
      arrivalDetector.current.state = result.state;
    }
    const finalFix = samples[samples.length - 1];
    if (finalFix) setDemoLocation({ key: arrivalKey, fix: finalFix });
    if (result) setArrivalResult({ key: arrivalKey, result });
  };

  const arrivalMessage = (() => {
    if (!arrivalPhase) return null;
    if (!arrivalTarget) {
      return `${arrivalTargetName} coordinates are unavailable; arrival assistance cannot run.`;
    }
    if (!walkthrough && driverLocation.state === 'permission-denied') {
      return 'Allow foreground location access to check arrival.';
    }
    if (!walkthrough && driverLocation.state === 'unavailable') {
      return 'Turn on device location to check arrival.';
    }
    if (!walkthrough && driverLocation.state === 'stale') {
      return 'GPS fix is stale; waiting for a fresh location.';
    }
    if (!walkthrough && driverLocation.state === 'error') {
      return 'Location is temporarily unavailable; arrival cannot be checked.';
    }
    if (arrivalResultForTarget?.reached) {
      return `${arrivalTargetName} location reached — confirm arrival${
        walkthrough ? ' (simulated)' : ''
      }`;
    }
    if (walkthrough) return 'Simulated location has not reached the destination.';
    const fix = driverLocation.currentFix;
    if (fix && !isUsableArrivalFix(fix)) {
      return 'GPS accuracy is insufficient or the location fix is stale.';
    }
    if (arrivalResultForTarget?.valid && arrivalResultForTarget.distanceMeters != null) {
      return `${Math.round(arrivalResultForTarget.distanceMeters)} m from ${arrivalTargetName.toLowerCase()}.`;
    }
    return 'Waiting for an accurate GPS fix to check arrival.';
  })();

  useEffect(() => {
    loadBooking();
    // Load exactly once on mount — loadBooking reads fresh state internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (walkthrough || !bookingId) return;
    let active = true;
    const refreshStatus = async () => {
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const latest = await bookingsService.getById(bookingId);
        if (active && latest) {
          if (latest.driver_id !== assignedDriverId.current) {
            setBooking(null);
            setError('This trip is no longer assigned to your driver account.');
            return;
          }
          const latestPhase = phaseFromBookingStatus(latest.status);
          if (!latestPhase) {
            setBooking(null);
            setError('This trip is no longer active.');
            return;
          }
          setBooking(latest);
          setPhase((current) =>
            current === 'hospital-arrived' && latestPhase === 'started'
              ? current
              : latestPhase,
          );
        }
      } catch {
        // The foreground GPS hook reports upload failures without interrupting
        // the active driver workflow.
      } finally {
        refreshInFlight.current = false;
      }
    };
    const timer = setInterval(() => void refreshStatus(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [bookingId, walkthrough]);

  async function loadBooking() {
    setLoading(true);
    setError(null);
    try {
      if (walkthrough) {
        // Sample trip from the isolated in-memory walkthrough store.
        const trip = useDriverDemoStore.getState().activeTrip;
        if (!bookingId || !trip || trip.id !== bookingId) {
          setError(
            'This trip is no longer active. Return to Requests to choose another booking.',
          );
          return;
        }
        setBooking({
          id: trip.id,
          user_id: 'walkthrough-patient',
          driver_id: 'demo-driver-local',
          category: trip.category,
          pickup_address: trip.pickupAddress,
          pickup_lat: trip.pickupLat,
          pickup_lng: trip.pickupLng,
          destination_address: trip.destinationAddress,
          dest_lat: trip.destLat,
          dest_lng: trip.destLng,
          status: 'assigned',
          patient_name: trip.patientName,
          patient_age: trip.patientAge,
          patient_condition: trip.patientCondition,
          emergency_level: trip.emergencyLevel,
          estimated_fare: trip.estimatedFare,
          distance_km: trip.distanceKm,
          duration_min: trip.durationMin,
          payment_method: 'cash',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setPhase(trip.phase);
        return;
      }

      if (!bookingId) {
        setError('Trip not found.');
        return;
      }

      const record = await bookingsService.getById(bookingId);
      if (!record) {
        setError('Trip not found.');
        return;
      }
      const userId = useAuthStore.getState().user?.id;
      const driver = userId ? await driversService.getByUserId(userId) : null;
      if (!driver || record.driver_id !== driver.id) {
        setError('This trip is not assigned to your driver account.');
        return;
      }
      const recordPhase = phaseFromBookingStatus(record.status);
      if (!recordPhase) {
        setError('This trip is no longer active.');
        return;
      }
      assignedDriverId.current = driver.id;
      setBooking(record);
      // Resume the phase display from the stored status.
      setPhase(recordPhase);
    } catch {
      setError('Failed to load trip details.');
    } finally {
      setLoading(false);
    }
  }

  const openMaps = async (lat?: number | null, lng?: number | null) => {
    const url =
      lat != null && lng != null ? buildGoogleMapsDirectionsUrl(lat, lng) : null;
    if (!url) {
      Alert.alert('Destination unavailable', 'Valid destination coordinates are not available.');
      return;
    }
    setNavigating(true);
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Unable to open Maps', 'Please try again or use another navigation app.');
    } finally {
      setNavigating(false);
    }
  };

  const persistPhase = async (status: Booking['status'], next: TripPhase) => {
    if (updating || !canAdvanceDriverTripPhase(phase, next)) return;
    if (walkthrough) {
      // Local, in-memory phase change with a duplicate-tap guard.
      setUpdating(true);
      useDriverDemoStore.getState().setPhase(next);
      setPhase(next);
      setUpdating(false);
      return;
    }
    if (!booking) {
      Alert.alert('Trip unavailable', 'Reload the trip before changing its status.');
      return;
    }
    setUpdating(true);
    try {
      const latest = await bookingsService.getById(booking.id);
      const allowedCurrentStatuses =
        phase === 'pickup' ? ['assigned', 'arriving'] : [booking.status];
      if (
        !latest ||
        latest.driver_id !== booking.driver_id ||
        latest.status !== booking.status ||
        !allowedCurrentStatuses.includes(latest.status)
      ) {
        if (latest && latest.driver_id === assignedDriverId.current) {
          const latestPhase = phaseFromBookingStatus(latest.status);
          if (latestPhase) {
            setBooking(latest);
            setPhase(latestPhase);
          } else {
            setBooking(null);
            setError('This trip is no longer active.');
          }
        } else if (latest) {
          setBooking(null);
          setError('This trip is no longer assigned to your driver account.');
        }
        Alert.alert('Trip changed', 'Trip details changed. Review the latest status before continuing.');
        return;
      }
      await bookingsService.updateStatus(booking.id, status);
      setBooking((current) => current ? { ...current, status } : current);
      setPhase(next);
    } catch {
      Alert.alert('Update Failed', 'Could not update the trip status. Check your connection and try again.');
    } finally {
      setUpdating(false);
    }
  };

  const handleArrived = () => {
    void persistPhase('arrived', 'arrived');
  };

  const handleStartTrip = () => {
    void persistPhase('started', 'started');
  };

  const handleArrivedAtHospital = () => {
    if (updating || !canAdvanceDriverTripPhase(phase, 'hospital-arrived')) return;
    setPhase('hospital-arrived');
    if (walkthrough) useDriverDemoStore.getState().setPhase('hospital-arrived');
  };

  const handleCompleteTrip = async () => {
    if (phase !== 'hospital-arrived' || updating) return;
    if (walkthrough) {
      setUpdating(true);
      setPhase('completed');
      useDriverDemoStore.getState().completeActiveTrip();
      setUpdating(false);
      Alert.alert('Trip Completed', 'The trip is complete.', [
        { text: 'OK', onPress: () => navigation.navigate('DriverHome') },
      ]);
      return;
    }

    if (booking) {
      setUpdating(true);
      try {
        const latest = await bookingsService.getById(booking.id);
        if (
          !latest ||
          latest.driver_id !== booking.driver_id ||
          latest.status !== 'started'
        ) {
          if (latest && latest.driver_id === assignedDriverId.current) {
            const latestPhase = phaseFromBookingStatus(latest.status);
            if (latestPhase) {
              setBooking(latest);
              setPhase(latestPhase);
            } else {
              setBooking(null);
              setError('This trip is no longer active.');
            }
          } else if (latest) {
            setBooking(null);
            setError('This trip is no longer assigned to your driver account.');
          }
          Alert.alert('Trip changed', 'Trip details changed. Review the latest status before completing.');
          return;
        }
        await bookingsService.updateStatus(booking.id, 'completed');
        setBooking((current) => current ? { ...current, status: 'completed' } : current);
        setPhase('completed');
        const recordedFare =
          booking.final_fare != null && Number.isFinite(Number(booking.final_fare))
            ? ` Recorded fare: NPR ${Number(booking.final_fare).toLocaleString('en-IN')}.`
            : '';
        Alert.alert(
          'Trip Completed',
          `Trip completed.${recordedFare}`,
          [{ text: 'OK', onPress: () => navigation.navigate('DriverHome') }]
        );
      } catch {
        Alert.alert('Update Failed', 'Could not mark the trip as completed. Check your connection and try again.');
      } finally {
        setUpdating(false);
      }
    }
  };

  const handleCallPatient = () => {
    if (walkthrough) {
      Alert.alert(
        'No phone number',
        'A patient contact number was not recorded for this booking.',
      );
      return;
    }
    const phone = booking?.patient_phone?.trim();
    if (!phone) {
      Alert.alert(
        'No phone number',
        'A patient contact number was not recorded for this booking.',
      );
      return;
    }
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Call failed', 'Could not open the phone app on this device.');
    });
  };

  const getPhaseProgress = () => {
    switch (phase) {
      case 'pickup':
        return 0.25;
      case 'arrived':
        return 0.5;
      case 'started':
        return 0.6;
      case 'hospital-arrived':
        return 0.8;
      case 'completed':
        return 1;
    }
  };

  const getPhaseLabel = () => {
    switch (phase) {
      case 'pickup':
        return 'Heading to Pickup';
      case 'arrived':
        return 'Arrived at Pickup';
      case 'started':
        return 'Trip In Progress';
      case 'hospital-arrived':
        return 'Arrived at Hospital';
      case 'completed':
        return 'Trip Completed';
    }
  };

  const renderActionButton = () => {
    switch (phase) {
      case 'pickup':
        return (
          <View style={styles.actionColumn}>
            <Button
              title="Open in Google Maps"
              variant="outline"
              fullWidth
              onPress={() =>
                openMaps(routeDestination?.lat, routeDestination?.lng)
              }
              disabled={!routeDestination}
              loading={navigating}
              style={styles.navigateButton}
            />
            <Button
              title="Arrived at Pickup"
              fullWidth
              onPress={handleArrived}
              loading={updating}
              disabled={updating}
              style={styles.primaryButton}
            />
          </View>
        );
      case 'arrived':
        return (
          <Button
            title="Patient Onboard"
            fullWidth
            size="lg"
            onPress={handleStartTrip}
            loading={updating}
            disabled={updating}
            style={styles.primaryButton}
          />
        );
      case 'started':
        return (
          <View style={styles.actionColumn}>
            <Button
              title="Open in Google Maps"
              variant="outline"
              fullWidth
              onPress={() => openMaps(routeDestination?.lat, routeDestination?.lng)}
              loading={navigating}
              disabled={!routeDestination}
              style={styles.navigateButton}
            />
            <Button
              title="Arrived at Hospital"
              fullWidth
              size="lg"
              onPress={handleArrivedAtHospital}
              loading={updating}
              disabled={updating}
              style={styles.primaryButton}
            />
          </View>
        );
      case 'hospital-arrived':
        return (
          <Button
            title="Complete Trip"
            fullWidth
            size="lg"
            onPress={handleCompleteTrip}
            loading={updating}
            disabled={updating}
            style={styles.primaryButton}
          />
        );
      case 'completed':
        return null;
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <DriverNavigationHeader title="Trip" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading trip details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <DriverNavigationHeader title="Trip" />
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Retry" variant="outline" onPress={loadBooking} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <DriverNavigationHeader title="Trip" />
      <View style={styles.mapContainer}>
        <MapCanvas
          pickup={booking ? { lat: booking.pickup_lat, lng: booking.pickup_lng } : null}
          destination={destinationPhase ? routeDestination : null}
          pickupLabel="Pickup"
          destinationLabel={destinationPhase ? 'Hospital' : 'Pickup'}
          current={mapLocation}
          currentLabel="Your ambulance"
          route={routeResult.route?.coordinates}
          showSchematicRoute={false}
          caption={
            walkthrough
              ? demoLocation
                ? 'Simulated location — device GPS is not used in this walkthrough'
                : 'Local arrival simulation is available'
              : driverLocation.state === 'permission-denied'
              ? 'Allow location access to share your ambulance position'
              : driverLocation.state === 'unavailable'
                ? 'Turn on device location to share your position'
                : driverLocation.state === 'stale'
                  ? 'GPS fix is stale; waiting for a fresh position'
                  : !SECURE_TRIP_TRACKING_ENABLED
                    ? 'Live GPS sharing is disabled until the approved database policy is enabled'
                : driverLocation.state === 'error'
                  ? 'Location sharing is temporarily unavailable'
                  : driverLocation.state === 'sharing'
                    ? 'Sharing your real GPS while this trip is active'
                    : 'Waiting for a real GPS fix'
          }
        />
        <View style={styles.progressBarOverlay}>
          <View
            style={[styles.progressBar, { width: `${getPhaseProgress() * 100}%` }]}
          />
        </View>
      </View>

      {/* Bottom Content */}
      <View style={styles.bottomSheet}>
        <Text style={styles.phaseTitle}>{getPhaseLabel()}</Text>
        {arrivalMessage ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.arrivalStatus,
              arrivalResultForTarget?.reached && styles.arrivalStatusReached,
            ]}
          >
            {arrivalMessage}
          </Text>
        ) : null}
        {walkthrough && arrivalPhase ? (
          <Button
            title={`Simulate ${arrivalTargetName.toLowerCase()} arrival`}
            variant="outline"
            size="sm"
            onPress={simulateArrival}
            style={styles.simulateArrivalButton}
          />
        ) : null}
        {routeResult.route ? (
          <Text style={styles.routeSummary}>
            {routeResult.route.distanceKm.toFixed(1)} km · {routeResult.route.durationMinutes} min
          </Text>
        ) : routeResult.loading ? (
          <Text style={styles.routeSummary}>Finding a driving route…</Text>
        ) : routeResult.unavailable ? (
          <View style={styles.routeError}>
            <Text style={styles.routeSummary}>Driving route unavailable.</Text>
            <Button
              title="Retry"
              variant="outline"
              size="sm"
              onPress={() => setRouteRetry((value) => value + 1)}
            />
          </View>
        ) : null}

        {/* Trip Progress Indicator */}
        <View style={styles.progressIndicator}>
          <View style={styles.progressSteps}>
            {['Pickup', 'Arrived', 'Onboard', 'Hospital', 'Complete'].map((step, index) => {
              const phaseOrder: TripPhase[] = ['pickup', 'arrived', 'started', 'hospital-arrived', 'completed'];
              const isActive = phaseOrder.indexOf(phase) >= index;
              return (
                <View key={step} style={styles.progressStep}>
                  <View
                    style={[
                      styles.progressDot,
                      isActive && styles.progressDotActive,
                    ]}
                  >
                    {isActive && <Text style={styles.progressCheck}>✓</Text>}
                  </View>
                  <Text
                    style={[
                      styles.progressLabel,
                      isActive && styles.progressLabelActive,
                    ]}
                  >
                    {step}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Patient Info Card */}
        <Card elevation="sm" style={styles.patientCard}>
          <View style={styles.patientHeader}>
            <Avatar name={booking?.patient_name ?? 'Patient'} size="md" />
            <View style={styles.patientInfo}>
              <Text style={styles.patientName}>
                {booking?.patient_name ?? 'Unknown'}
              </Text>
              <Text style={styles.patientDetail}>
                Age: {booking?.patient_age ?? '?'} years
              </Text>
              <Text style={styles.patientCondition}>
                {booking?.patient_condition ?? 'No condition noted'}
              </Text>
            </View>
            <Badge
              label={booking?.emergency_level.toUpperCase() ?? 'MEDIUM'}
              variant={
                booking?.emergency_level === 'high'
                  ? 'error'
                  : booking?.emergency_level === 'medium'
                  ? 'warning'
                  : 'success'
              }
            />
          </View>
          <TouchableOpacity onPress={handleCallPatient} style={styles.callButton}>
            <Text style={styles.callIcon}>📞</Text>
            <Text style={styles.callText}>Call Patient</Text>
          </TouchableOpacity>
        </Card>

        {/* Pickup & Destination */}
        <Card elevation="sm" style={styles.locationCard}>
          <View style={styles.locationRow}>
            <View style={[styles.locationDot, { backgroundColor: colors.success }]} />
            <View style={styles.locationInfo}>
              <Text style={styles.locationLabel}>Pickup</Text>
              <Text style={styles.locationAddress}>{booking?.pickup_address}</Text>
            </View>
          </View>
          <View style={styles.locationLine} />
          <View style={styles.locationRow}>
            <View style={[styles.locationDot, { backgroundColor: colors.primary }]} />
            <View style={styles.locationInfo}>
              <Text style={styles.locationLabel}>Destination</Text>
              <Text style={styles.locationAddress}>{booking?.destination_address}</Text>
            </View>
          </View>
        </Card>

        {/* Trip Details */}
        <View style={styles.tripDetails}>
          <View style={styles.tripDetailItem}>
            <Text style={styles.tripDetailValue}>{booking?.distance_km ?? 0} km</Text>
            <Text style={styles.tripDetailLabel}>Distance</Text>
          </View>
          <View style={styles.tripDetailItem}>
            <Text style={styles.tripDetailValue}>{booking?.duration_min ?? 0} min</Text>
            <Text style={styles.tripDetailLabel}>Duration</Text>
          </View>
          <View style={styles.tripDetailItem}>
            <Text style={styles.tripDetailValue}>NPR {booking?.estimated_fare ?? 0}</Text>
            <Text style={styles.tripDetailLabel}>Fare</Text>
          </View>
        </View>

        {/* Action Buttons */}
        {renderActionButton()}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  mapContainer: {
    flex: 1,
    backgroundColor: '#E8EAF6',
  },
  progressBarOverlay: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  phaseTitle: {
    ...typography.h3,
    marginBottom: spacing.md,
  },
  arrivalStatus: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  arrivalStatusReached: {
    color: colors.success,
    fontWeight: '700',
  },
  simulateArrivalButton: {
    marginBottom: spacing.sm,
  },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    ...shadows.lg,
  },
  routeSummary: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  routeError: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressIndicator: {
    marginBottom: spacing.lg,
  },
  progressSteps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressStep: {
    alignItems: 'center',
    flex: 1,
  },
  progressDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  progressDotActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  progressCheck: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  progressLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  progressLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  patientCard: {
    marginBottom: spacing.md,
  },
  patientHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  patientInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  patientName: {
    ...typography.h4,
    color: colors.text,
  },
  patientDetail: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  patientCondition: {
    ...typography.bodySmall,
    color: colors.text,
    marginTop: 2,
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.greenLight,
    gap: spacing.sm,
  },
  callIcon: {
    fontSize: 16,
  },
  callText: {
    ...typography.bodySmall,
    color: colors.success,
    fontWeight: '700',
  },
  locationCard: {
    marginBottom: spacing.md,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  locationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    marginRight: spacing.md,
  },
  locationInfo: {
    flex: 1,
  },
  locationLabel: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  locationAddress: {
    ...typography.bodySmall,
    color: colors.text,
    fontWeight: '500',
  },
  locationLine: {
    width: 2,
    height: 16,
    backgroundColor: colors.border,
    marginLeft: 4,
    marginVertical: 2,
  },
  tripDetails: {
    flexDirection: 'row',
    backgroundColor: colors.input,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  tripDetailItem: {
    flex: 1,
    alignItems: 'center',
  },
  tripDetailValue: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  tripDetailLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actionColumn: {
    gap: spacing.md,
  },
  navigateButton: {
    borderColor: colors.info,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
});

export default DriverTripScreen;
