import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Button, Input, Card, Header} from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { driversService, ambulancesService, isSupabaseConfigured } from '../../services/database';
import { Ambulance, AmbulanceCategory } from '../../types';

const EQUIPMENT_OPTIONS = [
  'Oxygen',
  'Stretcher',
  'Ventilator',
  'Wheelchair',
  'Defibrillator',
  'First Aid Kit',
];

const CATEGORIES: { value: AmbulanceCategory; label: string }[] = [
  { value: 'basic', label: 'Basic' },
  { value: 'icu', label: 'ICU / Advanced' },
];

const DriverRegistrationScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuthStore();

  // Edit mode: opened from Vehicle Management with an existing vehicle.
  const editVehicle: Ambulance | undefined = route.params?.vehicle;
  const isEditMode = Boolean(editVehicle);

  // Personal info
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');

  // License info
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');

  // Ambulance info
  const [category, setCategory] = useState<AmbulanceCategory>(
    editVehicle?.category ?? 'basic',
  );
  const [plateNumber, setPlateNumber] = useState(editVehicle?.plate_number ?? '');
  const [model, setModel] = useState(editVehicle?.model ?? '');
  const [color, setColor] = useState(editVehicle?.color ?? 'White');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>(
    editVehicle?.equipment ?? [],
  );
  const [hospitalAffiliation, setHospitalAffiliation] = useState(
    editVehicle?.hospital_affiliation ?? '',
  );

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggleEquipment = (item: string) => {
    setSelectedEquipment((prev) =>
      prev.includes(item) ? prev.filter((e) => e !== item) : [...prev, item]
    );
  };

  const handleUploadLicense = () => {
    Alert.alert(
      'Document upload unavailable',
      'Attaching document files is not part of this build — file storage is not configured yet. Continue by entering your license number and expiry date; a reviewer may ask for the document separately.',
    );
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!isEditMode) {
      if (!fullName.trim()) newErrors.fullName = 'Full name is required';
      if (!phone.trim()) newErrors.phone = 'Phone number is required';
      if (!email.trim()) newErrors.email = 'Email is required';
      if (!licenseNumber.trim()) newErrors.licenseNumber = 'License number is required';
      if (!licenseExpiry.trim()) newErrors.licenseExpiry = 'Expiry date is required';
    }
    if (!plateNumber.trim()) newErrors.plateNumber = 'Plate number is required';
    if (!model.trim()) newErrors.model = 'Vehicle model is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      if (isEditMode && editVehicle) {
        // ── Edit existing vehicle ─────────────────────────────────────
        if (isSupabaseConfigured) {
          await ambulancesService.update(editVehicle.id, {
            category,
            plate_number: plateNumber.trim(),
            model: model.trim(),
            color: color.trim() || 'White',
            equipment: selectedEquipment,
            hospital_affiliation: hospitalAffiliation.trim() || undefined,
          });
        }
        Alert.alert('Vehicle Updated', 'Your ambulance details have been saved.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        return;
      }

      // ── New driver application / additional vehicle ────────────────
      if (isSupabaseConfigured) {
        const userId = user?.id;
        if (!userId) {
          Alert.alert('Not signed in', 'Please sign in before applying as a driver.');
          return;
        }

        let driver = await driversService.getByUserId(userId);
        if (!driver) {
          driver = await driversService.register({
            user_id: userId,
            license_number: licenseNumber.trim(),
            license_expiry: licenseExpiry.trim() || undefined,
          });
        }

        await ambulancesService.create({
          driver_id: driver.id,
          category,
          plate_number: plateNumber.trim(),
          model: model.trim(),
          color: color.trim() || 'White',
          status: 'offline',
          equipment: selectedEquipment,
          hospital_affiliation: hospitalAffiliation.trim() || undefined,
        });

        Alert.alert(
          'Application Submitted',
          'Your driver application has been submitted for verification. An administrator will review your details before you can receive bookings.',
          [{ text: 'OK', onPress: () => navigation.navigate('DriverHome') }],
        );
      } else {
        // No database configured — the application cannot be persisted.
        await new Promise((resolve) => setTimeout(resolve, 600));
        Alert.alert(
          'Database Not Configured',
          'Your application could not be saved because no database is configured. Add Supabase credentials in .env, then submit again. Nothing was sent anywhere.',
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      }
    } catch {
      Alert.alert('Error', 'Failed to submit. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title={isEditMode ? 'Edit Ambulance' : 'Driver Registration'}
        showBack
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {!isEditMode && (
          <>
            {/* Personal Information */}
            <Card elevation="sm" style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Personal Information</Text>
              <Input
                label="Full Name"
                value={fullName}
                onChangeText={setFullName}
                placeholder="Enter your full name"
                error={errors.fullName}
              />
              <Input
                label="Phone Number"
                value={phone}
                onChangeText={setPhone}
                placeholder="+977-98XXXXXXXX"
                keyboardType="phone-pad"
                error={errors.phone}
              />
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="your@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
                error={errors.email}
              />
            </Card>

            {/* License Information */}
            <Card elevation="sm" style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>License Information</Text>
              <Input
                label="License Number"
                value={licenseNumber}
                onChangeText={setLicenseNumber}
                placeholder="e.g., DL-2024-XXXXX"
                error={errors.licenseNumber}
              />
              <Input
                label="Expiry Date"
                value={licenseExpiry}
                onChangeText={setLicenseExpiry}
                placeholder="YYYY-MM-DD"
                error={errors.licenseExpiry}
              />
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={handleUploadLicense}
              >
                <Text style={styles.uploadIcon}>📄</Text>
                <Text style={styles.uploadText}>Attach License Document</Text>
              </TouchableOpacity>
            </Card>
          </>
        )}

        {/* Ambulance Information */}
        <Card elevation="sm" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Ambulance Information</Text>

          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                style={[
                  styles.categoryChip,
                  category === cat.value && styles.categoryChipActive,
                ]}
                onPress={() => setCategory(cat.value)}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    category === cat.value && styles.categoryChipTextActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input
            label="Plate Number"
            value={plateNumber}
            onChangeText={setPlateNumber}
            placeholder="e.g., BA 2 PA 4521"
            error={errors.plateNumber}
            style={styles.mt}
          />
          <Input
            label="Vehicle Model"
            value={model}
            onChangeText={setModel}
            placeholder="e.g., Force Traveller Ambulance"
            error={errors.model}
          />
          <Input
            label="Color"
            value={color}
            onChangeText={setColor}
            placeholder="e.g., White"
          />
        </Card>

        {/* Equipment Checklist */}
        <Card elevation="sm" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Equipment Checklist</Text>
          <Text style={styles.sectionSubtitle}>
            Select all equipment available in your ambulance
          </Text>
          {EQUIPMENT_OPTIONS.map((item) => (
            <TouchableOpacity
              key={item}
              style={styles.checklistItem}
              onPress={() => toggleEquipment(item)}
            >
              <View
                style={[
                  styles.checkbox,
                  selectedEquipment.includes(item) && styles.checkboxChecked,
                ]}
              >
                {selectedEquipment.includes(item) && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </View>
              <Text style={styles.checklistLabel}>{item}</Text>
            </TouchableOpacity>
          ))}
        </Card>

        {/* Hospital Affiliation */}
        <Card elevation="sm" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Hospital Affiliation</Text>
          <Input
            label="Affiliated Hospital (Optional)"
            value={hospitalAffiliation}
            onChangeText={setHospitalAffiliation}
            placeholder="e.g., Norvic International Hospital"
          />
        </Card>

        {/* Info Notice */}
        <View style={styles.infoBox}>
          <Text style={styles.infoIcon}>ℹ️</Text>
          <Text style={styles.infoText}>
            {isEditMode
              ? 'Changes to your ambulance are saved to your driver record.'
              : 'Your application is stored in the database with a "pending" verification status. An administrator approves driver accounts — this cannot be self-approved from the app.'}
          </Text>
        </View>

        {/* Submit Button */}
        <Button
          title={isEditMode ? 'Save Changes' : 'Submit for Verification'}
          fullWidth
          size="lg"
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting}
          style={styles.submitButton}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  sectionCard: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sectionSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  fieldLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  categoryRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  categoryChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  categoryChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.redLight,
  },
  categoryChipText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: colors.primary,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.input,
  },
  uploadIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  uploadText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  checklistLabel: {
    ...typography.body,
    color: colors.text,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.blueLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  infoIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  infoText: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.text,
    lineHeight: 20,
  },
  submitButton: {
    marginTop: spacing.sm,
  },
  mt: {
    marginTop: spacing.md,
  },
});

export default DriverRegistrationScreen;
