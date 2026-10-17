import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { Badge, Button, EmptyState, Avatar, Card } from '../../components/ui';
import { ambulancesService } from '../../services/database/ambulances';
import { isSupabaseConfigured } from '../../services/database/client';
import { FARE_RATE_CARD } from '../../constants/fares';
import { Ambulance} from '../../types';

interface AmbulanceWithDriver extends Ambulance {
  driverName?: string;
  driverRating?: number;
  driverTotalRides?: number;
  price?: number;
  seatsAvailable?: number;
}

const MOCK_AMBULANCES: AmbulanceWithDriver[] = [
  {
    id: '1',
    driver_id: 'd1',
    category: 'basic',
    plate_number: 'BA 2 PA 1234',
    model: 'Toyota Hiace',
    color: 'White',
    status: 'available',
    equipment: ['Stretcher', 'Oxygen Cylinder', 'First Aid Kit'],
    hospital_affiliation: 'Grande Hospital',
    driverName: 'Ram Bahadur',
    driverRating: 4.8,
    driverTotalRides: 342,
    price: 1500,
    seatsAvailable: 3,
    created_at: '2024-01-01',
  },
  {
    id: '2',
    driver_id: 'd2',
    category: 'icu',
    plate_number: 'BA 5 PA 5678',
    model: 'Force Traveller',
    color: 'White',
    status: 'available',
    equipment: ['Stretcher', 'Oxygen Cylinder', 'Ventilator', 'Defibrillator', 'Cardiac Monitor'],
    hospital_affiliation: 'Norvic Hospital',
    driverName: 'Sita Sharma',
    driverRating: 4.9,
    driverTotalRides: 567,
    price: 3500,
    seatsAvailable: 2,
    created_at: '2024-01-01',
  },
  {
    id: '3',
    driver_id: 'd3',
    category: 'basic',
    plate_number: 'BA 1 PA 9012',
    model: 'Tata Winger',
    color: 'White',
    status: 'available',
    equipment: ['Stretcher', 'Oxygen Cylinder', 'First Aid Kit'],
    driverName: 'Hari Prasad',
    driverRating: 4.5,
    driverTotalRides: 189,
    price: 1200,
    seatsAvailable: 4,
    created_at: '2024-01-01',
  },
];

const AmbulanceListScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const [ambulances, setAmbulances] = useState<AmbulanceWithDriver[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingSampleData, setUsingSampleData] = useState(false);
  const [selectedDate, setSelectedDate] = useState('Today');
  const [passengers, setPassengers] = useState(1);
  const [pickupAddress, ] = useState(route.params?.pickupAddress || 'Current Location');
  const [destinationAddress, ] = useState(route.params?.destinationAddress || '');

  useEffect(() => {
    fetchAmbulances();
  }, []);

  async function fetchAmbulances() {
    setIsLoading(true);
    try {
      if (!isSupabaseConfigured) {
        // No database configured — clearly-labelled sample list.
        setUsingSampleData(true);
        setAmbulances(MOCK_AMBULANCES);
        return;
      }

      setUsingSampleData(false);
      const data = await ambulancesService.getAll();
      // Real rows are shown as stored. Driver identity and ratings are not
      // fabricated — the app cannot read other users' profiles under RLS,
      // so driver details are shared after assignment.
      const withRates = data.map((amb) => ({
        ...amb,
        price: FARE_RATE_CARD[amb.category]?.startingPrice,
      }));
      setAmbulances(withRates);
    } catch {
      setError('Could not load ambulances. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  const handleBookNow = (ambulance: AmbulanceWithDriver) => {
    navigation.navigate('AmbulanceDetails', { ambulance });
  };

  const handleEditRoute = () => {
    navigation.navigate('LocationSearch', { mode: 'pickup' });
  };

  const getEquipmentIcons = (equipment: string[]) => {
    const icons: string[] = [];
    equipment.forEach((item) => {
      const lower = item.toLowerCase();
      if (lower.includes('oxygen')) icons.push('🫁');
      else if (lower.includes('stretcher')) icons.push('🛏️');
      else if (lower.includes('ventilator')) icons.push('💨');
      else if (lower.includes('defibrillator')) icons.push('⚡');
      else if (lower.includes('cardiac') || lower.includes('monitor')) icons.push('💓');
      else if (lower.includes('first aid')) icons.push('🩹');
      else icons.push('🏥');
    });
    return icons;
  };

  const renderAmbulanceCard = ({ item }: { item: AmbulanceWithDriver }) => (
    <Card style={styles.ambulanceCard} elevation="md">
      <TouchableOpacity
        onPress={() => handleBookNow(item)}
        activeOpacity={0.8}
      >
        {/* Driver / Identity Row */}
        <View style={styles.driverRow}>
          {item.driverName ? (
            <>
              <Avatar name={item.driverName} size="md" />
              <View style={styles.driverInfo}>
                <Text style={styles.driverName}>{item.driverName}</Text>
                <View style={styles.ratingRow}>
                  <Text style={styles.star}>★</Text>
                  <Text style={styles.ratingText}>{item.driverRating}</Text>
                  <Text style={styles.ridesText}>({item.driverTotalRides} rides)</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              <Avatar name="🚑" size="md" />
              <View style={styles.driverInfo}>
                <Text style={styles.driverName}>Verified ambulance</Text>
                <Text style={styles.ridesText}>Driver details shared after assignment</Text>
              </View>
            </>
          )}
          <Badge
            label={item.category === 'icu' ? 'ICU' : 'Basic'}
            variant={item.category === 'icu' ? 'error' : 'success'}
          />
        </View>

        {/* Vehicle Info */}
        <View style={styles.vehicleRow}>
          <Text style={styles.vehicleModel}>{item.model}</Text>
          <Text style={styles.plateNumber}>{item.plate_number}</Text>
        </View>

        {/* Equipment */}
        <View style={styles.equipmentRow}>
          {getEquipmentIcons(item.equipment).map((icon, idx) => (
            <Text key={idx} style={styles.equipmentIcon}>{icon}</Text>
          ))}
          <Text style={styles.equipmentText}>
            {item.equipment.slice(0, 3).join(', ')}
            {item.equipment.length > 3 ? ` +${item.equipment.length - 3} more` : ''}
          </Text>
        </View>

        {/* Fare & Availability */}
        <View style={styles.priceRow}>
          <View>
            <Text style={styles.priceLabel}>Indicative fare</Text>
            <Text style={styles.price}>NPR {item.price?.toLocaleString()}</Text>
          </View>
          <View style={styles.seatsInfo}>
            <Text style={styles.seatsText}>
              {item.status === 'available' ? 'Available now' : item.status === 'busy' ? 'Currently on duty' : 'Offline'}
            </Text>
          </View>
        </View>

        {/* Book Now Button */}
        <Button
          title="Book Now"
          onPress={() => handleBookNow(item)}
          fullWidth
          style={styles.bookButton}
        />
      </TouchableOpacity>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Available Ambulances</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Route Summary */}
        <View style={styles.routeCard}>
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, styles.routeDotGreen]} />
            <Text style={styles.routeText} numberOfLines={1}>{pickupAddress}</Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, styles.routeDotRed]} />
            <Text style={styles.routeText} numberOfLines={1}>
              {destinationAddress || 'Add destination'}
            </Text>
          </View>
          <TouchableOpacity style={styles.editButton} onPress={handleEditRoute}>
            <Text style={styles.editText}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* Date & Passenger Selector */}
        <View style={styles.selectorRow}>
          <View style={styles.selectorCard}>
            <Text style={styles.selectorLabel}>Date</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {['Today', 'Tomorrow', 'Oct 18', 'Oct 19', 'Oct 20'].map((date) => (
                <TouchableOpacity
                  key={date}
                  style={[styles.dateChip, selectedDate === date && styles.dateChipActive]}
                  onPress={() => setSelectedDate(date)}
                >
                  <Text style={[styles.dateChipText, selectedDate === date && styles.dateChipTextActive]}>
                    {date}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={styles.selectorCard}>
            <Text style={styles.selectorLabel}>Passengers</Text>
            <View style={styles.passengerSelector}>
              <TouchableOpacity
                style={styles.passengerButton}
                onPress={() => setPassengers(Math.max(1, passengers - 1))}
              >
                <Text style={styles.passengerButtonText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.passengerCount}>{passengers}</Text>
              <TouchableOpacity
                style={styles.passengerButton}
                onPress={() => setPassengers(Math.min(6, passengers + 1))}
              >
                <Text style={styles.passengerButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Find Ambulances Button */}
        <Button
          title="Find Ambulances"
          onPress={fetchAmbulances}
          fullWidth
          size="lg"
          style={styles.findButton}
        />

        {/* Results */}
        {usingSampleData && (
          <View style={styles.sampleBanner}>
            <Text style={styles.sampleBannerText}>
              ⚠️ Sample mode — database not configured. Showing example ambulances.
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
            <Button title="Retry" variant="outline" size="sm" onPress={fetchAmbulances} />
          </View>
        )}

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Finding available ambulances...</Text>
          </View>
        ) : ambulances.length === 0 ? (
          <EmptyState
            icon="🚑"
            title="No ambulances available"
            message="Try again later or change your location"
          />
        ) : (
          <View style={styles.listContainer}>
            <Text style={styles.resultsCount}>
              {ambulances.length} ambulance{ambulances.length > 1 ? 's' : ''} available
            </Text>
            {ambulances.map((ambulance) => (
              <View key={ambulance.id}>
                {renderAmbulanceCard({ item: ambulance })}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
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
  routeCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.md,
    ...shadows.sm,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  routeDotGreen: {
    backgroundColor: colors.success,
  },
  routeDotRed: {
    backgroundColor: colors.primary,
  },
  routeLine: {
    width: 2,
    height: 16,
    backgroundColor: colors.border,
    marginLeft: 4,
    marginVertical: 2,
  },
  routeText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  editButton: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
  },
  editText: {
    ...typography.bodySmall,
    color: colors.primary,
    fontWeight: '600',
  },
  selectorRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.md,
  },
  selectorCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  selectorLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  dateChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.input,
    marginRight: spacing.sm,
  },
  dateChipActive: {
    backgroundColor: colors.primary,
  },
  dateChipText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  dateChipTextActive: {
    color: colors.surface,
  },
  passengerSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  passengerButton: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passengerButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  passengerCount: {
    ...typography.h4,
    color: colors.text,
    minWidth: 24,
    textAlign: 'center',
  },
  findButton: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  sampleBanner: {
    backgroundColor: colors.amberLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  sampleBannerText: {
    ...typography.bodySmall,
    color: colors.warning,
  },
  errorBanner: {
    backgroundColor: colors.redLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  errorBannerText: {
    ...typography.bodySmall,
    color: colors.error,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  listContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  resultsCount: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  ambulanceCard: {
    marginBottom: spacing.md,
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
    ...typography.body,
    fontWeight: '600',
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
    marginLeft: 2,
  },
  ridesText: {
    ...typography.caption,
    color: colors.textTertiary,
    marginLeft: 4,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  vehicleModel: {
    ...typography.h4,
    color: colors.text,
  },
  plateNumber: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    backgroundColor: colors.input,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  equipmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  equipmentIcon: {
    fontSize: 16,
  },
  equipmentText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  priceLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  price: {
    ...typography.h3,
    color: colors.primary,
  },
  seatsInfo: {
    backgroundColor: colors.greenLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  seatsText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '600',
  },
  bookButton: {
    marginTop: spacing.sm,
  },
});

export default AmbulanceListScreen;
