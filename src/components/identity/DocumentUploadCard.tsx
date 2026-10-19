import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { IdentityDocument, IdentityDocumentType } from '../../types';
import { IDENTITY_DOCUMENT_META, MAX_IDENTITY_DOCUMENT_BYTES } from '../../constants/identity';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { identityDocumentsService, IdentityServiceError } from '../../services/database';
import {
  documentUploadLabel,
  formatDocumentSize,
  validateDocumentAsset,
} from '../../utils/identity';

type LocalUploadState = 'idle' | 'uploading' | 'failed';

interface DocumentUploadCardProps {
  documentType: IdentityDocumentType;
  existing?: IdentityDocument | null;
  driverId?: string | null;
  vehicleId?: string | null;
  required?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onUploaded: (document: IdentityDocument) => void;
  onRemoved?: (document: IdentityDocument) => void;
  onBusyChange?: (busy: boolean) => void;
}

export const DocumentUploadCard: React.FC<DocumentUploadCardProps> = ({
  documentType,
  existing,
  driverId,
  vehicleId,
  required = true,
  disabled = false,
  disabledReason,
  onUploaded,
  onRemoved,
  onBusyChange,
}) => {
  const meta = IDENTITY_DOCUMENT_META[documentType];
  const [localState, setLocalState] = useState<LocalUploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  // `undefined` means "use the latest prop"; a concrete value is the local
  // result of an upload/removal. This avoids a setState-in-effect reset.
  const [localDocument, setLocalDocument] = useState<IdentityDocument | null | undefined>(
    undefined,
  );
  const attached = localDocument === undefined ? existing ?? null : localDocument;

  const uploaded = attached?.upload_status === 'UPLOADED';
  const busy = localState === 'uploading';

  const setBusy = (value: boolean) => {
    onBusyChange?.(value);
  };

  const pick = async (source: 'camera' | 'library') => {
    if (disabled || busy) return;
    setError(null);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            'Camera permission needed',
            'Camera access is needed to photograph the identity document. You can also choose an existing photo.',
          );
          return;
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            'Photo permission needed',
            'Photo access is needed to choose an image of the identity document.',
          );
          return;
        }
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              allowsEditing: false,
              quality: 0.65,
              base64: true,
              exif: false,
            })
          : await ImagePicker.launchImageLibraryAsync({
              allowsEditing: false,
              quality: 0.65,
              base64: true,
              exif: false,
            });

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const validation = validateDocumentAsset({
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        base64: asset.base64,
      });
      if (!validation.ok) {
        setError(validation.error);
        return;
      }

      setLocalState('uploading');
      setBusy(true);
      const document = await identityDocumentsService.uploadDocument({
        documentType,
        asset: {
          uri: asset.uri,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          fileSize: asset.fileSize,
          base64: asset.base64,
        },
        driverId,
        vehicleId,
      });
      setLocalDocument(document);
      setLocalState('idle');
      setError(null);
      onUploaded(document);
    } catch (uploadError) {
      const message =
        uploadError instanceof IdentityServiceError
          ? uploadError.userMessage
          : 'The document could not be uploaded. Check your connection and try again.';
      setError(message);
      setLocalState('failed');
    } finally {
      setBusy(false);
    }
  };

  const chooseSource = () => {
    if (disabled) {
      Alert.alert(
        'Document upload unavailable',
        disabledReason ||
          'Identity document upload is not available in this build. Nothing was uploaded.',
      );
      return;
    }
    Alert.alert('Add document photo', 'Choose where the photo comes from.', [
      { text: 'Take photo', onPress: () => void pick('camera') },
      { text: 'Choose from library', onPress: () => void pick('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const remove = () => {
    if (!attached || busy) return;
    Alert.alert(
      'Remove this document?',
      'The document will be marked removed and will no longer be used for this application.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              await identityDocumentsService.removeDocument(attached.id);
              onRemoved?.(attached);
              setLocalDocument(null);
              setLocalState('idle');
              setError(null);
            } catch (removeError) {
              setError(
                removeError instanceof IdentityServiceError
                  ? removeError.userMessage
                  : 'The document could not be removed. Please try again.',
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const statusLabel = busy
    ? 'Uploading…'
    : localState === 'failed'
      ? 'Upload failed'
      : documentUploadLabel(attached?.upload_status);

  // A failed replacement must not look successful just because the previous
  // document is still attached.
  const statusTone =
    localState === 'failed'
      ? styles.statusFailed
      : uploaded
        ? styles.statusUploaded
        : styles.statusIdle;

  const statusTextTone =
    localState === 'failed'
      ? styles.statusFailedText
      : uploaded
        ? styles.statusUploadedText
        : styles.statusIdleText;

  return (
    <View style={styles.container} accessibilityLabel={`${meta.title} upload`}>
      <View style={styles.headerRow}>
        <Text style={styles.icon}>{meta.icon}</Text>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{meta.title}</Text>
            {required && <Text style={styles.required}>Required</Text>}
          </View>
          <Text style={styles.description}>{meta.description}</Text>
        </View>
      </View>

      <View style={styles.statusRow}>
        <View style={[styles.statusPill, statusTone]}>
          {busy ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Text style={[styles.statusGlyph, statusTextTone]}>
              {localState === 'failed' ? '!' : uploaded ? '✓' : '○'}
            </Text>
          )}
          <Text style={[styles.statusText, statusTextTone]}>{statusLabel}</Text>
        </View>
        {uploaded && attached && (
          <Text style={styles.fileMeta}>
            {formatDocumentSize(attached.file_size)}
            {attached.created_at ? ' · stored privately' : ''}
          </Text>
        )}
      </View>

      {uploaded ? (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.secondaryAction}
            onPress={chooseSource}
            disabled={busy || disabled}
            accessibilityRole="button"
            accessibilityLabel={`Replace ${meta.title}`}
          >
            <Text style={styles.secondaryActionText}>Replace photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.removeAction}
            onPress={remove}
            disabled={busy || disabled}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${meta.title}`}
          >
            <Text style={styles.removeActionText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.uploadAction, disabled && styles.uploadActionDisabled]}
          onPress={chooseSource}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={
            disabled
              ? `${meta.title} upload unavailable: ${disabledReason ?? 'not available'}`
              : localState === 'failed'
                ? `Retry ${meta.title} upload`
                : `Upload ${meta.title}`
          }
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.uploadIcon}>📷</Text>
          )}
          <Text style={styles.uploadActionText}>
            {busy
              ? 'Uploading securely…'
              : localState === 'failed'
                ? 'Retry upload'
                : disabled
                  ? 'Upload unavailable'
                  : 'Add document photo'}
          </Text>
        </TouchableOpacity>
      )}

      {disabled && disabledReason && (
        <Text style={styles.disabledNote}>{disabledReason}</Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.privateNote}>
        Stored in a private bucket. Only you and an authorised reviewer can access it. Maximum{' '}
        {Math.round(MAX_IDENTITY_DOCUMENT_BYTES / (1024 * 1024))} MB.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  icon: {
    fontSize: 24,
    marginTop: 1,
  },
  headerText: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  title: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.text,
  },
  required: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  description: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
  statusIdle: {
    backgroundColor: colors.input,
  },
  statusUploaded: {
    backgroundColor: colors.greenLight,
  },
  statusFailed: {
    backgroundColor: colors.redLight,
  },
  statusGlyph: {
    fontSize: 11,
    fontWeight: '800',
  },
  statusText: {
    ...typography.caption,
    fontWeight: '600',
  },
  statusIdleText: {
    color: colors.textSecondary,
  },
  statusUploadedText: {
    color: colors.success,
  },
  statusFailedText: {
    color: colors.error,
  },
  fileMeta: {
    ...typography.caption,
    color: colors.textTertiary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryActionText: {
    ...typography.buttonSmall,
    color: colors.text,
  },
  removeAction: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
  },
  removeActionText: {
    ...typography.buttonSmall,
    color: colors.error,
  },
  uploadAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 44,
    marginTop: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  uploadActionDisabled: {
    borderColor: colors.border,
    backgroundColor: colors.input,
  },
  uploadIcon: {
    fontSize: 17,
  },
  uploadActionText: {
    ...typography.buttonSmall,
    color: colors.primary,
  },
  disabledNote: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  privateNote: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
});
