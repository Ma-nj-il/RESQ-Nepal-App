import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography, radii } from '../../constants/theme';
import { authService } from '../../services/auth/authService';
import { profilesService } from '../../services/database/profiles';
import { isSupabaseConfigured } from '../../services/database/client';
import { isDemoMode, isValidDemoOtp, DEMO_OTP_CODE } from '../../utils/demoMode';
import { useAuthStore } from '../../store/authStore';
import { User } from '../../types';

interface OTPScreenProps {
  navigation: any;
  route: any;
}

const friendlySendError = (message?: string): string => {
  const m = (message ?? '').toLowerCase();
  if (m.includes('rate limit') || m.includes('too many') || m.includes('security')) {
    return 'Too many codes requested. Please wait a minute and try again.';
  }
  if (m.includes('invalid') && m.includes('phone')) {
    return 'That phone number was rejected. Go back and check it.';
  }
  return message || 'Could not send the code. Check your connection and try again.';
};

const friendlyVerifyError = (message?: string): string => {
  const m = (message ?? '').toLowerCase();
  if (m.includes('expired')) return 'That code has expired. Tap "Resend code" to get a new one.';
  if (m.includes('invalid') || m.includes('token')) return 'That code is not correct. Check the SMS and try again.';
  if (m.includes('rate limit') || m.includes('security')) return 'Too many attempts. Please wait a moment and try again.';
  return message || 'Verification failed. Check your connection and try again.';
};

