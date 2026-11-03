import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../ui/Button';
import type { NativeBackendRuntime } from '../../services/api/backend/nativeRuntime';
import { BackendError } from '../../services/api/backend/errors';
import { BackendEnrollmentPreview } from './BackendEnrollmentPreview';
import { BackendStepUpPreview } from './BackendStepUpPreview';

export function BackendSecurityPreview({ runtime }: { runtime: NativeBackendRuntime }) {
  const [contexts, setContexts] = useState<Awaited<ReturnType<typeof runtime.api.accessContexts>>['data'] | null>(null);
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
    <BackendEnrollmentPreview runtime={runtime} />
    <BackendStepUpPreview runtime={runtime} />
    <Text accessibilityRole="header">Access and authenticator verification</Text>
    {notice && <Text accessibilityRole="alert">{notice}</Text>}
    <Button title="Load current access contexts" disabled={busy} onPress={() => { void run(async () => {
      const { data } = await runtime.api.accessContexts(); if (active.current) setContexts(data);
    }); }} />
    {contexts?.tenantAssignments.map((item) => <Text key={item.assignmentId}>{item.tenantName}: {item.profileName}; {item.scopeType}; valid until {item.validUntil}</Text>)}
    {contexts?.authorityGrants.map((item) => <Text key={item.grantId}>{item.level}: {item.purpose}; expires {item.expiresAt}</Text>)}
    <Text>The server authorizes every operation using current assignments and grants.</Text>
  </View>;
}
