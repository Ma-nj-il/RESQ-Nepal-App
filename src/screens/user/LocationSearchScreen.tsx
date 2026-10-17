import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { Input, EmptyState } from '../../components/ui';
import { locationService } from '../../services/location/locationService';

interface SearchResult {
  id: string;
  name: string;
  address: string;
  distance: string;
  type: 'home' | 'work' | 'recent' | 'other';
}

const MOCK_RESULTS: SearchResult[] = [
  { id: '1', name: 'Home', address: 'Baneshwor, Kathmandu', distance: '0.5 km', type: 'home' },
  { id: '2', name: 'Work', address: 'Thapathali, Kathmandu', distance: '2.3 km', type: 'work' },
  { id: '3', name: 'Grande International Hospital', address: 'Dhapasi, Kathmandu', distance: '3.1 km', type: 'other' },
  { id: '4', name: 'Teaching Hospital', address: 'Maharajgunj, Kathmandu', distance: '4.0 km', type: 'other' },
  { id: '5', name: 'Norvic Hospital', address: 'Thapathali, Kathmandu', distance: '2.8 km', type: 'other' },
];

const LocationSearchScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const mode = route.params?.mode || 'pickup';

  // Pre-fill from route params on first render (editing an existing value).
  const [pickup, setPickup] = useState(
    mode === 'pickup' ? route.params?.currentPickup ?? '' : '',
  );
  const [destination, setDestination] = useState(
    mode === 'destination' ? route.params?.currentDestination ?? '' : '',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    setHasSearched(true);

    // Simulate search delay
    setTimeout(() => {
      const filtered = MOCK_RESULTS.filter(
        (r) =>
          r.name.toLowerCase().includes(query.toLowerCase()) ||
          r.address.toLowerCase().includes(query.toLowerCase())
      );
      setResults(filtered);
      setIsLoading(false);
    }, 500);
  };

  const handleSelectResult = (result: SearchResult) => {
    if (mode === 'pickup') {
      navigation.navigate('AmbulanceList', {
        pickupAddress: result.name,
        pickupFullAddress: result.address,
      });
    } else {
      navigation.navigate('AmbulanceList', {
        destinationAddress: result.name,
        destinationFullAddress: result.address,
      });
    }
  };

  const handleUseCurrentLocation = async () => {
    setIsLoading(true);
    try {
      const hasPermission = await locationService.requestPermission();
      if (hasPermission) {
        const loc = await locationService.getCurrentLocation();
        if (loc) {
          const address = await locationService.reverseGeocode(loc.lat, loc.lng);
          if (mode === 'pickup') {
            navigation.navigate('AmbulanceList', {
              pickupAddress: 'Current Location',
              pickupFullAddress: address,
            });
          } else {
            navigation.navigate('AmbulanceList', {
              destinationAddress: 'Current Location',
              destinationFullAddress: address,
            });
          }
        }
      }
    } catch (error) {
      console.warn('Location error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'home': return '🏠';
      case 'work': return '💼';
      case 'recent': return '🕐';
      default: return '📍';
    }
  };

  const renderResult = ({ item }: { item: SearchResult }) => (
    <TouchableOpacity
      style={styles.resultItem}
      onPress={() => handleSelectResult(item)}
      activeOpacity={0.7}
    >
      <View style={styles.resultIcon}>
        <Text style={styles.resultEmoji}>{getTypeIcon(item.type)}</Text>
      </View>
      <View style={styles.resultContent}>
        <Text style={styles.resultName}>{item.name}</Text>
        <Text style={styles.resultAddress} numberOfLines={1}>{item.address}</Text>
      </View>
      <Text style={styles.resultDistance}>{item.distance}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Let&apos;s travel together!</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Input Fields */}
      <View style={styles.inputSection}>
        <View style={styles.inputRow}>
          <View style={[styles.dot, styles.dotGreen]} />
          <View style={styles.inputWrapper}>
            <Input
              placeholder="Pickup Location"
              value={pickup}
              onChangeText={setPickup}
            />
          </View>
        </View>
        <View style={styles.inputRow}>
          <View style={[styles.dot, styles.dotRed]} />
          <View style={styles.inputWrapper}>
            <Input
              placeholder="Destination"
              value={destination}
              onChangeText={setDestination}
            />
          </View>
        </View>
      </View>

      {/* Search Input */}
      <View style={styles.searchSection}>
        <Input
          placeholder="Search for a place..."
          value={searchQuery}
          onChangeText={handleSearch}
          icon={<Text style={styles.searchIcon}>🔍</Text>}
        />
      </View>

      {/* Use Current Location */}
      <TouchableOpacity style={styles.currentLocationButton} onPress={handleUseCurrentLocation}>
        <Text style={styles.currentLocationIcon}>📍</Text>
        <Text style={styles.currentLocationText}>Use my current location</Text>
      </TouchableOpacity>

      {/* Results */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      ) : hasSearched && results.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No results found"
          message="Try searching with a different location name"
        />
      ) : (
        <FlatList
          data={results}
          renderItem={renderResult}
          keyExtractor={(item) => item.id}
          style={styles.resultsList}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            results.length > 0 ? (
              <Text style={styles.resultsHeader}>
                {mode === 'pickup' ? 'Pickup' : 'Destination'} Locations
              </Text>
            ) : undefined
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
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
  inputSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotGreen: {
    backgroundColor: colors.success,
  },
  dotRed: {
    backgroundColor: colors.primary,
  },
  inputWrapper: {
    flex: 1,
  },
  searchSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  searchIcon: {
    fontSize: 16,
  },
  currentLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  currentLocationIcon: {
    fontSize: 18,
  },
  currentLocationText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  resultsList: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  resultsHeader: {
    ...typography.h4,
    color: colors.text,
    paddingVertical: spacing.md,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  resultEmoji: {
    fontSize: 20,
  },
  resultContent: {
    flex: 1,
  },
  resultName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  resultAddress: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  resultDistance: {
    ...typography.bodySmall,
    color: colors.textTertiary,
  },
});

export default LocationSearchScreen;
