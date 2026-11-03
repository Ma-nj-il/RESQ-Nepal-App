import { useEffect, useRef, useState } from 'react';
import { CommandIntent, type IntentIdentity } from '../../services/api/backend/commandIntent';
import { BackendError } from '../../services/api/backend/errors';

/** Keeps the command body/key/version together until a server-confirmed outcome. */
export function useBackendCommand(generateId: () => string) {
  const active = useRef(true);
  const pending = useRef<{ run: () => Promise<void> } | null>(null);
  const executing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const retry = async () => {
    if (executing.current || !pending.current) return;
    executing.current = true;
    setBusy(true);
    try { await pending.current.run(); }
    finally { executing.current = false; if (active.current) setBusy(false); }
  };

  function submit<T, R>(value: T, send: (value: T, identity: IntentIdentity) => Promise<R>,
    confirmed: (result: R) => void, expectedVersion?: number) {
    if (pending.current) return;
    const intent = new CommandIntent(value, send, generateId, expectedVersion);
    pending.current = { run: async () => {
      try {
        const result = await intent.run();
        pending.current = null;
        if (active.current) {
          setUnresolved(false);
          setNotice('Server confirmed the request.');
          confirmed(result);
        }
      } catch (error) {
        if (intent.canReplace) pending.current = null;
        if (active.current) {
          setUnresolved(pending.current !== null);
          const message = error instanceof BackendError
            ? `${error.message}${error.code === 'REQUEST.STALE_VERSION' ? ' Refresh the resource before submitting a revised request.' : ''}`
            : 'The request outcome is unknown.';
          setNotice(pending.current ? `${message} Retry the same request or check its server outcome before starting another.` : message);
        }
      }
    } };
    setUnresolved(true);
    setNotice(null);
    void retry();
  }
  return { submit, retry, busy, unresolved, notice };
}
