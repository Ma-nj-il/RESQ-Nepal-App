import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Button, Input, Avatar, Header } from '../../components/ui';
import { colors, spacing, typography, radii} from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { profilesService, isSupabaseConfigured } from '../../services/database';

const genderOptions = ['Male', 'Female', 'Other', 'Prefer not to say'];

export const PersonalInfoScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();

  const [fullName, setFullName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [gender, setGender] = useState(user?.gender || '');
  const [dateOfBirth, setDateOfBirth] = useState(user?.date_of_birth || '');
  const [showGenderPicker, setShowGenderPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [avatarUri, setAvatarUri] = useState<string | undefined>(user?.avatar_url);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!fullName.trim()) newErrors.fullName = 'Full name is required';
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Invalid email format';
    if (!phone.trim()) newErrors.phone = 'Phone number is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [fullName, email, phone]);

  const handleSave = useCallback(async () => {
    if (!validate()) return;
    setIsLoading(true);
    try {
      if (isSupabaseConfigured && user?.id) {
        const updated = await profilesService.update(user.id, {
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          gender: gender || undefined,
          date_of_birth: dateOfBirth || undefined,
          avatar_url: avatarUri,
        });
        // Keep the local session in sync with the saved profile.
        useAuthStore.getState().setUser({ ...user, ...updated });
      }
      Alert.alert(
        'Success',
        isSupabaseConfigured
          ? 'Personal information updated.'
          : 'Sample mode — database not configured, so nothing was saved.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch {
      Alert.alert('Error', 'Failed to update information. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [avatarUri, dateOfBirth, email, fullName, gender, navigation, phone, user, validate]);

  const pickImage = useCallback(async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission needed', 'Camera access is required to take a photo.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
        if (!result.canceled && result.assets[0]) {
          setAvatarUri(result.assets[0].uri);
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission needed', 'Photo library access is required to choose a photo.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
        if (!result.canceled && result.assets[0]) {
          setAvatarUri(result.assets[0].uri);
        }
      }
    } catch {
      Alert.alert('Error', 'Could not open the image picker on this device.');
    }
  }, []);

  const handleImagePicker = useCallback(() => {
    Alert.alert('Change Photo', 'Choose an option', [
      { text: 'Camera', onPress: () => pickImage('camera') },
      { text: 'Gallery', onPress: () => pickImage('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [pickImage]);

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Personal Info" showBack onBack={() => navigation.goBack()} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarContainer}>
            <Avatar name={fullName || 'User'} uri={avatarUri} size="xl" />
            <TouchableOpacity style={styles.cameraButton} onPress={handleImagePicker}>
              <Text style={styles.cameraIcon}>📷</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.avatarHint}>Tap to change photo</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Input
            label="Full Name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Enter your full name"
            error={errors.fullName}
          />

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="Enter your email"
            keyboardType="email-address"
            autoCapitalize="none"
            error={errors.email}
          />

          <Input
            label="Phone Number"
            value={phone}
            onChangeText={setPhone}
            placeholder="+977 XXX XXX XXX"
            keyboardType="phone-pad"
            icon={<Text style={styles.flag}>🇳🇵</Text>}
            error={errors.phone}
          />

          {/* Gender Dropdrop */}
          <TouchableOpacity
            style={styles.dropdown}
            onPress={() => setShowGenderPicker(!showGenderPicker)}
          >
            <Text style={styles.dropdownLabel}>Gender</Text>
            <View style={styles.dropdownRight}>
              <Text style={[styles.dropdownValue, !gender && styles.dropdownPlaceholder]}>
                {gender || 'Select gender'}
              </Text>
              <Text style={styles.dropdownArrow}>▼</Text>
            </View>
          </TouchableOpacity>

          {showGenderPicker && (
            <View style={styles.pickerContainer}>
              {genderOptions.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={styles.pickerOption}
                  onPress={() => {
                    setGender(option);
                    setShowGenderPicker(false);
                  }}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      gender === option && styles.pickerOptionSelected,
                    ]}
                  >
                    {option}
                  </Text>
                  {gender === option && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Date of Birth */}
          <TouchableOpacity
            style={styles.dropdown}
            onPress={() => setShowDatePicker(!showDatePicker)}
          >
            <Text style={styles.dropdownLabel}>Date of Birth</Text>
            <View style={styles.dropdownRight}>
              <Text style={[styles.dropdownValue, !dateOfBirth && styles.dropdownPlaceholder]}>
                {dateOfBirth || 'Select date'}
              </Text>
              <Text style={styles.dropdownArrow}>📅</Text>
            </View>
          </TouchableOpacity>

          {showDatePicker && (
            <View style={styles.datePickerContainer}>
              <Text style={styles.datePickerNote}>
                A full calendar picker is not part of this build. Use “Set Today” or keep the
                field empty — you can update it later from your profile.
              </Text>
              <Button
                title="Set Today"
                variant="outline"
                size="sm"
                onPress={() => {
                  setDateOfBirth(new Date().toISOString().split('T')[0]);
                  setShowDatePicker(false);
                }}
              />
            </View>
          )}
        </View>

        {/* Save Button */}
        <Button
          title="Save"
          variant="primary"
          size="lg"
          fullWidth
          onPress={handleSave}
          loading={isLoading}
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
  avatarContainer: { position: 'relative' },
  cameraButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
  },
  cameraIcon: { fontSize: 16 },
  avatarHint: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.sm },
  form: { paddingHorizontal: spacing.lg },
  flag: { fontSize: 20 },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.input,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  dropdownLabel: { ...typography.bodySmall, fontWeight: '600', color: colors.text },
  dropdownRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dropdownValue: { ...typography.body },
  dropdownPlaceholder: { color: colors.textTertiary },
  dropdownArrow: { fontSize: 12, color: colors.textTertiary },
  pickerContainer: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerOptionText: { ...typography.body },
  pickerOptionSelected: { color: colors.primary, fontWeight: '600' },
  checkmark: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  datePickerContainer: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  datePickerNote: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.sm },
  saveButton: { marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xxxl },
});
