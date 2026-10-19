import React, { useCallback, useEffect, useState } from 'react';
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
import { Button, Input, Card, Header } from '../../components/ui';
import { DocumentUploadCard } from '../../components/identity';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import {
  driversService,
  ambulancesService,
  identityApplicationsService,
  identityDocumentsService,
  IdentityServiceError,
  isSupabaseConfigured,
} from '../../services/database';
import { profilesService } from '../../services/database/profiles';
import { isDemoMode } from '../../utils/demoMode';
import { applicationStatusPresentation, pickCurrentDocument } from '../../utils/identity';
import type { Ambulance, AmbulanceCategory, Driver, IdentityDocument } from '../../types';

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
  const { user, setUser } = useAuthStore();

  // Edit mode: opened from Vehicle Management with an existing vehicle.
  const editVehicle: Ambulance | undefined = route.params?.vehicle;
  const isEditMode = Boolean(editVehicle);

  // Personal info
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [citizenshipNumber, setCitizenshipNumber] = useState(
    user?.citizenship_number ?? '',
  );

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
  const [documents, setDocuments] = useState<IdentityDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [existingDriver, setExistingDriver] = useState<Driver | null>(null);

  const requiresIdentity = isSupabaseConfigured && !isDemoMode();
  const userId = user?.id;
  const citizenshipDocument = pickCurrentDocument(documents, 'CITIZENSHIP');
  const licenceDocument = pickCurrentDocument(documents, 'DRIVING_LICENSE');
  const blueBookDocument = pickCurrentDocument(
    documents,
    'VEHICLE_BLUE_BOOK',
    editVehicle?.id,
  );

  const loadApplicationData = useCallback(async () => {
    if (!requiresIdentity || !userId) return;
    setDocumentsLoading(true);
    try {
      const [profile, loadedDocuments, driver] = await Promise.all([
        profilesService.getById(userId),
        identityDocumentsService.listDocuments(),
        isEditMode && editVehicle
          ? driversService.getById(editVehicle.driver_id)
          : driversService.getByUserId(userId),
      ]);
      setDocuments(loadedDocuments);
      setExistingDriver(driver);
      if (profile) {
        setFullName((current) => current || profile.full_name || '');
        setPhone((current) => current || profile.phone || '');
        setEmail((current) => current || profile.email || '');
        setCitizenshipNumber((current) => current || profile.citizenship_number || '');
      }
      if (driver && !isEditMode) {
        setLicenseNumber((current) => current || driver.license_number || '');
        setLicenseExpiry((current) => current || driver.license_expiry || '');
      }
    } catch (error) {
      if (error instanceof IdentityServiceError) {
        // The migration or storage may not be applied yet. The form still
        // opens, but submission will surface the same honest error.
        setDocuments([]);
      }
    } finally {
      setDocumentsLoading(false);
    }
  }, [editVehicle, isEditMode, requiresIdentity, userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadApplicationData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadApplicationData]);

  const toggleEquipment = (item: string) => {
    setSelectedEquipment((prev) =>
      prev.includes(item) ? prev.filter((e) => e !== item) : [...prev, item]
    );
  };

  const registerDocument = (document: IdentityDocument) => {
    setDocuments((current) => [
      document,
      ...current.filter((item) => item.id !== document.id),
    ]);
  };

  const markDocumentRemoved = (document: IdentityDocument) => {
    setDocuments((current) =>
      current.map((item) =>
        item.id === document.id ? { ...item, upload_status: 'REMOVED' as const } : item,
      ),
    );
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!isEditMode) {
      if (!fullName.trim()) newErrors.fullName = 'Full name is required';
      if (!phone.trim()) newErrors.phone = 'Phone number is required';
      if (!email.trim()) newErrors.email = 'Email is required';
      if (!citizenshipNumber.trim()) {
        newErrors.citizenshipNumber = 'Citizenship number is required';
      }
      if (!licenseNumber.trim()) newErrors.licenseNumber = 'License number is required';
      if (!licenseExpiry.trim()) {
        newErrors.licenseExpiry = 'Expiry date is required';
      } else if (
        !/^\d{4}-\d{2}-\d{2}$/.test(licenseExpiry.trim()) ||
        Number.isNaN(new Date(`${licenseExpiry.trim()}T00:00:00`).getTime())
      ) {
        newErrors.licenseExpiry = 'Use the format YYYY-MM-DD';
      }
      if (requiresIdentity && !citizenshipDocument) {
        newErrors.citizenshipDocument = 'Citizenship document is required';
      }
      if (requiresIdentity && !licenceDocument) {
        newErrors.licenceDocument = 'Driving licence document is required';
      }
      if (requiresIdentity && !blueBookDocument) {
        newErrors.blueBookDocument = 'Blue Book document is required';
      }
    }
    if (!plateNumber.trim()) newErrors.plateNumber = 'Plate number is required';
    if (!model.trim()) newErrors.model = 'Vehicle model is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    if (isDemoMode()) {
      Alert.alert(
        'Demo mode',
        'No driver record, vehicle, document or application is saved in demo mode. Nothing was sent to the database.',
        [{ text: 'OK' }],
      );
      return;
    }

    if (!isSupabaseConfigured) {
      Alert.alert(
        'Database Not Configured',
        'Your application could not be saved because no database is configured. Add Supabase credentials in .env, then submit again. Nothing was sent anywhere.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
      return;
    }

    setSubmitting(true);
    try {
      if (isEditMode && editVehicle) {
        // ── Edit existing vehicle ─────────────────────────────────────
        await ambulancesService.update(editVehicle.id, {
          category,
          plate_number: plateNumber.trim(),
          model: model.trim(),
          color: color.trim() || 'White',
          equipment: selectedEquipment,
          hospital_affiliation: hospitalAffiliation.trim() || undefined,
        });
        Alert.alert('Vehicle Updated', 'Your ambulance details have been saved.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        return;
      }

      const userId = user?.id;
      if (!userId) {
        Alert.alert('Not signed in', 'Please sign in before applying as a driver.');
        return;
      }

      // Persist personal identity details on the existing profile. The
      // profile row is created by the existing auth trigger.
      const updatedProfile = await profilesService.update(userId, {
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        citizenship_number: citizenshipNumber.trim(),
      });
      setUser(updatedProfile);

      let driver = existingDriver ?? (await driversService.getByUserId(userId));
      if (!driver) {
        driver = await driversService.register({
          user_id: userId,
          license_number: licenseNumber.trim(),
          license_expiry: licenseExpiry.trim() || undefined,
        });
      } else if (
        driver.license_number !== licenseNumber.trim() ||
        (driver.license_expiry ?? '') !== licenseExpiry.trim()
      ) {
        driver = await driversService.updateEditable(driver.id, {
          license_number: licenseNumber.trim(),
          license_expiry: licenseExpiry.trim() || undefined,
        });
      }

      const existingVehicles = (await driversService.getAmbulances(driver.id))
        .slice()
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const editableVehicle = {
        category,
        plate_number: plateNumber.trim(),
        model: model.trim(),
        color: color.trim() || 'White',
        status: 'offline' as const,
        equipment: selectedEquipment,
        hospital_affiliation: hospitalAffiliation.trim() || undefined,
      };
      const vehicle =
        existingVehicles.length > 0
          ? await ambulancesService.update(existingVehicles[0].id, editableVehicle)
          : await ambulancesService.create({
              driver_id: driver.id,
              ...editableVehicle,
            });

      // Attach documents uploaded before the driver/vehicle existed. RLS
      // still checks that both records belong to this account.
      await identityDocumentsService.associatePendingDocuments({
        driverId: driver.id,
        vehicleId: vehicle.id,
      });

      // Re-check every required document and storage object atomically on the
      // server. The driver remains 'pending' until a reviewer verifies it.
      const application = await identityApplicationsService.submitApplication('DRIVER');
      const statusLabel = applicationStatusPresentation(application.status).label;

      Alert.alert(
        'Application recorded',
        `Your driver application is recorded.\n\nReference: ${application.reference_id}\nStatus: ${statusLabel}\nThe app never approves a driver automatically.`,
        [
          {
            text: 'View status',
            onPress: () =>
              navigation.navigate('ApplicationStatus', { type: 'DRIVER' }),
          },
          {
            text: 'Done',
            onPress: () => {
              const routeNames: string[] = navigation.getState()?.routeNames ?? [];
              if (routeNames.includes('DriverHome')) {
                navigation.navigate('DriverHome');
              } else if (navigation.canGoBack()) {
                navigation.goBack();
              }
            },
          },
        ],
        { cancelable: false },
      );
    } catch (error) {
      const message =
        error instanceof IdentityServiceError
          ? error.userMessage
          : 'Failed to submit. Please check your connection and try again.';
      Alert.alert('Application not submitted', message, [{ text: 'OK' }]);
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
              <Input
                label="Citizenship Number"
                value={citizenshipNumber}
                onChangeText={setCitizenshipNumber}
                placeholder="As printed on your citizenship certificate"
                autoCapitalize="characters"
                error={errors.citizenshipNumber}
              />
              {errors.citizenshipDocument ? (
                <Text style={styles.fieldError}>{errors.citizenshipDocument}</Text>
              ) : null}
              {documentsLoading ? (
                <Text style={styles.documentsLoadingText}>Checking uploaded documents…</Text>
              ) : (
                <DocumentUploadCard
                  documentType="CITIZENSHIP"
                  existing={citizenshipDocument}
                  required
                  disabled={!requiresIdentity}
                  disabledReason={
                    isDemoMode()
                      ? 'Demo mode — no identity document is uploaded or stored.'
                      : 'Identity document storage is not configured in this build.'
                  }
                  onUploaded={registerDocument}
                  onRemoved={markDocumentRemoved}
                  onBusyChange={setDocumentBusy}
                />
              )}
            </Card>

            {/* License Information */}
            <Card elevation="sm" style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Driving Licence</Text>
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
              {errors.licenceDocument ? (
                <Text style={styles.fieldError}>{errors.licenceDocument}</Text>
              ) : null}
              <DocumentUploadCard
                documentType="DRIVING_LICENSE"
                existing={licenceDocument}
                driverId={existingDriver?.id}
                required
                disabled={!requiresIdentity}
                disabledReason={
                  isDemoMode()
                    ? 'Demo mode — no driving licence is uploaded or stored.'
                    : 'Identity document storage is not configured in this build.'
                }
                onUploaded={registerDocument}
                onRemoved={markDocumentRemoved}
                onBusyChange={setDocumentBusy}
              />
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

        {/* Blue Book — linked to this vehicle once the vehicle exists. */}
        <Card elevation="sm" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Vehicle Blue Book</Text>
          {errors.blueBookDocument ? (
            <Text style={styles.fieldError}>{errors.blueBookDocument}</Text>
          ) : null}
          <DocumentUploadCard
            documentType="VEHICLE_BLUE_BOOK"
            existing={blueBookDocument}
            driverId={existingDriver?.id ?? editVehicle?.driver_id}
            vehicleId={editVehicle?.id}
            required={!isEditMode}
            disabled={!requiresIdentity}
            disabledReason={
              isDemoMode()
                ? 'Demo mode — no Blue Book is uploaded or stored.'
                : 'Identity document storage is not configured in this build.'
            }
            onUploaded={registerDocument}
            onRemoved={markDocumentRemoved}
            onBusyChange={setDocumentBusy}
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
              ? 'Changes to your ambulance are saved to your driver record. Blue Book replacement is optional when editing.'
              : 'Your citizenship number, licence, vehicle and Blue Book are stored in the database. Documents go to a private bucket, and the application stays "pending" until an authorised reviewer verifies it. Nothing is self-approved from the app.'}
          </Text>
        </View>

        {/* Submit Button */}
        <Button
          title={isEditMode ? 'Save Changes' : 'Submit for Verification'}
          fullWidth
          size="lg"
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting || documentBusy}
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
  fieldError: {
    ...typography.caption,
    color: colors.error,
    marginBottom: spacing.sm,
  },
  documentsLoadingText: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingVertical: spacing.md,
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
