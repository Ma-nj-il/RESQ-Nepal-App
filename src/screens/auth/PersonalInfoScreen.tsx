import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { Button, Input } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';
import { profilesService } from '../../services/database/profiles';
import { isSupabaseConfigured } from '../../services/database/client';

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
  const [saving, setSaving] = useState(false);

  const handleBack = () => {
    navigation.goBack();
  };

  const handleContinue = async () => {
    const dob = dateOfBirth.trim();
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      Alert.alert('Check date of birth', 'Please enter your date of birth as YYYY-MM-DD.');
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
    try {
      // Persist the details collected here to the signed-in user's profile.
      const updated = await profilesService.update(userId, {
        full_name: fullName.trim(),
        email: email.trim(),
        ...(selectedGender ? { gender: selectedGender } : {}),
        ...(dob ? { date_of_birth: dob } : {}),
      });
      setUser(updated);
      navigation.navigate('LocationPermission');
    } catch {
      Alert.alert('Could not save your details', 'Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarPress = () => {
    Alert.alert(
      'Profile photo',
      'Uploading a profile photo is not available in this build — file storage is not configured yet. You can add a photo once storage is enabled.',
    );
  };

  const isFormValid = fullName.trim() && email.trim() && selectedGender;

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
    paddingBottom: spacing.xl,
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
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
});

export default PersonalInfoScreen;
