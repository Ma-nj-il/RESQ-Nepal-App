import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, EmptyState, Header, Input } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { savedPlacesService } from '../../services/database/savedPlaces';
import { isSupabaseConfigured } from '../../services/database/client';
import { locationService } from '../../services/location/locationService';
import { useAuthStore } from '../../store/authStore';
import { useBookingStore } from '../../store/bookingStore';
import { isDemoMode } from '../../utils/demoMode';
import { SavedPlace } from '../../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TYPE_OPTIONS: { value: SavedPlace['type']; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'work', label: 'Work' },
  { value: 'other', label: 'Other' },
];

const TYPE_LABELS: Record<SavedPlace['type'], string> = {
  home: 'Home',
  work: 'Work',
  other: 'Other',
};

/**
 * Saved places live in the real `saved_places` table for the signed-in user.
 * Demo mode never reads or writes the table — the screen says so instead of
 * pretending. Saved places are anchored to a captured location so picks are
 * exact; the address is resolved on the device.
 */
const SavedPlacesScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const { setPickup, setDestination } = useBookingStore();
  const userId = user?.id;

  // Demo walkthroughs and non-database sessions never touch the table.
  const dbAvailable = Boolean(
    isSupabaseConfigured && userId && !isDemoMode() && UUID_RE.test(userId || ''),
  );

  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<SavedPlace['type']>('home');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ name?: string; location?: string }>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!dbAvailable || !userId) {
      setPlaces([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const list = await savedPlacesService.getByUser(userId);
      setPlaces(list);
    } catch {
      setLoadError('Could not load your saved places. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [dbAvailable, userId]);

  useEffect(() => {
    // Deferred like the other loaders in the app so the effect never sets
    // state synchronously during the same render pass.
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setName('');
    setType('home');
    setAddress('');
    setLat(null);
    setLng(null);
    setErrors({});
    setNotice(null);
    setFormVisible(false);
  }, []);

  const startAdd = useCallback(() => {
    resetForm();
    setFormVisible(true);
  }, [resetForm]);

  const startEdit = useCallback((place: SavedPlace) => {
    setEditingId(place.id);
    setName(place.name);
    setType(place.type);
    setAddress(place.address);
    setLat(place.lat);
    setLng(place.lng);
    setErrors({});
    setNotice(null);
    setFormVisible(true);
  }, []);

  const captureLocation = useCallback(async () => {
    setNotice(null);
    setCapturing(true);
    try {
      const granted = await locationService.requestPermission();
      if (!granted) {
        setNotice('Location permission was not granted. A saved place needs a location.');
        return;
      }
      const loc = await locationService.getCurrentLocation();
      if (!loc) {
        setNotice('Could not read the device location. Try again somewhere with a clearer signal.');
        return;
      }
      const resolved = await locationService.reverseGeocode(loc.lat, loc.lng);
      setLat(loc.lat);
      setLng(loc.lng);
      setAddress(resolved);
    } catch {
      setNotice('Could not read the device location. Try again.');
    } finally {
      setCapturing(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const nextErrors: { name?: string; location?: string } = {};
    if (!name.trim()) nextErrors.name = 'Give this place a name, for example “Home”.';
    if (lat === null || lng === null || !address) {
      nextErrors.location = 'Capture the location first so pickups are exact.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    if (!dbAvailable || !userId) {
      Alert.alert(
        'Demo mode',
        'Nothing is saved in demo mode. Sign in with a real phone number to save places to your account.',
      );
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        const updated = await savedPlacesService.update(editingId, {
          name: name.trim(),
          type,
          address,
          lat: lat as number,
          lng: lng as number,
        });
        setPlaces((current) => current.map((place) => (place.id === updated.id ? updated : place)));
      } else {
        const created = await savedPlacesService.create({
          user_id: userId,
          name: name.trim(),
          type,
          address,
          lat: lat as number,
          lng: lng as number,
        });
        setPlaces((current) => [...current, created]);
      }
      resetForm();
    } catch {
      Alert.alert('Could not save', 'The place was not saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [address, dbAvailable, editingId, lat, lng, name, resetForm, type, userId]);

  const confirmRemove = useCallback(
    (place: SavedPlace) => {
      Alert.alert('Remove saved place', `Remove “${place.name}” from your saved places?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!dbAvailable) {
              Alert.alert('Demo mode', 'Nothing was removed — demo mode never changes your account.');
              return;
            }
            try {
              await savedPlacesService.remove(place.id);
              setPlaces((current) => current.filter((item) => item.id !== place.id));
            } catch {
              Alert.alert('Could not remove', 'The place was not removed. Try again.');
            }
          },
        },
      ]);
    },
    [dbAvailable],
  );

  const setAsPickup = useCallback(
    (place: SavedPlace) => {
      setPickup({ address: place.address, lat: place.lat, lng: place.lng, source: 'saved' });
      navigation.navigate('Home');
    },
    [navigation, setPickup],
  );

  const setAsDestination = useCallback(
    (place: SavedPlace) => {
      setDestination({ address: place.address, lat: place.lat, lng: place.lng, source: 'saved' });
      navigation.navigate('Home');
    },
    [navigation, setDestination],
  );

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Saved Places" showBack onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          {dbAvailable
            ? 'Saved to your RESQ Nepal account. Confirm the details before booking — addresses and circumstances can change.'
            : 'Demo mode — saved places need a real signed-in account. Nothing is written during this walkthrough.'}
        </Text>

        {loading ? (
          <ActivityIndicator style={styles.loader} size="small" color={colors.primary} />
        ) : loadError ? (
          <Card elevation="sm" style={styles.errorCard}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Button
              title="Retry"
              variant="outline"
              size="sm"
              onPress={load}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ) : places.length === 0 && !formVisible ? (
          <EmptyState
            icon="📍"
            title="No saved places yet"
            message={
              dbAvailable
                ? 'Save Home, Work or another frequent pickup so booking takes fewer steps.'
                : 'With a real sign-in you can save Home, Work or another frequent pickup here.'
            }
            action={<Button title="Save a place" onPress={startAdd} style={{ marginTop: spacing.lg }} />}
          />
        ) : (
          <>
            {places.map((place) => (
              <Card key={place.id} elevation="sm" style={styles.placeCard}>
                <View style={styles.placeTop}>
                  <View style={styles.placeBadge}>
                    <Text style={styles.placeBadgeText}>{TYPE_LABELS[place.type].toUpperCase()}</Text>
                  </View>
                  <Text style={styles.placeName}>{place.name}</Text>
                </View>
                <Text style={styles.placeAddress}>{place.address}</Text>
                <View style={styles.actionsRow}>
                  <Button
                    title="Set pickup"
                    variant="outline"
                    size="sm"
                    onPress={() => setAsPickup(place)}
                    style={styles.actionButton}
                  />
                  <Button
                    title="Set destination"
                    variant="outline"
                    size="sm"
                    onPress={() => setAsDestination(place)}
                    style={styles.actionButton}
                  />
                </View>
                <View style={styles.actionsRow}>
                  <Button
                    title="Edit"
                    variant="ghost"
                    size="sm"
                    onPress={() => startEdit(place)}
                    style={styles.actionButton}
                  />
                  <Button
                    title="Remove"
                    variant="ghost"
                    size="sm"
                    onPress={() => confirmRemove(place)}
                    style={styles.actionButton}
                  />
                </View>
              </Card>
            ))}
            {!formVisible && (
              <Button
                title="Save another place"
                variant="outline"
                onPress={startAdd}
                style={{ marginTop: spacing.sm }}
              />
            )}
          </>
        )}

        {formVisible && (
          <Card elevation="sm" style={styles.formCard}>
            <Text style={styles.formTitle}>{editingId ? 'Edit place' : 'New saved place'}</Text>

            <Input
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Home, Work, Grandmother's house…"
              error={errors.name}
            />

            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.chipsRow}>
              {TYPE_OPTIONS.map((option) => {
                const selected = type === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.chip, selected && styles.chipActive]}
                    onPress={() => setType(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Type ${option.label}`}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Location</Text>
            {lat !== null && lng !== null ? (
              <View style={styles.capturedBox}>
                <Text style={styles.capturedAddress}>{address}</Text>
                <Text style={styles.capturedCoords}>
                  {lat.toFixed(5)}, {lng.toFixed(5)}
                </Text>
              </View>
            ) : (
              <Text style={styles.captureHint}>
                No location captured yet. Stand at the place you are saving and tap the button below.
              </Text>
            )}
            <Button
              title={
                capturing
                  ? 'Reading location…'
                  : lat !== null
                    ? 'Recapture location'
                    : 'Use my current location'
              }
              variant="outline"
              size="sm"
              loading={capturing}
              onPress={captureLocation}
              style={{ marginTop: spacing.sm }}
            />
            {errors.location && <Text style={styles.errorHint}>{errors.location}</Text>}
            {notice && <Text style={styles.noticeText}>{notice}</Text>}

            <View style={styles.formButtons}>
              <Button title="Cancel" variant="ghost" onPress={resetForm} style={styles.actionButton} />
              <Button
                title={editingId ? 'Save changes' : 'Save place'}
                loading={saving}
                onPress={handleSave}
                style={styles.actionButton}
              />
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default SavedPlacesScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.lg },
  loader: { marginTop: spacing.xxl },
  errorCard: { padding: spacing.lg },
  errorText: { ...typography.bodySmall, color: colors.textSecondary },
  placeCard: { padding: spacing.lg, marginBottom: spacing.md },
  placeTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  placeBadge: {
    backgroundColor: colors.redLight,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  placeBadgeText: { ...typography.caption, color: colors.primaryDark, fontWeight: '700' },
  placeName: { ...typography.body, fontWeight: '600', color: colors.text, flex: 1 },
  placeAddress: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.xs },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionButton: { flex: 1 },
  formCard: { padding: spacing.lg, marginTop: spacing.sm },
  formTitle: { ...typography.h4, color: colors.text, marginBottom: spacing.md },
  fieldLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  chipsRow: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.redLight },
  chipText: { ...typography.bodySmall, color: colors.textSecondary },
  chipTextActive: { color: colors.primaryDark, fontWeight: '600' },
  capturedBox: {
    backgroundColor: colors.input,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  capturedAddress: { ...typography.bodySmall, color: colors.text },
  capturedCoords: { ...typography.caption, color: colors.textTertiary, marginTop: 2 },
  captureHint: { ...typography.bodySmall, color: colors.textSecondary },
  errorHint: { ...typography.caption, color: colors.error, marginTop: spacing.sm },
  noticeText: { ...typography.caption, color: colors.warning, marginTop: spacing.sm },
  formButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
});