const OTPScreen: React.FC<OTPScreenProps> = ({ navigation, route }) => {
  const { phone } = route.params || { phone: '' };
  const { setUser, setMode, setAuthenticated } = useAuthStore();
  const [otp, setOtp] = useState(['', '', '', '']);
  const [timer, setTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSending, setIsSending] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(React.ComponentRef<typeof TextInput> | null)[]>([]);
  const verifyingRef = useRef(false);
  const sentOnceRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const sendCode = useCallback(
    async (isResend: boolean) => {
      setIsSending(true);
      setError(null);
      const result = await authService.signInWithOtp(phone);
      setIsSending(false);
      if (!result.success) {
        setNotice(null);
        setError(friendlySendError(result.message));
        setCanResend(true);
        return;
      }
      setNotice(`${isResend ? 'A new code was' : 'A 4-digit code was'} sent to ${phone} by SMS.`);
      if (isResend) {
        setTimer(60);
        setCanResend(false);
        setOtp(['', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    },
    [phone],
  );

  useEffect(() => {
    const demoActive = isDemoMode();

    if (demoActive || !isSupabaseConfigured) {
      // Demo mode / Sample mode: no SMS is sent and no account is created.
      // The state updates are deferred so nothing calls setState synchronously
      // inside the effect body.
      void (async () => {
        await Promise.resolve();
        setIsSending(false);
        if (demoActive) {
          setNotice(`Demo mode — enter OTP ${DEMO_OTP_CODE} to continue.`);
        } else {
          setNotice('Sample mode — Supabase is not configured, so no SMS is sent. Enter any 4 digits to preview the flow.');
        }
      })();
      return;
    }
    if (sentOnceRef.current) return;
    sentOnceRef.current = true;
    sendCode(false);
  }, [sendCode]);

  const enterApp = useCallback(
    (userId: string) => {
      (async () => {
        let profile: User | null = null;
        try {
          profile = await profilesService.getById(userId);
        } catch {
          profile = null;
        }
        if (!profile) {
          profile = {
            id: userId,
            full_name: '',
            email: '',
            phone,
            mode: 'user',
            created_at: '',
            updated_at: '',
          };
        }
        setUser(profile);
        if (profile.full_name && profile.full_name.trim()) {
          // Returning user with a completed profile — go straight into the app.
          setMode(profile.mode === 'driver' ? 'driver' : 'user');
          setAuthenticated(true);
        } else {
          // New signup — collect personal info first.
          navigation.navigate('PersonalInfo', { phone });
        }
      })();
    },
    [navigation, phone, setAuthenticated, setMode, setUser],
  );

  const verifyIfComplete = useCallback(
    (nextOtp: string[]) => {
      const code = nextOtp.join('');
      if (code.length !== 4 || verifyingRef.current) return;

      const demoActive = isDemoMode();

      if (demoActive || !isSupabaseConfigured) {
        if (demoActive) {
          // Demo mode: only accept the specific demo OTP
          if (!isValidDemoOtp(code)) {
            setError(`Invalid demo OTP. Please enter ${DEMO_OTP_CODE}.`);
            setOtp(['', '', '', '']);
            inputRefs.current[0]?.focus();
            return;
          }
          // Valid demo OTP — proceed to next screen
          setIsVerifying(false);
          navigation.navigate('PersonalInfo', { phone });
          return;
        }

        // Regular sample mode (no demo flag): accept any 4 digits
        verifyingRef.current = true;
        setIsVerifying(true);
        Alert.alert(
          'Sample mode',
          'Supabase is not configured, so this code was not verified and no account is created. Continuing with the local sample experience.',
          [
            {
              text: 'Continue',
              onPress: () => {
                verifyingRef.current = false;
                setIsVerifying(false);
                navigation.navigate('PersonalInfo', { phone });
              },
            },
          ],
          { cancelable: false },
        );
        return;
      }

      verifyingRef.current = true;
      setIsVerifying(true);
      setError(null);
      (async () => {
        const result = await authService.verifyOtp(phone, code);
        if (!result.success || !result.userId) {
          verifyingRef.current = false;
          setIsVerifying(false);
          setError(friendlyVerifyError(result.message));
          setOtp(['', '', '', '']);
          inputRefs.current[0]?.focus();
          return;
        }
        enterApp(result.userId);
      })();
    },
    [enterApp, navigation, phone],
  );

  const handleBack = () => {
    navigation.goBack();
  };

  const handleOtpChange = (value: string, index: number) => {
    const digits = value.replace(/\D/g, '');
    const newOtp = [...otp];
    newOtp[index] = digits.slice(-1);
    setOtp(newOtp);

    if (digits && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    verifyIfComplete(newOtp);
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleKeypadPress = (key: string) => {
    const currentIndex = otp.findIndex((val) => val === '');
    if (currentIndex !== -1) {
      const newOtp = [...otp];
      newOtp[currentIndex] = key;
      setOtp(newOtp);

      if (currentIndex < 3) {
        inputRefs.current[currentIndex + 1]?.focus();
      }

      verifyIfComplete(newOtp);
    }
  };

  const handleBackspace = () => {
    const lastFilledIndex = otp.map((val, idx) => (val ? idx : -1)).filter((idx) => idx !== -1).pop();
    if (lastFilledIndex !== undefined) {
      const newOtp = [...otp];
      newOtp[lastFilledIndex] = '';
      setOtp(newOtp);
      inputRefs.current[lastFilledIndex]?.focus();
    }
  };

  const handleResend = () => {
    if (!canResend || isSending || isVerifying) return;
    const demoActive = isDemoMode();
    if (demoActive || !isSupabaseConfigured) {
      setTimer(60);
      setCanResend(false);
      setOtp(['', '', '', '']);
      if (demoActive) {
        setNotice(`Demo mode — enter OTP ${DEMO_OTP_CODE} to continue.`);
      } else {
        setNotice('Sample mode — no SMS is sent. Enter any 4 digits to preview the flow.');
      }
      return;
    }
    sendCode(true);
  };

  const keypadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', 'backspace'];

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

        {/* Content */}
        <View style={styles.content}>
          <Text style={styles.heading}>Enter OTP Code 🔒</Text>
          <Text style={styles.subtitle}>
            {isSupabaseConfigured
              ? `Enter the 4-digit code sent to ${phone}.`
              : isDemoMode()
              ? `Demo mode — enter ${DEMO_OTP_CODE} to continue.`
              : 'Sample mode — no SMS is sent. Enter any 4 digits to preview the flow.'}
          </Text>

          {isSending && (
            <View style={styles.sendingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.sendingText}>Sending code...</Text>
            </View>
          )}
          {isDemoMode() && (
            <Text style={styles.demoHintText}>Demo OTP: {DEMO_OTP_CODE}</Text>
          )}
          {notice && <Text style={styles.noticeText}>{notice}</Text>}
          {error && <Text style={styles.errorText}>{error}</Text>}

          {/* OTP Input Boxes */}
          <View style={styles.otpContainer}>
            {otp.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => {
                  inputRefs.current[index] = ref;
                }}
                style={styles.otpInput}
                value={digit}
                onChangeText={(value) => handleOtpChange(value, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                keyboardType="numeric"
                maxLength={1}
                textAlign="center"
                selectTextOnFocus
                editable={!isVerifying}
              />
            ))}
          </View>

          {/* Timer Text */}
          <Text style={styles.timerText}>
            {canResend ? (
              <Text>Resend code available</Text>
            ) : (
              <Text>You can resend the code in {timer} seconds</Text>
            )}
          </Text>

          {/* Resend Button */}
          {canResend && (
            <TouchableOpacity onPress={handleResend} style={styles.resendButton}>
              <Text style={styles.resendText}>Resend code</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Numeric Keypad */}
        <View style={styles.keypadContainer}>
          <View style={styles.keypadGrid}>
            {keypadKeys.map((key) => (
              <TouchableOpacity
                key={key}
                style={styles.keypadKey}
                onPress={() => {
                  if (key === 'backspace') {
                    handleBackspace();
                  } else {
                    handleKeypadPress(key);
                  }
                }}
                activeOpacity={0.6}
              >
                <Text style={styles.keypadText}>
                  {key === 'backspace' ? '⌫' : key}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  heading: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xxl,
    lineHeight: 22,
  },
  sendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  sendingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  noticeText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  demoHintText: {
    ...typography.bodySmall,
    color: colors.primary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
    fontWeight: '600',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  otpInput: {
    width: 56,
    height: 56,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radii.md,
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.input,
  },
  timerText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  resendButton: {
    alignSelf: 'center',
  },
  resendText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  keypadContainer: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  keypadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
  },
  keypadKey: {
    width: 72,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: colors.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keypadText: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
  },
});

export default OTPScreen;
