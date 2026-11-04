import { AppText } from '../../components/ui/AppText';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Avatar, Button, Header, Input } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { UserServiceError } from '../../services/api/userService';
import { authService } from '../../services/auth/authService';
import { useAuthStore } from '../../store/authStore';
import { isDemoMode } from '../../utils/demoMode';
import { isValidNepaliPhone } from '../../utils/format';

const normalizeNepaliPhone = (value: string): string | null => {
  const digits = value.replace(/\D/g, '');
  const localNumber = digits.length === 13 && digits.startsWith('977') ? digits.slice(3) : digits;
  return isValidNepaliPhone(localNumber) ? `+977${localNumber}` : null;
};

export const PersonalInfoScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const user = useAuthStore((state) => state.user);
  const [firstName, setFirstName] = useState(user?.first_name || user?.full_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [originalPhone, setOriginalPhone] = useState(user?.phone || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const remoteUserId =
    user && !isDemoMode() && !user.id.startsWith('demo-') && !user.id.startsWith('local-')
      ? user.id
      : null;

  useEffect(() => {
    if (!remoteUserId) return;

    let active = true;
    void authService
      .getProfile()
      .then((session) => {
        if (!active) return;
        useAuthStore.getState().setUser(session.user);
        setFirstName(session.user.first_name || '');
        setLastName(session.user.last_name || '');
        setPhone(session.user.phone);
        setOriginalPhone(session.user.phone);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof UserServiceError && error.status === 401) {
          useAuthStore.getState().logout();
          Alert.alert('Session expired', 'Please sign in again.');
        } else {
          setFeedback({
            message: error instanceof UserServiceError ? error.message : 'Could not load your latest profile.',
            error: true,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [remoteUserId]);

  const validate = useCallback((): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!firstName.trim()) nextErrors.firstName = 'First name is required';
    if (!lastName.trim()) nextErrors.lastName = 'Last name is required';
    if (!normalizeNepaliPhone(phone)) nextErrors.phone = 'Enter a valid Nepali mobile number';
    if (normalizeNepaliPhone(phone) !== normalizeNepaliPhone(originalPhone) && !currentPassword) {
      nextErrors.currentPassword = 'Current password is required to change your phone number';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [currentPassword, firstName, lastName, originalPhone, phone]);

  const handleSave = useCallback(async () => {
    if (!validate() || !user) return;
    setFeedback(null);

    if (isDemoMode() || user.id.startsWith('demo-') || user.id.startsWith('local-')) {
      const updated = {
        ...user,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        full_name: `${firstName.trim()} ${lastName.trim()}`,
        phone: normalizeNepaliPhone(phone) || phone.trim(),
      };
      useAuthStore.getState().setUser(updated);
      setFeedback({ message: 'Demo profile updated for this session.', error: false });
      return;
    }

    setIsLoading(true);
    try {
      const session = await authService.updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_number: normalizeNepaliPhone(phone) || undefined,
        current_password: currentPassword || undefined,
      });
      useAuthStore.getState().setUser(session.user);
      setOriginalPhone(session.user.phone);
      setCurrentPassword('');
      setFeedback({ message: 'Your user-service profile was saved.', error: false });
      if (Platform.OS !== 'web') Alert.alert('Profile updated', 'Your user-service profile was saved.');
    } catch (error) {
      if (error instanceof UserServiceError && error.status === 401) {
        useAuthStore.getState().logout();
        Alert.alert('Session expired', 'Please sign in again.');
      } else {
        const message =
          error instanceof UserServiceError ? error.message : 'Please check your connection and try again.';
        setFeedback({ message, error: true });
        if (Platform.OS !== 'web') Alert.alert('Could not update profile', message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentPassword, firstName, lastName, phone, user, validate]);

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Personal Info" showBack onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarSection}>
          <Avatar name={user?.full_name || 'User'} uri={user?.avatar_url} size="xl" />
          <AppText style={styles.avatarHint}>
            Profile photo upload is not available in the current user-service API.
          </AppText>
        </View>

        {feedback && (
          <AppText style={[styles.feedback, feedback.error ? styles.feedbackError : styles.feedbackSuccess]}>
            {feedback.message}
          </AppText>
        )}

        <View style={styles.form}>
          <Input
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            autoCapitalize="words"
            error={errors.firstName}
          />
          <Input
            label="Last name"
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
            autoCapitalize="words"
            error={errors.lastName}
          />
          <Input
            label="Email"
            value={user?.email || ''}
            editable={false}
            placeholder="Email"
          />
          <AppText style={styles.readOnlyHint}>Email changes are not supported by this API.</AppText>
          <Input
            label="Phone number"
            value={phone}
            onChangeText={setPhone}
            placeholder="+97798XXXXXXXX"
            keyboardType="phone-pad"
            error={errors.phone}
          />
          <Input
            label="Current password (required only when changing phone)"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            textContentType="password"
            error={errors.currentPassword}
          />
        </View>

        <Button
          title="Save profile"
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => void handleSave()}
          loading={isLoading}
          disabled={isLoading}
          style={styles.saveButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  avatarSection: { alignItems: 'center', paddingVertical: spacing.xxl },
  avatarHint: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.md,
    maxWidth: 280,
    textAlign: 'center',
    lineHeight: 19,
  },
  form: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  readOnlyHint: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  feedback: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    lineHeight: 19,
  },
  feedbackError: { color: colors.error },
  feedbackSuccess: { color: colors.success },
  saveButton: { marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xxxl },
});
