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
import { Button, Card, Header, Input } from '../../components/ui';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { SERVICE_CATEGORIES } from '../../constants/serviceCategories';
import { driverOnboardingService } from '../../services/driver/driverOnboardingService';
import { AmbulanceCategory } from '../../types';

const CATEGORY_KEYS: AmbulanceCategory[] = ['basic', 'icu'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatSavedAt = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'saved earlier';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`;
};

/**
 * Driver / ambulance-partner onboarding.
 *
 * The form is fully usable and validates like a real application, but
 * submission genuinely does not exist yet: there is no partner verification
 * service connected in this build, so the screen keeps a draft on the device
 * and says plainly that nothing has been sent. The future request/response
 * shapes are typed in src/services/api/contracts.ts.
 */
const DriverOnboardingScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [loaded, setLoaded] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceExpiry, setLicenceExpiry] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [category, setCategory] = useState<AmbulanceCategory>('basic');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [hospitalAffiliation, setHospitalAffiliation] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const draft = await driverOnboardingService.getDraft();
      if (draft) {
        setFullName(draft.fullName);
        setPhone(draft.phone);
        setLicenceNumber(draft.licenceNumber);
        setLicenceExpiry(draft.licenceExpiry);
        setVehiclePlate(draft.vehiclePlate);
        setCategory(draft.category);
        setEquipment(draft.equipment);
        setHospitalAffiliation(draft.hospitalAffiliation);
        setSavedAt(draft.updatedAt);
      }
      setLoaded(true);
    })();
  }, []);

  const selectCategory = useCallback((next: AmbulanceCategory) => {
    setCategory(next);
    // Keep only equipment that belongs to the chosen category.
    const allowed = SERVICE_CATEGORIES[next].capabilities;
    setEquipment((current) => current.filter((item) => allowed.includes(item)));
  }, []);

  const toggleEquipment = useCallback((item: string) => {
    setEquipment((current) =>
      current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item],
    );
  }, []);

  const validate = useCallback((): boolean => {
    const next: Record<string, string | undefined> = {};
    if (!fullName.trim()) next.fullName = 'Enter your full name.';
    const digits = phone.replace(/\D/g, '');
    if (!phone.trim()) next.phone = 'Enter your phone number.';
    else if (digits.length < 10) next.phone = 'Enter a valid phone number.';
    if (!licenceNumber.trim()) next.licenceNumber = 'Enter your licence number.';
    if (!vehiclePlate.trim()) next.vehiclePlate = 'Enter the ambulance plate number.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [fullName, licenceNumber, phone, vehiclePlate]);

  const handleSaveDraft = useCallback(async () => {
    if (!validate()) return;
    setSaving(true);
    setJustSaved(false);
    try {
      const saved = await driverOnboardingService.saveDraft({
        fullName: fullName.trim(),
        phone: phone.trim(),
        licenceNumber: licenceNumber.trim(),
        licenceExpiry: licenceExpiry.trim(),
        vehiclePlate: vehiclePlate.trim(),
        category,
        equipment,
        hospitalAffiliation: hospitalAffiliation.trim(),
      });
      setSavedAt(saved.updatedAt);
      setJustSaved(true);
    } catch {
      Alert.alert('Could not save draft', 'Your details were not saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [
    category,
    equipment,
    fullName,
    hospitalAffiliation,
    licenceExpiry,
    licenceNumber,
    phone,
    validate,
    vehiclePlate,
  ]);

  const handleClearDraft = useCallback(() => {
    Alert.alert('Clear draft', 'Delete the saved draft from this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete draft',
        style: 'destructive',
        onPress: async () => {
          await driverOnboardingService.clearDraft();
          setFullName('');
          setPhone('');
          setLicenceNumber('');
          setLicenceExpiry('');
          setVehiclePlate('');
          setCategory('basic');
          setEquipment([]);
          setHospitalAffiliation('');
          setErrors({});
          setSavedAt(null);
          setJustSaved(false);
        },
      },
    ]);
  }, []);

  const handleSubmit = useCallback(() => {
    Alert.alert(
      'Submission is not available yet',
      'Partner onboarding is not connected in this build, so nothing has been sent and no application was created. Use “Save draft” to keep your details on this device.',
    );
  }, []);

  const capabilities = SERVICE_CATEGORIES[category].capabilities;

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Drive with RESQ Nepal" showBack onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!loaded ? (
          <ActivityIndicator style={styles.loader} size="small" color={colors.primary} />
        ) : (
          <>
            <Card elevation="sm" style={styles.card}>
              <Text style={styles.cardTitle}>Before you apply</Text>
              <Text style={styles.bullet}>• A valid driving licence.</Text>
              <Text style={styles.bullet}>
                • An ambulance registered to you or your organisation.
              </Text>
              <Text style={styles.bullet}>• The equipment your chosen category lists.</Text>
              <Text style={styles.note}>
                Applications are reviewed by the partner team — approval is never automatic.
              </Text>
            </Card>

            <Card elevation="sm" style={styles.card}>
              <Text style={styles.cardTitle}>Your details</Text>
              <Input
                label="Full name"
                value={fullName}
                onChangeText={setFullName}
                placeholder="As written on your licence"
                error={errors.fullName}
              />
              <Input
                label="Phone number"
                value={phone}
                onChangeText={setPhone}
                placeholder="Number the partner team can reach you on"
                keyboardType="phone-pad"
                error={errors.phone}
              />
            </Card>

            <Card elevation="sm" style={styles.card}>
              <Text style={styles.cardTitle}>Driving licence</Text>
              <Input
                label="Licence number"
                value={licenceNumber}
                onChangeText={setLicenceNumber}
                placeholder="Printed on your licence"
                autoCapitalize="characters"
                error={errors.licenceNumber}
              />
              <Input
                label="Licence expiry (optional)"
                value={licenceExpiry}
                onChangeText={setLicenceExpiry}
                placeholder="YYYY-MM-DD"
              />
            </Card>

            <Card elevation="sm" style={styles.card}>
              <Text style={styles.cardTitle}>Ambulance</Text>
              <Input
                label="Plate number"
                value={vehiclePlate}
                onChangeText={setVehiclePlate}
                placeholder="Ba 1 Pa 1234"
                autoCapitalize="characters"
                error={errors.vehiclePlate}
              />

              <Text style={styles.fieldLabel}>Category</Text>
              <View style={styles.chipsRow}>
                {CATEGORY_KEYS.map((key) => {
                  const selected = category === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.chip, selected && styles.chipActive]}
                      onPress={() => selectCategory(key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={SERVICE_CATEGORIES[key].name}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                        {SERVICE_CATEGORIES[key].name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Equipment on board</Text>
              {capabilities.map((item) => {
                const checked = equipment.includes(item);
                return (
                  <TouchableOpacity
                    key={item}
                    style={styles.checkRow}
                    onPress={() => toggleEquipment(item)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={item}
                  >
                    <Text style={styles.checkBox}>{checked ? '☑' : '☐'}</Text>
                    <Text style={styles.checkLabel}>{item}</Text>
                  </TouchableOpacity>
                );
              })}

              <Input
                label="Hospital / provider affiliation (optional)"
                value={hospitalAffiliation}
                onChangeText={setHospitalAffiliation}
                placeholder="e.g. linked to a hospital or ambulance company"
              />
            </Card>

            <View style={styles.actionsRow}>
              <Button
                title="Save draft"
                loading={saving}
                onPress={handleSaveDraft}
                style={styles.actionButton}
              />
              {(savedAt || fullName.trim().length > 0) && (
                <Button
                  title="Clear draft"
                  variant="ghost"
                  onPress={handleClearDraft}
                  style={styles.actionButton}
                />
              )}
            </View>

            <Card elevation="sm" style={styles.statusCard}>
              <Text style={styles.cardTitle}>Application status</Text>
              <Text style={styles.statusText}>
                {savedAt
                  ? `Draft saved on this device — ${formatSavedAt(savedAt)}.${
                      justSaved ? ' Nothing has been sent.' : ''
                    } Nothing has been submitted to RESQ Nepal yet.`
                  : 'Not started — nothing has been submitted.'}
              </Text>
              {justSaved && <Text style={styles.savedHint}>Draft saved just now.</Text>}
            </Card>

            <Card elevation="sm" style={styles.card}>
              <Text style={styles.cardTitle}>Submit for review</Text>
              <Text style={styles.note}>
                Applications will be reviewed once the partner verification service is connected.
                This build only keeps a draft on this device; nothing is sent.
              </Text>
              <Button
                title="Submit application"
                variant="outline"
                onPress={handleSubmit}
                style={{ marginTop: spacing.md }}
              />
            </Card>
            <Card elevation="sm" style={styles.card}>
              <Text style={styles.cardTitle}>Verified driver application</Text>
              <Text style={styles.note}>
                Submit through the identity flow to add your citizenship number, citizenship
                document, driving licence and Blue Book. Documents are uploaded to a private
                bucket and the application stays pending until a reviewer verifies it. This
                local draft alone cannot approve a driver.
              </Text>
              <Button
                title="Open verified application"
                onPress={() => navigation.navigate('DriverRegistration')}
                fullWidth
                style={{ marginTop: spacing.md }}
              />
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default DriverOnboardingScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  loader: { marginTop: spacing.xxl },
  card: { padding: spacing.lg, marginBottom: spacing.md },
  cardTitle: { ...typography.body, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  bullet: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.xs },
  note: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.sm },
  fieldLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  chipsRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
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
  checkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.sm },
  checkBox: { fontSize: 18, width: 26, color: colors.primary },
  checkLabel: { ...typography.bodySmall, color: colors.text, flex: 1 },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionButton: { flex: 1 },
  statusCard: { padding: spacing.lg, marginBottom: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.warning },
  statusText: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 20 },
  savedHint: { ...typography.caption, color: colors.success, marginTop: spacing.sm, fontWeight: '600' },
});
