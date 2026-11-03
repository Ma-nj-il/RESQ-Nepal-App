import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import { Button } from '../ui/Button';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { BackendError } from '../../services/api/backend/errors';
import { getNativeBackendRuntime, type NativeBackendRuntime } from '../../services/api/backend/nativeRuntime';
import type { BackendPreviewConfig } from '../../services/api/backend/previewConfig';
import { BackendAccountPreview } from './BackendAccountPreview';

type Config = Exclude<BackendPreviewConfig, { kind: 'disabled' }>;

export default function BackendPreview({ config }: { config: Config }) {
  const [runtime, setRuntime] = useState<NativeBackendRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (config.kind !== 'enabled') return;
    let active = true;
    void getNativeBackendRuntime(config.scope).then((value) => {
      if (active) { setRuntime(value); setError(null); }
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof BackendError ? failure.message : 'Unable to initialize secure sign-in.');
    });
    return () => { active = false; };
  }, [config, attempt]);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.previewLabel}>Backend API development preview</Text>
      {config.kind === 'invalid' ? <Text style={styles.error} accessibilityRole="alert">{config.message}</Text> :
        error ? <View style={styles.form}>
          <Text style={styles.error} accessibilityRole="alert">{error}</Text>
          <Button title="Retry initialization" onPress={() => setAttempt((value) => value + 1)} />
        </View> : runtime ? <AuthPanel runtime={runtime} /> :
          <ActivityIndicator accessibilityLabel="Preparing secure sign-in" color={colors.primary} />}
    </SafeAreaView>
  );
}

function AuthPanel({ runtime }: { runtime: NativeBackendRuntime }) {
  const state = useStore(runtime.auth.store);
  useEffect(() => { void runtime.auth.start(); }, [runtime]);
  if (state.status === 'authenticated' && state.profile && state.identity) {
    return <BackendAccountPreview key={state.identity.sessionId} runtime={runtime} profile={state.profile} />;
  }
  return <SignInForm runtime={runtime} />;
}

function SignInForm({ runtime }: { runtime: NativeBackendRuntime }) {
  const state = useStore(runtime.auth.store);
  const [phone, setPhone] = useState('+977');
  const [otp, setOtp] = useState('');
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const waiting = ['idle', 'restoring', 'requestingCode', 'verifying', 'loadingProfile', 'signingOut'].includes(state.status);
  const cooldown = Math.max(0, Math.ceil((state.retryAt - clock) / 1000));
  const expired = state.challenge !== null && Date.parse(state.challenge.expiresAt) <= clock;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Sign in with your phone</Text>
        <Text style={styles.description}>Use an account in the configured test backend.</Text>
        {waiting && <ActivityIndicator color={colors.primary} accessibilityLabel="Sign-in request in progress" />}
        {state.notice && <Text style={styles.description} accessibilityLiveRegion="polite">{state.notice}</Text>}
        {state.issue && <View>
          <Text style={styles.error} accessibilityRole="alert">{state.issue.message}</Text>
          {state.issue.requestId && <Text style={styles.description}>Request: {state.issue.requestId}</Text>}
        </View>}
        {state.status === 'profileError' ? <>
          <Text style={styles.description}>Your session exists, but the account profile has not loaded.</Text>
          <Button title="Retry profile" onPress={() => { void runtime.auth.retryProfile(); }} />
          <Button title="Sign out" variant="outline" onPress={() => { void runtime.auth.logout(); }} />
        </> : <>
          <Text style={styles.label}>Phone number including country code</Text>
          <TextInput
            style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad"
            autoComplete="tel" autoCorrect={false} maxLength={16}
            accessibilityLabel="Phone number including country code"
            editable={state.status === 'signedOut'}
          />
          <Button title={cooldown > 0 ? `Request code in ${cooldown}s` : state.challenge ? 'Resend code' : 'Request code'}
            disabled={waiting || cooldown > 0 || !/^\+[1-9]\d{7,14}$/.test(phone)}
            onPress={() => { setOtp(''); void runtime.auth.requestCode(phone); }} />
          {state.challenge && <>
            <Text style={styles.label}>Six-digit code</Text>
            <TextInput
              style={styles.input} value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, ''))}
              keyboardType="number-pad" autoComplete="one-time-code" maxLength={6}
              autoCorrect={false} accessibilityLabel="Six-digit verification code" editable={!waiting && !expired}
            />
            {expired && <Text style={styles.error}>This code has expired. Request a new code.</Text>}
            <Button title="Verify code" disabled={waiting || expired || !/^\d{6}$/.test(otp) ||
              (state.issue?.code === 'RATE_LIMIT.EXCEEDED' && cooldown > 0)}
              onPress={() => { const code = otp; setOtp(''); void runtime.auth.verifyCode(code); }} />
            <Button title="Use another phone number" variant="ghost" disabled={waiting}
              onPress={() => { setOtp(''); runtime.auth.changePhone(); }} />
          </>}
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  previewLabel: { ...typography.caption, color: colors.textSecondary, padding: spacing.lg },
  form: { padding: spacing.xl, gap: spacing.lg, flexGrow: 1 },
  heading: { ...typography.h2, color: colors.text },
  description: { ...typography.bodySmall, color: colors.textSecondary },
  label: { ...typography.body, color: colors.text },
  input: { ...typography.body, color: colors.text, backgroundColor: colors.input, padding: spacing.lg, borderRadius: radii.md, minHeight: 48 },
  error: { ...typography.bodySmall, color: colors.primaryDark, padding: spacing.sm },
});
