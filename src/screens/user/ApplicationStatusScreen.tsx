import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Badge, Button, Card, Header } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { REQUIRED_IDENTITY_DOCUMENTS, IDENTITY_DOCUMENT_META } from '../../constants/identity';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/auth/authService';
import {
  IdentityServiceError,
  loadIdentityStatus,
  type IdentityStatusBundle,
} from '../../services/database';
import { isSupabaseConfigured } from '../../services/database/client';
import { isDemoMode } from '../../utils/demoMode';
import type {
  IdentityApplicationStatus,
  IdentityApplicationType,
  IdentityDocumentType,
} from '../../types';
import {
  applicationStatusPresentation,
  documentUploadLabel,
  formatIdentityDate,
  maskIdentifier,
  pickCurrentDocument,
} from '../../utils/identity';

const ApplicationStatusScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user, logout } = useAuthStore();

  const applicationType: IdentityApplicationType =
    (route.params?.type as IdentityApplicationType | undefined) ??
    (user?.mode === 'driver' ? 'DRIVER' : 'USER');
  const isDriver = applicationType === 'DRIVER';
  const requiresRealServer = isSupabaseConfigured && !isDemoMode();
  const userId = user?.id;

  const [bundle, setBundle] = useState<IdentityStatusBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (showLoader = true) => {
      if (showLoader) setLoading(true);
      setError(null);
      if (!requiresRealServer || !userId) {
        setBundle(null);
        setLoading(false);
        return;
      }
      try {
        const loaded = await loadIdentityStatus(applicationType, userId);
        setBundle(loaded);
      } catch (loadError) {
        setError(
          loadError instanceof IdentityServiceError
            ? loadError.userMessage
            : 'Could not load your application status. Check your connection and try again.',
        );
      } finally {
        setLoading(false);
      }
    },
    [applicationType, requiresRealServer, userId],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  }, [load]);

  const signInAgain = useCallback(async () => {
    try {
      await authService.signOut();
    } catch {
      // Even if the remote sign-out fails, clear the local session so the
      // user can authenticate again.
    } finally {
      logout();
    }
  }, [logout]);

  const application = bundle?.application ?? null;
  const driver = bundle?.driver ?? null;
  // The submission RPC evaluates the newest vehicle; show the same vehicle so
  // the Blue Book row cannot point at a different record.
  const vehicle =
    bundle?.vehicles
      ?.slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
  const sessionExpired = Boolean(error && /session has expired/i.test(error));

  // drivers.status remains the approval source of truth. The application row
  // mirrors it, but the status screen also tolerates a brief sync delay.
  const effectiveStatus: IdentityApplicationStatus | null = application
    ? isDriver && driver?.status === 'verified'
      ? 'APPROVED'
      : isDriver && driver?.status === 'rejected'
        ? 'REJECTED'
        : application.status
    : null;
  const presentation = applicationStatusPresentation(effectiveStatus);

  const openUpdate = () => {
    if (isDriver) {
      navigation.navigate('DriverRegistration');
    } else {
      navigation.navigate('CitizenshipRegistration');
    }
  };

  const renderDocumentRow = (documentType: IdentityDocumentType) => {
    const meta = IDENTITY_DOCUMENT_META[documentType];
    const current = bundle?.documents
      ? pickCurrentDocument(
          bundle.documents,
          documentType,
          documentType === 'VEHICLE_BLUE_BOOK' ? vehicle?.id : undefined,
        )
      : null;
    const uploaded = Boolean(current);
    return (
      <View key={documentType} style={styles.documentRow}>
        <Text style={styles.documentIcon}>{meta.icon}</Text>
        <View style={styles.documentInfo}>
          <Text style={styles.documentTitle}>{meta.title}</Text>
          <Text style={styles.documentSubtitle}>
            {uploaded
              ? 'Stored privately — upload state is not verification'
              : 'Not uploaded'}
          </Text>
        </View>
        <Badge
          label={uploaded ? documentUploadLabel('UPLOADED') : 'Not uploaded'}
          variant={uploaded ? 'success' : 'neutral'}
        />
      </View>
    );
  };

  const renderDemoState = () => (
    <Card elevation="sm" style={styles.stateCard}>
      <Text style={styles.stateIcon}>🔒</Text>
      <Text style={styles.stateTitle}>No application in this mode</Text>
      <Text style={styles.stateBody}>
        {isDemoMode()
          ? 'Demo mode is local-only. No identity document is uploaded, no application is created and no application status is read from the server.'
          : 'The database is not configured, so no identity application can be stored or read. Nothing is simulated.'}
      </Text>
    </Card>
  );

  const renderEmptyState = () => (
    <Card elevation="sm" style={styles.stateCard}>
      <Text style={styles.stateIcon}>📄</Text>
      <Text style={styles.stateTitle}>No application submitted yet</Text>
      <Text style={styles.stateBody}>
        {isDriver
          ? 'Complete the driver application with your citizenship, driving licence, vehicle and Blue Book details. The application is only submitted after every required document is stored privately.'
          : 'Add your citizenship number and a photo of your citizenship document. Your application is only marked submitted after the server confirms the document was stored.'}
      </Text>
      <Button
        title={isDriver ? 'Open driver application' : 'Add citizenship details'}
        onPress={openUpdate}
        fullWidth
        style={styles.stateButton}
      />
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title={isDriver ? 'Driver Application' : 'Application Status'}
        showBack
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            colors={[colors.primary]}
            enabled={requiresRealServer}
          />
        }
      >
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading application status…</Text>
          </View>
        ) : error ? (
          <Card elevation="sm" style={styles.stateCard}>
            <Text style={styles.stateIcon}>⚠️</Text>
            <Text style={styles.stateTitle}>Status unavailable</Text>
            <Text style={styles.stateBody}>{error}</Text>
            {sessionExpired ? (
              <Button
                title="Sign in again"
                onPress={() => void signInAgain()}
                fullWidth
                style={styles.stateButton}
              />
            ) : (
              <Button
                title="Retry"
                variant="outline"
                onPress={() => void load()}
                fullWidth
                style={styles.stateButton}
              />
            )}
          </Card>
        ) : !requiresRealServer ? (
          renderDemoState()
        ) : !application ? (
          renderEmptyState()
        ) : (
          <>
            <Card elevation="sm" style={styles.statusCard}>
              <View style={styles.statusHeader}>
                <Text style={styles.statusLabel}>
                  {isDriver ? 'Driver application' : 'Patient application'}
                </Text>
                <Badge label={presentation.label} variant={presentation.variant} />
              </View>
              <Text style={styles.reference}>{application.reference_id}</Text>
              <Text style={styles.statusNote}>{presentation.note}</Text>
              {application.status_reason ? (
                <View style={styles.reasonBox}>
                  <Text style={styles.reasonText}>{application.status_reason}</Text>
                </View>
              ) : null}
              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Submitted</Text>
                  <Text style={styles.metaValue}>
                    {formatIdentityDate(application.submitted_at)}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Last update</Text>
                  <Text style={styles.metaValue}>
                    {formatIdentityDate(application.last_status_update)}
                  </Text>
                </View>
              </View>
            </Card>

            <Card elevation="sm" style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Documents</Text>
              <Text style={styles.sectionHint}>
                Upload state is not verification state. Uploading a document does not approve it.
              </Text>
              {REQUIRED_IDENTITY_DOCUMENTS[applicationType].map(renderDocumentRow)}
            </Card>

            <Card elevation="sm" style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Identity details</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Citizenship number</Text>
                <Text style={styles.infoValue}>
                  {maskIdentifier(bundle?.profileCitizenshipNumber)}
                </Text>
              </View>
              {isDriver && (
                <>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Licence number</Text>
                    <Text style={styles.infoValue}>
                      {maskIdentifier(driver?.license_number)}
                    </Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Vehicle plate</Text>
                    <Text style={styles.infoValue}>{vehicle?.plate_number ?? 'Not recorded'}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Driver status</Text>
                    <Text style={styles.infoValue}>
                      {driver?.status === 'verified'
                        ? 'Verified by RESQ Nepal'
                        : driver?.status === 'rejected'
                          ? 'Rejected'
                          : 'Pending verification'}
                    </Text>
                  </View>
                </>
              )}
            </Card>

            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>
                Review is handled by an authorised RESQ Nepal reviewer. This screen does not
                approve, reject or verify anything, and it does not invent review timelines.
              </Text>
            </View>

            {effectiveStatus !== 'APPROVED' && (
              <Button
                title={isDriver ? 'Update driver documents' : 'Update citizenship details'}
                variant="outline"
                onPress={openUpdate}
                fullWidth
              />
            )}
            <Button
              title="Refresh status"
              onPress={() => void load()}
              fullWidth
              style={styles.refreshButton}
            />
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
  stateButton: { marginTop: spacing.xl },
  statusCard: { padding: spacing.lg },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  statusLabel: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  reference: {
    ...typography.h3,
    color: colors.text,
    marginTop: spacing.md,
    letterSpacing: 0.5,
  },
  statusNote: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  reasonBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.redLight,
  },
  reasonText: { ...typography.bodySmall, color: colors.text },
  metaRow: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  metaItem: { flex: 1 },
  metaLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: {
    ...typography.bodySmall,
    color: colors.text,
    marginTop: 2,
    fontWeight: '600',
  },
  sectionCard: { marginTop: spacing.lg },
  sectionTitle: {
    ...typography.h4,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  documentIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  documentInfo: { flex: 1 },
  documentTitle: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  documentSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: { ...typography.bodySmall, color: colors.textSecondary },
  infoValue: {
    ...typography.bodySmall,
    color: colors.text,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  noticeBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.blueLight,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  noticeText: { ...typography.caption, color: colors.text, lineHeight: 18 },
  refreshButton: { marginTop: spacing.md },
});

export default ApplicationStatusScreen;
