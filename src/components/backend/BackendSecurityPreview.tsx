import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { NativeBackendRuntime } from '../../services/api/backend/nativeRuntime';
import { BackendError } from '../../services/api/backend/errors';

export function BackendSecurityPreview({ runtime }: { runtime: NativeBackendRuntime }) {
  const [contexts, setContexts] = useState<Awaited<ReturnType<typeof runtime.api.accessContexts>>['data'] | null>(null);
  const [challenge, setChallenge] = useState<Awaited<ReturnType<typeof runtime.security.beginStepUp>>['data'] | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef(true);
  const pending = useRef(false);
  const retryAt = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    if (Date.now() < retryAt.current) { setNotice('Wait before retrying authentication.'); return; }
    pending.current = true; setBusy(true); setNotice(null);
    try { await work(); } catch (failure) {
      if (failure instanceof BackendError && failure.retryAfterSeconds) retryAt.current = Date.now() + failure.retryAfterSeconds * 1000;
      if (active.current) setNotice(failure instanceof BackendError ? failure.message : 'Unable to verify access.');
    } finally { pending.current = false; if (active.current) setBusy(false); }
  };
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header">Access and authenticator verification</Text>
    {notice && <Text accessibilityRole="alert">{notice}</Text>}
    <Button title="Load current access contexts" disabled={busy} onPress={() => { void run(async () => {
      const { data } = await runtime.api.accessContexts(); if (active.current) setContexts(data);
    }); }} />
    {contexts?.tenantAssignments.map((item) => <Text key={item.assignmentId}>{item.tenantName}: {item.profileName}; {item.scopeType}; valid until {item.validUntil}</Text>)}
    {contexts?.authorityGrants.map((item) => <Text key={item.grantId}>{item.level}: {item.purpose}; expires {item.expiresAt}</Text>)}
    <Text>The server authorizes every operation using current assignments and grants.</Text>
    <Button title="Verify enrolled authenticator" disabled={busy} onPress={() => { setChallenge(null); setCode(''); void run(async () => {
      const { data } = await runtime.security.beginStepUp(); if (active.current) setChallenge(data);
    }); }} />
    {challenge && <View style={{ gap: 8 }}>
      <Input label="Authenticator code" accessibilityLabel="Authenticator code" value={code} onChangeText={setCode}
        keyboardType="number-pad" secureTextEntry maxLength={6} editable={!busy} />
      <Button title="Confirm authenticator code" disabled={busy || !/^\d{6}$/.test(code)} onPress={() => {
        const entered = code; setCode(''); const current = challenge; setChallenge(null);
        void run(async () => {
          if (Date.parse(current.expiresAt) <= Date.now()) throw new BackendError({ code: 'CLIENT.CHALLENGE_EXPIRED', message: 'Start a new verification.' });
          await runtime.security.verifyStepUp(current.challengeId, entered);
          if (active.current) setNotice('Authenticator verified by the server.');
        });
      }} />
    </View>}
  </View>;
}
