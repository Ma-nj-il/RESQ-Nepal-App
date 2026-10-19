import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button, Input } from '../../components/ui';
import { DocumentUploadCard } from '../../components/identity';
import { useAuthStore } from '../../store/authStore';
import { profilesService } from '../../services/database/profiles';
import {
  identityApplicationsService,
  identityDocumentsService,
  IdentityServiceError,
} from '../../services/database';
import { isSupabaseConfigured } from '../../services/database/client';
import { isDemoMode } from '../../utils/demoMode';
import type { IdentityDocument } from '../../types';
import { applicationStatusPresentation, pickCurrentDocument } from '../../utils/identity';

interface PersonalInfoScreenProps {
  navigation: any;
  route: any;
}

const genderOptions = ['Male', 'Female', 'Other'];

/** Formats raw keystrokes as YYYY-MM-DD while typing. */
const formatDobInput = (text: string) => {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
};

const PersonalInfoScreen: React.FC<PersonalInfoScreenProps> = ({ navigation, route }) => {
  const { phone } = route.params || { phone: '' };
  const { user, setUser } = useAuthStore();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedGender, setSelectedGender] = useState('');
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [citizenshipNumber, setCitizenshipNumber] = useState(user?.citizenship_number ?? '');
  const [saving, setSaving] = useState(false);
  const [documents, setDocuments] = useState<IdentityDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);

  const requiresIdentity = isSupabaseConfigured && !isDemoMode();
  const userId = user?.id;
  const citizenshipDocument = pickCurrentDocument(documents, 'CITIZENSHIP');

  const loadDocuments = useCallback(async () => {
    if (!requiresIdentity || !userId) return;
    setDocumentsLoading(true);
    try {
      const loaded = await identityDocumentsService.listDocuments();
      setDocuments(loaded);
    } catch (error) {
      // A missing migration is surfaced where the document is uploaded; this
      // screen stays usable and never pretends a document exists.
      if (error instanceof IdentityServiceError) {
        setDocuments([]);
      }
    } finally {
      setDocumentsLoading(false);
    }
  }, [requiresIdentity, userId]);

  useEffect(() => {
    // Defer by a tick so the effect does not synchronously set loading state
    // during mount (React's effect guidance).
    const timer = setTimeout(() => {
      void loadDocuments();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadDocuments]);

  const handleBack = () => {
    navigation.goBack();
  };

  const handleContinue = async () => {
    const dob = dateOfBirth.trim();
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      Alert.alert('Check date of birth', 'Please enter your date of birth as YYYY-MM-DD.');
      return;
    }
    if (requiresIdentity && !citizenshipNumber.trim()) {
      Alert.alert(
        'Citizenship number required',
        'Enter the citizenship number printed on your certificate before continuing.',
      );
      return;
    }
    if (requiresIdentity && !citizenshipDocument) {
      Alert.alert(
        'Citizenship document required',
        'Upload a photo of your citizenship document before submitting your registration.',
      );
      return;
    }
    if (isDemoMode()) {
      // Demo mode — keep the typed details local only; nothing is written to
      // Supabase, no document is uploaded and no real account is created.
      setUser({
        id: 'demo-user',
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone || '',
        citizenship_number: citizenshipNumber.trim() || undefined,
        mode: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      navigation.navigate('LocationPermission');
      return;
    }
    if (!isSupabaseConfigured) {
      // Sample mode — nothing is persisted; continue to the next step.
      navigation.navigate('LocationPermission');
      return;
    }
    const userId = user?.id;
    if (!userId) {
      Alert.alert('Not signed in', 'Your session was not found. Please sign in again.');
      navigation.navigate('Welcome');
      return;
    }
    setSaving(true);
    let profileSaved = false;
    try {
      // Persist the details collected here to the signed-in user's profile.
      const updated = await profilesService.update(userId, {
        full_name: fullName.trim(),
        email: email.trim(),
        ...(selectedGender ? { gender: selectedGender } : {}),
        ...(dob ? { date_of_birth: dob } : {}),
        citizenship_number: citizenshipNumber.trim(),
      });
      setUser(updated);
      profileSaved = true;

      try {
        const application = await identityApplicationsService.submitApplication('USER');
        const statusLabel = applicationStatusPresentation(application.status).label;
        Alert.alert(
          'Application recorded',
          `Your citizenship details were saved.\n\nReference: ${application.reference_id}\nStatus: ${statusLabel}.`,
          [
            {
              text: 'View status',
              onPress: () => navigation.navigate('ApplicationStatus', { type: 'USER' }),
            },
            {
              text: 'Continue',
              onPress: () => navigation.navigate('LocationPermission'),
            },
          ],
          { cancelable: false },
        );
        return;
      } catch (submissionError) {
        const message =
          submissionError instanceof IdentityServiceError
            ? submissionError.userMessage
            : 'Your details were saved, but the application could not be submitted.';
        Alert.alert('Details saved — not submitted', message, [
          {
            text: 'View status',
            onPress: () => navigation.navigate('ApplicationStatus', { type: 'USER' }),
          },
          {
            text: 'Continue',
            onPress: () => navigation.navigate('LocationPermission'),
          },
        ]);
        return;
      }
    } catch (error) {
      const message =
        error instanceof IdentityServiceError
          ? error.userMessage
          : profileSaved
            ? 'Your profile was saved, but the document record could not be updated.'
            : 'Please check your connection and try again.';
      Alert.alert('Could not save your details', message);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarPress = () => {
    Alert.alert(
      'Profile photo',
      'Uploading a profile photo is not available in this build. Identity documents are uploaded separately and stored privately.',
    );
  };

  const isFormValid = Boolean(
    fullName.trim() &&
      email.trim() &&
      selectedGender &&
      (!requiresIdentity || (citizenshipNumber.trim() && citizenshipDocument)) &&
      !documentsLoading &&
      !documentBusy,
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {/* Back Arrow */}
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Heading */}
          <Text style={styles.heading}>Fill Personal Info</Text>

          {/* Avatar Placeholder */}
          <TouchableOpacity onPress={handleAvatarPress} style={styles.avatarContainer}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarIcon}>👤</Text>
              <View style={styles.cameraBadge}>
                <Text style={styles.cameraIcon}>📷</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Full Name Input */}
          <Input
            label="Full Name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Enter your full name"
            autoCapitalize="words"
          />

          {/* Email Input */}
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="Enter your email"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          {/* Phone Number Input (Pre-filled) */}
          <Input
            label="Phone Number"
            value={phone}
            editable={false}
          />

          {/* Gender Dropdown */}
          <View style={styles.dropdownContainer}>
            <Text style={styles.dropdownLabel}>Gender</Text>
            <TouchableOpacity
              style={styles.dropdownButton}
              onPress={() => setShowGenderDropdown(!showGenderDropdown)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dropdownText, !selectedGender && styles.placeholderText]}>
                {selectedGender || 'Select gender'}
              </Text>
              <Text style={styles.dropdownArrow}>▼</Text>
            </TouchableOpacity>
            {showGenderDropdown && (
              <View style={styles.dropdownMenu}>
                {genderOptions.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={styles.dropdownOption}
                    onPress={() => {
                      setSelectedGender(option);
                      setShowGenderDropdown(false);
                    }}
                  >
                    <Text style={styles.dropdownOptionText}>{option}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Date of Birth (optional, typed as YYYY-MM-DD) */}
          <Input
            label="Date of Birth (optional)"
            value={dateOfBirth}
            onChangeText={(text) => setDateOfBirth(formatDobInput(text))}
            placeholder="YYYY-MM-DD"
            keyboardType="number-pad"
            maxLength={10}
          />

          {/* Citizenship number + document — required for a real account.
              Demo/sample mode keeps the honest local walkthrough and never
              pretends a document was uploaded. */}
          <Input
            label="Citizenship Number"
            value={citizenshipNumber}
            onChangeText={setCitizenshipNumber}
            placeholder={requiresIdentity ? 'As printed on your certificate' : 'Optional in demo mode'}
            autoCapitalize="characters"
            editable={requiresIdentity}
          />

          {requiresIdentity ? (
            <>
              {documentsLoading ? (
                <View style={styles.documentLoading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.documentLoadingText}>Checking uploaded documents…</Text>
                </View>
              ) : (
                <DocumentUploadCard
                  documentType="CITIZENSHIP"
                  existing={citizenshipDocument}
                  required
                  onUploaded={(document) => {
                    setDocuments((current) => [
                      document,
                      ...current.filter((item) => item.id !== document.id),
                    ]);
                  }}
                  onRemoved={(document) => {
                    setDocuments((current) =>
                      current.map((item) =>
                        item.id === document.id ? { ...item, upload_status: 'REMOVED' } : item,
                      ),
                    );
                  }}
                  onBusyChange={setDocumentBusy}
                />
              )}
              <View style={styles.identityNote}>
                <Text style={styles.identityNoteText}>
                  Required for a patient account. The document is stored in a private bucket and
                  is only used for registration review. Uploading it does not verify your identity
                  automatically.
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.identityNote}>
              <Text style={styles.identityNoteText}>
                {isDemoMode()
                  ? 'Demo mode — no identity document is uploaded, no application is created and nothing is sent to the database.'
                  : 'Sample mode — the database is not configured, so no identity document is uploaded and no application is created.'}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Continue Button */}
        <View style={styles.footer}>
          <Button
            title="Continue"
            onPress={handleContinue}
            fullWidth
            size="lg"
            disabled={!isFormValid || saving}
            loading={saving}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  keyboardView: {
    flex: 1,
  },
  backButton: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backArrow: {
    fontSize: 24,
    color: colors.text,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  heading: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xl,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  avatarCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.input,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIcon: {
    fontSize: 40,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  cameraIcon: {
    fontSize: 14,
  },
  dropdownContainer: {
    marginBottom: spacing.md,
  },
  dropdownLabel: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.input,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  dropdownText: {
    ...typography.body,
    color: colors.text,
  },
  placeholderText: {
    color: colors.textTertiary,
  },
  dropdownArrow: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  dropdownMenu: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  dropdownOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownOptionText: {
    ...typography.body,
    color: colors.text,
  },
  documentLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  documentLoadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  identityNote: {
    backgroundColor: colors.blueLight,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  identityNoteText: {
    ...typography.caption,
    color: colors.text,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
});

export default PersonalInfoScreen;
