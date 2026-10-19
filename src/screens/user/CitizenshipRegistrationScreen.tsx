import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Button, Card, Header, Input } from '../../components/ui';
import { DocumentUploadCard } from '../../components/identity';
import { colors, spacing, typography } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import {
  identityApplicationsService,
  identityDocumentsService,
  IdentityServiceError,
} from '../../services/database';
import { profilesService } from '../../services/database/profiles';
import { isSupabaseConfigured } from '../../services/database/client';
import { isDemoMode } from '../../utils/demoMode';
import type { IdentityDocument } from '../../types';
import { applicationStatusPresentation, pickCurrentDocument } from '../../utils/identity';

const CitizenshipRegistrationScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user, setUser } = useAuthStore();
  const requiresRealServer = isSupabaseConfigured && !isDemoMode();

  const [citizenshipNumber, setCitizenshipNumber] = useState(
    user?.citizenship_number ?? '',
  );
  const [documents, setDocuments] = useState<IdentityDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const citizenshipDocument = pickCurrentDocument(documents, 'CITIZENSHIP');

  const load = useCallback(async () => {
    if (!requiresRealServer || !user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [profile, loadedDocuments] = await Promise.all([
        profilesService.getById(user.id),
        identityDocumentsService.listDocuments(),
      ]);
      setCitizenshipNumber(profile?.citizenship_number ?? citizenshipNumber);
      setDocuments(loadedDocuments);
    } catch (loadError) {
      setError(
        loadError instanceof IdentityServiceError
          ? loadError.userMessage
          : 'Could not load your identity details. Check your connection and try again.',
      );
    } finally {
      setLoading(false);
    }
    // citizenshipNumber is intentionally not a dependency: the server value
    // should load once, not overwrite typing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiresRealServer, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const submit = async () => {
    if (!requiresRealServer) {
      Alert.alert(
        isDemoMode() ? 'Demo mode' : 'Database not configured',
        'No identity document is uploaded and no application is created in this mode.',
      );
      return;
    }
    if (!user?.id) {
      Alert.alert('Not signed in', 'Please sign in before submitting an identity application.');
      return;
    }
    if (!citizenshipNumber.trim()) {
      Alert.alert('Citizenship number required', 'Enter the number printed on your certificate.');
      return;
    }
    if (!citizenshipDocument) {
      Alert.alert(
        'Citizenship document required',
        'Upload a photo of your citizenship document before submitting.',
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await profilesService.update(user.id, {
        citizenship_number: citizenshipNumber.trim(),
      });
      setUser(updated);
      const application = await identityApplicationsService.submitApplication('USER');
      const statusLabel = applicationStatusPresentation(application.status).label;
      Alert.alert(
        'Application recorded',
        `Your citizenship details were saved.\n\nReference: ${application.reference_id}\nStatus: ${statusLabel}\nThe document was stored privately. Nothing was approved automatically.`,
        [
          {
            text: 'View status',
            onPress: () => navigation.navigate('ApplicationStatus', { type: 'USER' }),
          },
          { text: 'Done', onPress: () => navigation.goBack() },
        ],
      );
    } catch (submitError) {
      setError(
        submitError instanceof IdentityServiceError
          ? submitError.userMessage
          : 'Your application could not be submitted. Check your connection and try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const renderUnavailable = () => (
    <Card elevation="sm" style={styles.stateCard}>
      <Text style={styles.stateIcon}>🔒</Text>
      <Text style={styles.stateTitle}>
        {isDemoMode() ? 'No application in demo mode' : 'Identity registration unavailable'}
      </Text>
      <Text style={styles.stateBody}>
        {isDemoMode()
          ? 'Demo mode is local-only. No document is uploaded, no application is created and no status is read from the server.'
          : 'The database is not configured, so identity details cannot be stored. Nothing is simulated.'}
      </Text>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Identity Verification"
        showBack
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {loading && requiresRealServer ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading identity details…</Text>
          </View>
        ) : !requiresRealServer ? (
          renderUnavailable()
        ) : !user?.id ? (
          <Card elevation="sm" style={styles.stateCard}>
            <Text style={styles.stateIcon}>👤</Text>
            <Text style={styles.stateTitle}>Sign in to continue</Text>
            <Text style={styles.stateBody}>
              An authenticated account is required before a document can be uploaded or an
              application submitted.
            </Text>
          </Card>
        ) : (
          <>
            <Card elevation="sm" style={styles.introCard}>
              <Text style={styles.introTitle}>Citizenship details</Text>
              <Text style={styles.introBody}>
                This information is used for registration review only. The uploaded photo is kept
                in a private bucket, never shown on your public profile, and never treated as a
                verified identity automatically.
              </Text>
            </Card>

            <Card elevation="sm" style={styles.formCard}>
              <Input
                label="Citizenship number"
                value={citizenshipNumber}
                onChangeText={setCitizenshipNumber}
                placeholder="As printed on your citizenship certificate"
                autoCapitalize="characters"
              />
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
            </Card>

            {error && <Text style={styles.error}>{error}</Text>}

            <Button
              title="Save & submit for review"
              onPress={() => void submit()}
              fullWidth
              size="lg"
              loading={saving}
              disabled={saving || documentBusy || !citizenshipNumber.trim() || !citizenshipDocument}
            />
            <Text style={styles.footerNote}>
              Status after submission: Pending verification. Approval is a separate reviewer
              action and is not available from this screen.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl * 2,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  stateCard: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    marginTop: spacing.lg,
  },
  stateIcon: { fontSize: 42, marginBottom: spacing.md },
  stateTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  stateBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: spacing.sm,
  },
  introCard: {
    backgroundColor: colors.blueLight,
    marginBottom: spacing.lg,
  },
  introTitle: {
    ...typography.h4,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  introBody: {
    ...typography.bodySmall,
    color: colors.text,
    lineHeight: 20,
  },
  formCard: { marginBottom: spacing.lg },
  error: {
    ...typography.bodySmall,
    color: colors.error,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  footerNote: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: spacing.md,
  },
});

export default CitizenshipRegistrationScreen;
