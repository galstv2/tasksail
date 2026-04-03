import { useCallback, useEffect, useState } from 'react';

import type { ReinforcementRealignmentSessionEntry } from '../../shared/desktopContract';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { desktopShellClient } from '../services/desktopShellClient';

export type ActiveWorkGuardState =
  | { status: 'loading' }
  | { status: 'allowed' }
  | { status: 'blocked'; message: string; activeTaskId: string | null };

export type StartRealignmentState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'started'; session: ReinforcementRealignmentSessionEntry }
  | { status: 'error'; message: string };

export type UseActiveWorkGuardResult = {
  guard: ActiveWorkGuardState;
  recheck: () => void;
  startState: StartRealignmentState;
  startRealignment: (contextPackDir: string, triggerTaskId: string) => void;
};

export function useActiveWorkGuard(
  hasActiveContextPack: boolean,
  client: DesktopShellClient = desktopShellClient,
): UseActiveWorkGuardResult {
  const [guard, setGuard] = useState<ActiveWorkGuardState>({ status: 'loading' });
  const [startState, setStartState] = useState<StartRealignmentState>({ status: 'idle' });

  const check = useCallback(async () => {
    if (!hasActiveContextPack) {
      setGuard({ status: 'allowed' });
      return;
    }
    setGuard({ status: 'loading' });
    const result = await client.checkActiveWorkGuard();
    if (result.ok && result.response.action === 'reinforcement.checkActiveWorkGuard') {
      if (result.response.allowed) {
        setGuard({ status: 'allowed' });
      } else {
        setGuard({
          status: 'blocked',
          message: result.response.message,
          activeTaskId: result.response.activeTaskId,
        });
      }
    } else if (!result.ok) {
      setGuard({
        status: 'blocked',
        message: result.error,
        activeTaskId: null,
      });
    }
  }, [hasActiveContextPack, client]);

  useEffect(() => {
    check().catch(() => {});
  }, [check]);

  const startRealignment = useCallback(
    async (contextPackDir: string, triggerTaskId: string) => {
      setStartState({ status: 'starting' });
      const result = await client.startRealignment({ contextPackDir, triggerTaskId });
      if (result.ok && result.response.action === 'reinforcement.startRealignment') {
        setStartState({ status: 'started', session: result.response.session });
      } else if (!result.ok) {
        setStartState({ status: 'error', message: result.error });
        // Active work may have appeared between the guard check and the start call
        check().catch(() => {});
      }
    },
    [client, check],
  );

  return { guard, recheck: check, startState, startRealignment };
}
