import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { NativeBackendRuntime } from '../../services/api/backend/nativeRuntime';

export function BackendEnrollmentPreview({ runtime }: { runtime: NativeBackendRuntime }) {
  const enrollment = useMemo(() => runtime.security.createEnrollment(), [runtime]);
  const state = useSyncExternalStore(enrollment.subscribe, enrollment.getSnapshot, enrollment.getSnapshot);
  const [label, setLabel] = useState('RESQ authenticator');
  const [code, setCode] = useState('');
  useEffect(() => {
    const stop = enrollment.connect();
    enrollment.setActive(AppState.currentState === 'active');
    const conceal = () => { setCode(''); enrollment.setActive(false); };
    const change = AppState.addEventListener('change', value => {
      if (value === 'active') enrollment.setActive(true); else conceal();
    });
    const blur = AppState.addEventListener('blur', conceal);
    const focus = AppState.addEventListener('focus', () => enrollment.setActive(AppState.currentState === 'active'));
    return () => { change.remove(); blur.remove(); focus.remove(); stop(); };
  }, [enrollment]);
  const busy = ['starting', 'verifying'].includes(state.status);
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header">Enroll an authenticator</Text>
    {state.message && <Text accessibilityRole="alert">{state.message}</Text>}
    {['idle', 'error', 'complete'].includes(state.status) && <>
      <Input label="Authenticator label" accessibilityLabel="Authenticator label" value={label} onChangeText={setLabel} maxLength={160} />
      <Button title="Start authenticator enrollment" onPress={() => { setCode(''); void enrollment.start(label); }} />
    </>}
    {state.status === 'pending' && <>
      <Text>Add a time-based account in your authenticator using this setup key. The key is hidden when you leave this app.</Text>
      {state.sharedSecret ? <Text accessibilityLabel={`Authenticator setup key: ${state.sharedSecret}`}>{state.sharedSecret}</Text> :
        <Text>Setup key hidden. Enter a code from the authenticator you configured.</Text>}
      <Text>Expires: {state.expiresAt}</Text>
      <Input label="New authenticator code" accessibilityLabel="New authenticator code" value={code} onChangeText={setCode}
        keyboardType="number-pad" secureTextEntry autoCorrect={false} maxLength={6} />
      <Button title="Confirm enrollment" disabled={!/^\d{6}$/.test(code)} onPress={() => {
        const entered = code; setCode(''); void enrollment.verify(entered);
      }} />
    </>}
    {busy && <Text accessibilityLiveRegion="polite">Waiting for the server…</Text>}
    {state.status !== 'idle' && <Button title="Close enrollment" variant="ghost" onPress={() => { setCode(''); enrollment.cancel(); }} />}
    <Text>Existing factors require current authenticator verification before adding another. Enrollment secrets are kept only on this screen.</Text>
  </View>;
}
