import React, { useCallback } from 'react';
import {
  View,
  Text,
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

  const handleLogout = useCallback(async () => {
    // End the real Supabase session first so the persisted session is
    // cleared; the local store is cleared regardless so the user is not
    // stuck on an authenticated screen.
    try {
      await authService.signOut();
    } catch {
      // Ignore — local sign-out still proceeds.
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
          <Text style={styles.title}>Logout</Text>
          <Text style={styles.message}>Sure you want to log out?</Text>

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
  buttonContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
  },
  cancelButton: { flex: 1 },
  logoutButton: { flex: 1 },
});
