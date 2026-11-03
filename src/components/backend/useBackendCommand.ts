import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { DurableCommands } from '../../services/api/backend/durableCommands';
import type { CommandInput, CommandName, CommandResult } from '../../services/api/backend/commandRegistry';

/** The module-owned controller survives remounts and restores secure intents after process restart. */
export function useBackendCommand(controller: DurableCommands) {
  const active = useRef(true);
  const state = useStore(controller.store);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  function submit<K extends CommandName>(name: K, value: CommandInput<K>, confirmed: (result: CommandResult<K>) => void, expectedVersion?: number) {
    void controller.submit(name, value, expectedVersion).then((result) => {
      if (active.current) confirmed(result);
    }).catch(() => {});
  }
  return {
    submit,
    retry: () => controller.retry().catch(() => {}),
    busy: ['loading', 'running'].includes(state.status),
    unresolved: state.status !== 'ready',
    notice: state.notice,
  };
}
