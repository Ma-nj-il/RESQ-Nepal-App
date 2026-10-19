import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, Card, Header, Avatar, Badge, StarRating } from '../../components/ui';
import { colors, spacing, typography} from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { driversService, isSupabaseConfigured } from '../../services/database';
import { isDemoMode } from '../../utils/demoMode';
import { Driver, Ambulance } from '../../types';

// Development sample profile — only shown when Supabase is not configured
// (clearly labelled in the UI).
const SAMPLE_DRIVER: Driver = {
  id: 'sample-driver',
  user_id: 'sample-user',
  license_number: 'DL-2024-78542',
  license_expiry: '2027-06-15',
  status: 'verified',
  rating: 4.8,
  total_rides: 1247,
  verified_at: '2024-01-15',
  created_at: '2024-01-10',
};

const SAMPLE_AMBULANCE: Ambulance = {
  id: 'sample-ambulance',
  driver_id: 'sample-driver',
  category: 'icu',
  plate_number: 'BA 2 PA 4521',
  model: 'Force Traveller Ambulance',
  color: 'White',
  status: 'available',
  equipment: ['Oxygen', 'Stretcher', 'Ventilator', 'Defibrillator', 'First Aid Kit'],
  hospital_affiliation: 'Norvic International Hospital',
  created_at: '2024-01-12',
};

const DriverProfileScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();

  const [driver, setDriver] = useState<Driver | null>(null);
  const [ambulance, setAmbulance] = useState<Ambulance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingSampleData, setUsingSampleData] = useState(false);

  useEffect(() => {
    loadProfile();
    // Load exactly once on mount — loadProfile reads fresh state internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfile() {
    setLoading(true);
    setError(null);
    try {
      if (isDemoMode() || !isSupabaseConfigured) {
        setUsingSampleData(true);
        setDriver(SAMPLE_DRIVER);
        setAmbulance(SAMPLE_AMBULANCE);
        return;
      }

      setUsingSampleData(false);
      const userId = user?.id;
      if (!userId) {
        setDriver(null);
        setAmbulance(null);
        return;
      }
      const record = await driversService.getByUserId(userId);
      setDriver(record);
      if (record) {
        const vehicles = await driversService.getAmbulances(record.id);
        setAmbulance(vehicles[0] ?? null);
      } else {
        setAmbulance(null);
      }
    } catch {
      setError('Failed to load profile. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'verified':
        return 'success';
      case 'pending':
        return 'warning';
      case 'rejected':
        return 'error';
      default:
        return 'neutral';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'verified':
        return 'Verified';
      case 'pending':
        return 'Pending Verification';
      case 'rejected':
        return 'Rejected';
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Driver Profile" showBack onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Driver Profile" showBack onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Retry" variant="outline" onPress={loadProfile} style={styles.retryButton} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Driver Profile" showBack onBack={() => navigation.goBack()} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {usingSampleData && (
          <Card elevation="sm" style={styles.sampleCard}>
            <Text style={styles.sampleText}>
              {isDemoMode()
                ? 'Walkthrough — sample driver profile for this demo session. Nothing here is a real record.'
                : '⚠️ Sample build — database not configured. Showing an example driver profile.'}
            </Text>
          </Card>
        )}

        {!driver ? (
          <Card elevation="sm" style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>🚑</Text>
            <Text style={styles.emptyTitle}>No Driver Profile</Text>
            <Text style={styles.emptyMessage}>
              You are not registered as a driver yet. Submit an application to get started.
            </Text>
            <Button
              title="Register as Driver"
              onPress={() => navigation.navigate('DriverRegistration')}
              fullWidth
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ) : (
          <>
            {/* Avatar & Name */}
        <View style={styles.profileHeader}>
          <Avatar name={user?.full_name ?? 'Driver'} size="xl" />
          <Text style={styles.driverName}>{user?.full_name ?? 'Driver'}</Text>
          <Text style={styles.driverPhone}>{user?.phone ?? '+977-98XXXXXXXX'}</Text>
          <View style={styles.badgeRow}>
            <Badge
              label={getStatusLabel(driver?.status ?? 'pending')}
              variant={getStatusBadgeVariant(driver?.status ?? 'pending')}
            />
          </View>
        </View>

        {/* Rating & Rides */}
        <Card elevation="sm" style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <StarRating rating={driver?.rating ?? 0} readonly size="sm" />
              <Text style={styles.statValue}>{driver?.rating ?? 0}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{driver?.total_rides ?? 0}</Text>
              <Text style={styles.statLabel}>Total Rides</Text>
            </View>
          </View>
        </Card>

        {/* License Info */}
        <Card elevation="sm" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>License Information</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>License Number</Text>
            <Text style={styles.infoValue}>{driver?.license_number}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Expiry Date</Text>
            <Text style={styles.infoValue}>{driver?.license_expiry}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Verified On</Text>
            <Text style={styles.infoValue}>{driver?.verified_at ?? 'Not verified'}</Text>
          </View>
        </Card>

        {/* Ambulance Info */}
        {ambulance && (
          <Card elevation="sm" style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Ambulance Information</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Model</Text>
              <Text style={styles.infoValue}>{ambulance.model}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Plate Number</Text>
              <Text style={styles.infoValue}>{ambulance.plate_number}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Category</Text>
              <Badge
                label={ambulance.category.toUpperCase()}
                variant={ambulance.category === 'icu' ? 'error' : 'info'}
              />
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Hospital</Text>
              <Text style={styles.infoValue}>{ambulance.hospital_affiliation ?? 'N/A'}</Text>
            </View>
          </Card>
        )}

        {/* Application status — read-only; approval remains a backend action. */}
        <Button
          title="View Application Status"
          variant="outline"
          fullWidth
          onPress={() => navigation.navigate('ApplicationStatus', { type: 'DRIVER' })}
          style={styles.editButton}
        />

        {/* Edit Profile Button */}
        <Button
          title="Edit Ambulance Details"
          variant="outline"
          fullWidth
          onPress={() =>
            ambulance
              ? navigation.navigate('DriverRegistration', { vehicle: ambulance })
              : navigation.navigate('DriverRegistration')
          }
          style={styles.editButton}
        />
          </>
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
  retryButton: {
    marginTop: spacing.md,
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
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { ...typography.h3, marginBottom: spacing.sm },
  emptyMessage: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  driverName: {
    ...typography.h2,
    color: colors.text,
    marginTop: spacing.md,
  },
  driverPhone: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  statsCard: {
    marginBottom: spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
  },
  statValue: {
    ...typography.h3,
    color: colors.text,
    marginTop: spacing.xs,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionCard: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.text,
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  infoValue: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  editButton: {
    marginTop: spacing.sm,
  },
});

export default DriverProfileScreen;
