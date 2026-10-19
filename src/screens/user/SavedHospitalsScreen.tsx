import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Header, Input } from '../../components/ui';
import { colors, spacing, typography } from '../../constants/theme';
import { hospitalsService } from '../../services/database/hospitals';
import {
  SavedHospital,
  savedHospitalsService,
} from '../../services/hospitals/savedHospitalsService';
import { useBookingStore } from '../../store/bookingStore';
import { Hospital } from '../../types';

/**
 * Two honest layers:
 * - the search reads the real public hospital directory (admin-managed rows),
 * - the starred list is a device-local snapshot with a clear note that
 *   details can change. No hospital data is ever fabricated here.
 */
const SavedHospitalsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { setDestination } = useBookingStore();

  const [saved, setSaved] = useState<SavedHospital[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Hospital[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const searchIdRef = useRef(0);

  const loadSaved = useCallback(async () => {
    setLoadingSaved(true);
    setSaved(await savedHospitalsService.list());
    setLoadingSaved(false);
  }, []);

  useEffect(() => {
    // Deferred like the other loaders in the app so the effect never sets
    // state synchronously during the same render pass.
    const timer = setTimeout(() => {
      loadSaved();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadSaved]);

  const runSearch = useCallback(async (text: string) => {
    const id = ++searchIdRef.current;
    setSearching(true);
    setSearchError(null);
    try {
      const found = await hospitalsService.search(text);
      if (searchIdRef.current !== id) return; // A newer search started.
      setResults(found);
      setHasSearched(true);
    } catch {
      if (searchIdRef.current !== id) return;
      setSearchError('Search failed. Check your connection and try again.');
    } finally {
      if (searchIdRef.current === id) setSearching(false);
    }
  }, []);

  // Debounce so the directory is not hit on every keystroke.
  useEffect(() => {
    const text = query.trim();
    const timer = setTimeout(
      () => {
        if (!text) {
          setResults([]);
          setSearchError(null);
          setHasSearched(false);
          return;
        }
        runSearch(text);
      },
      text ? 350 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const savedIds = useMemo(() => new Set(saved.map((item) => item.id)), [saved]);

  const toggleSave = useCallback(
    async (hospital: Hospital) => {
      try {
        if (savedIds.has(hospital.id)) {
          setSaved(await savedHospitalsService.remove(hospital.id));
        } else {
          setSaved(await savedHospitalsService.save(hospital));
        }
      } catch (error) {
        Alert.alert(
          'Could not save hospital',
          error instanceof Error ? error.message : 'Please try again.',
        );
      }
    },
    [savedIds],
  );

  const confirmRemove = useCallback((hospital: SavedHospital) => {
    Alert.alert('Remove saved hospital', `Remove “${hospital.name}” from this phone?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setSaved(await savedHospitalsService.remove(hospital.id));
        },
      },
    ]);
  }, []);

  const setAsDestination = useCallback(
    (hospital: { name: string; address: string; lat: number | null; lng: number | null }) => {
      setDestination({
        address: [hospital.name, hospital.address].filter(Boolean).join(', '),
        lat: hospital.lat,
        lng: hospital.lng,
        source: 'search',
      });
      navigation.navigate('Home');
    },
    [navigation, setDestination],
  );

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Saved Hospitals" showBack onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Saved to this phone only. Hospital details come from the public directory and can
          change — confirm before travelling.
        </Text>

        <Text style={styles.sectionTitle}>Saved on this phone</Text>
        {loadingSaved ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : saved.length === 0 ? (
          <Text style={styles.emptyLine}>
            No saved hospitals yet — search below and tap Save.
          </Text>
        ) : (
          saved.map((hospital) => (
            <Card key={hospital.id} elevation="sm" style={styles.resultCard}>
              <Text style={styles.resultName}>{hospital.name}</Text>
              <Text style={styles.resultMeta}>
                {hospital.address}
                {hospital.phone ? ` · ${hospital.phone}` : ''}
              </Text>
              <View style={styles.actionsRow}>
                <Button
                  title="Set destination"
                  size="sm"
                  onPress={() => setAsDestination(hospital)}
                  style={styles.actionButton}
                />
                <Button
                  title="Remove"
                  variant="ghost"
                  size="sm"
                  onPress={() => confirmRemove(hospital)}
                  style={styles.actionButton}
                />
              </View>
            </Card>
          ))
        )}

        <Text style={styles.sectionTitle}>Search the hospital directory</Text>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search by hospital name or address"
          autoCorrect={false}
          autoCapitalize="none"
        />

        {searching && <ActivityIndicator style={styles.loader} size="small" color={colors.primary} />}

        {!searching && searchError && (
          <Card elevation="sm" style={styles.errorCard}>
            <Text style={styles.errorText}>{searchError}</Text>
            <Button
              title="Retry"
              variant="outline"
              size="sm"
              onPress={() => runSearch(query.trim())}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        )}

        {!searching && !searchError && hasSearched && results.length === 0 && (
          <Text style={styles.emptyLine}>
            No hospitals match “{query.trim()}”. Try a different name or locality.
          </Text>
        )}

        {!searching &&
          !searchError &&
          results.map((hospital) => {
            const isSaved = savedIds.has(hospital.id);
            return (
              <Card key={hospital.id} elevation="sm" style={styles.resultCard}>
                <Text style={styles.resultName}>{hospital.name}</Text>
                <Text style={styles.resultMeta}>
                  {hospital.address}
                  {hospital.phone ? ` · ${hospital.phone}` : ''}
                </Text>
                <View style={styles.actionsRow}>
                  <Button
                    title={isSaved ? 'Saved ✓' : 'Save'}
                    variant="outline"
                    size="sm"
                    onPress={() => toggleSave(hospital)}
                    style={styles.actionButton}
                  />
                  <Button
                    title="Set destination"
                    size="sm"
                    onPress={() => setAsDestination(hospital)}
                    style={styles.actionButton}
                  />
                </View>
              </Card>
            );
          })}
      </ScrollView>
    </SafeAreaView>
  );
};

export default SavedHospitalsScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.lg },
  sectionTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  emptyLine: { ...typography.bodySmall, color: colors.textSecondary },
  resultCard: { padding: spacing.lg, marginBottom: spacing.md },
  resultName: { ...typography.body, fontWeight: '600', color: colors.text },
  resultMeta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.xs },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionButton: { flex: 1 },
  loader: { marginTop: spacing.md },
  errorCard: { padding: spacing.lg },
  errorText: { ...typography.bodySmall, color: colors.textSecondary },
});
