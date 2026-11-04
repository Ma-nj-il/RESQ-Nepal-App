import { AppText } from '../../components/ui/AppText';
import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal} from 'react-native';
import { Button } from '../../components/ui';
import { colors, spacing, typography, radii, shadows } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/auth/authService';

interface LogoutScreenProps {
  visible: boolean;
  onClose: () => void;
}

export const LogoutScreen: React.FC<LogoutScreenProps> = ({ visible, onClose }) => {
  const { logout } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  const handleLogout = useCallback(async () => {
    setError(null);
    try {
      await authService.signOut();
    } catch {
      setError('The saved session could not be removed. Please try again.');
      return;
    }
    logout();
    onClose();
    // AppNavigator swaps back to the auth stack automatically.
  }, [logout, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <AppText style={styles.title}>Logout</AppText>
          <AppText style={styles.message}>Sure you want to log out?</AppText>
          {error && <AppText style={styles.error}>{error}</AppText>}

          <View style={styles.buttonContainer}>
            <Button
              title="Cancel"
              variant="outline"
              size="md"
              onPress={handleCancel}
              style={styles.cancelButton}
            />
            <Button
              title="Yes, Logout"
              variant="danger"
              size="md"
              onPress={handleLogout}
              style={styles.logoutButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    ...shadows.lg,
  },
  title: { ...typography.h2, marginBottom: spacing.sm },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xxl },
  error: { ...typography.bodySmall, color: colors.error, textAlign: 'center', marginBottom: spacing.md },
  buttonContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
  },
  cancelButton: { flex: 1 },
  logoutButton: { flex: 1 },
});
