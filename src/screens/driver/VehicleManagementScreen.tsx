import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Badge, Toggle } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { driversService, ambulancesService, isSupabaseConfigured } from '../../services/database';
import { isDemoMode } from '../../utils/demoMode';
import { Ambulance, AmbulanceStatus } from '../../types';
import DriverNavigationHeader from '../../components/driver/DriverNavigationHeader';

// Local-only vehicle data used by the explicitly enabled Driver demo.
const SAMPLE_VEHICLE: Ambulance = {
  id: 'sample-vehicle',
  driver_id: 'sample-driver',
  category: 'basic',
  plate_number: '—',
  model: 'Ambulance',
  color: 'White',
  status: 'offline',
  equipment: [],
  hospital_affiliation: '',
  created_at: '2024-01-12',
};

const VehicleManagementScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user, isDemoDriver } = useAuthStore();

  const [vehicles, setVehicles] = useState<Ambulance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingSampleData, setUsingSampleData] = useState(false);

  useEffect(() => {
    loadVehicles();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadVehicles() {
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode() && isDemoDriver) {
        setUsingSampleData(true);
        setVehicles([SAMPLE_VEHICLE]);
        return;
      }
      setUsingSampleData(false);
      const userId = user?.id;
      if (!userId) {
        setVehicles([]);
        return;
      }
      const driver = await driversService.getByUserId(userId);
      if (!driver) {
        setVehicles([]);
        return;
      }
      const list = await driversService.getAmbulances(driver.id);
      setVehicles(list);
    } catch {
      setError('Failed to load vehicles. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const handleStatusChange = async (vehicleId: string, newStatus: AmbulanceStatus) => {
    // Optimistic update — remember the previous status so a failed write can
    // be reverted to exactly what it was before.
    const previousStatus = vehicles.find((v) => v.id === vehicleId)?.status;
    setVehicles((prev) =>
      prev.map((v) => (v.id === vehicleId ? { ...v, status: newStatus } : v))
    );
    if (isSupabaseConfigured && !usingSampleData) {
      try {
        await ambulancesService.update(vehicleId, { status: newStatus });
      } catch {
        // Revert on failure
        setVehicles((prev) =>
          prev.map((v) =>
            v.id === vehicleId ? { ...v, status: previousStatus ?? v.status } : v
          )
        );
        setError('Could not update vehicle status. Please try again.');
      }
    }
  };

  const toggleStatus = (vehicleId: string, currentStatus: AmbulanceStatus) => {
    const nextStatus: AmbulanceStatus =
      currentStatus === 'available' ? 'offline' : 'available';
    void handleStatusChange(vehicleId, nextStatus);
  };

  const getStatusColor = (status: AmbulanceStatus) => {
    switch (status) {
      case 'available':
        return 'success';
      case 'busy':
        return 'warning';
      case 'offline':
        return 'neutral';
      default:
        return 'neutral';
    }
  };

  const getStatusLabel = (status: AmbulanceStatus) => {
    switch (status) {
      case 'available':
        return 'Available';
      case 'busy':
        return 'Busy';
      case 'offline':
        return 'Offline';
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <DriverNavigationHeader title="My Ambulance" showBack />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading vehicles...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <DriverNavigationHeader title="My Ambulance" showBack />
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Retry" variant="outline" onPress={loadVehicles} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <DriverNavigationHeader title="My Ambulance" showBack />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {vehicles.length === 0 ? (
          <Card elevation="sm" style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>🚑</Text>
            <Text style={styles.emptyTitle}>No Ambulance Added</Text>
            <Text style={styles.emptyMessage}>
              Add your ambulance to start receiving booking requests.
            </Text>
            <Button
              title="Add Ambulance"
              onPress={() => navigation.navigate('DriverRegistration')}
              style={styles.emptyButton}
            />
          </Card>
        ) : (
          vehicles.map((vehicle) => (
            <Card key={vehicle.id} elevation="sm" style={styles.vehicleCard}>
              {/* Vehicle Header */}
              <View style={styles.vehicleHeader}>
                <View style={styles.vehicleInfo}>
                  <Text style={styles.vehicleModel}>{vehicle.model}</Text>
                  <Text style={styles.vehiclePlate}>{vehicle.plate_number}</Text>
                </View>
                <Badge
                  label={vehicle.category.toUpperCase()}
                  variant={vehicle.category === 'icu' ? 'error' : 'info'}
                />
              </View>

              {/* Vehicle Details */}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Color</Text>
                <Text style={styles.detailValue}>{vehicle.color}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Hospital</Text>
                <Text style={styles.detailValue}>
                  {vehicle.hospital_affiliation ?? 'N/A'}
                </Text>
              </View>

              {/* Equipment List */}
              <Text style={styles.equipmentTitle}>Equipment</Text>
              <View style={styles.equipmentList}>
                {vehicle.equipment.map((item) => (
                  <View key={item} style={styles.equipmentChip}>
                    <Text style={styles.equipmentChipText}>✓ {item}</Text>
                  </View>
                ))}
              </View>

              {/* Status Toggle */}
              <View style={styles.statusSection}>
                <View style={styles.statusLeft}>
                  <Badge
                    label={getStatusLabel(vehicle.status)}
                    variant={getStatusColor(vehicle.status)}
                  />
                </View>
                <View style={styles.statusRight}>
                  <Text style={styles.statusLabel}>
                    {vehicle.status === 'available' ? 'Online' : 'Offline'}
                  </Text>
                  <Toggle
                    value={vehicle.status === 'available'}
                    onValueChange={() => toggleStatus(vehicle.id, vehicle.status)}
                  />
                </View>
              </View>

              {/* Actions */}
              <View style={styles.actionRow}>
                <Button
                  title="Edit Vehicle"
                  variant="outline"
                  size="sm"
                  onPress={() => navigation.navigate('DriverRegistration', { vehicle })}
                  style={styles.actionButton}
                />
                <Button
                  title={vehicle.status === 'busy' ? 'Mark Available' : 'Mark Busy'}
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    void handleStatusChange(
                      vehicle.id,
                      vehicle.status === 'busy' ? 'available' : 'busy'
                    )
                  }
                  style={styles.actionButton}
                />
              </View>
            </Card>
          ))
        )}

        {/* Add Another Vehicle */}
        <Button
          title="Add Another Vehicle"
          variant="outline"
          fullWidth
          onPress={() => navigation.navigate('DriverRegistration')}
          style={styles.addButton}
        />
      </ScrollView>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  sampleCard: {
    backgroundColor: colors.amberLight,
    marginBottom: spacing.lg,
  },
  sampleText: { ...typography.bodySmall, color: colors.warning },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyMessage: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  emptyButton: {
    marginTop: spacing.sm,
  },
  vehicleCard: {
    marginBottom: spacing.lg,
  },
  vehicleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  vehicleInfo: {
    flex: 1,
  },
  vehicleModel: {
    ...typography.h4,
    color: colors.text,
  },
  vehiclePlate: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  detailValue: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  equipmentTitle: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  equipmentList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  equipmentChip: {
    backgroundColor: colors.greenLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  equipmentChipText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '600',
  },
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  statusLeft: {
    flex: 1,
  },
  statusRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
  addButton: {
    marginTop: spacing.sm,
  },
});

export default VehicleManagementScreen;
