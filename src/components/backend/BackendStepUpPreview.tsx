import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { NativeBackendRuntime } from '../../services/api/backend/nativeRuntime';

export function BackendStepUpPreview({ runtime }: { runtime: NativeBackendRuntime }) {
  const stepUp = useMemo(() => runtime.security.createStepUp(), [runtime]);
  const state = useSyncExternalStore(stepUp.subscribe, stepUp.getSnapshot, stepUp.getSnapshot);
  const [code, setCode] = useState('');
  useEffect(() => {
    const stop = stepUp.connect(); stepUp.setActive(AppState.currentState === 'active');
    const conceal = () => { setCode(''); stepUp.setActive(false); };
    const change = AppState.addEventListener('change', value => {
      if (value === 'active') stepUp.setActive(true); else conceal();
    });
    const blur = AppState.addEventListener('blur', conceal);
    const focus = AppState.addEventListener('focus', () => stepUp.setActive(AppState.currentState === 'active'));
    return () => { change.remove(); blur.remove(); focus.remove(); stop(); };
  }, [stepUp]);
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header">Verify your enrolled authenticator</Text>
    {state.message && <Text accessibilityRole="alert">{state.message}</Text>}
    {['idle', 'error', 'complete'].includes(state.status) &&
      <Button title="Start authenticator verification" onPress={() => { setCode(''); void stepUp.start(); }} />}
    {state.status === 'pending' && <>
      <Text>Expires: {state.challenge?.expiresAt}</Text>
      <Input label="Authenticator code" accessibilityLabel="Authenticator code" value={code} onChangeText={setCode}
        keyboardType="number-pad" secureTextEntry autoCorrect={false} maxLength={6} />
      <Button title="Confirm authenticator code" disabled={!/^\d{6}$/.test(code)} onPress={() => {
        const entered = code; setCode(''); void stepUp.verify(entered);
      }} />
    </>}
    {['starting', 'verifying'].includes(state.status) && <Text accessibilityLiveRegion="polite">Waiting for the server…</Text>}
    {state.status !== 'idle' && <Button title="Close verification" variant="ghost" onPress={() => { setCode(''); stepUp.cancel(); }} />}
    <Text>Each operation still requires current server authorization.</Text>
  </View>;
}
