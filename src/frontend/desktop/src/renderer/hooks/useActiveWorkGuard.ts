import { useCallback, useEffect, useState } from 'react';

import type { ReinforcementRealignmentSessionEntry } from '../../shared/desktopContract';
import { createLogger } from '../log/logger';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { desktopShellClient } from '../services/desktopShellClient';

export type ActiveWorkGuardState =
  | { status: 'loading' }
  | { status: 'allowed'; hasUnprocessedFeedback: boolean }
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

const log = createLogger('src/renderer/hooks/useActiveWorkGuard');

export function useActiveWorkGuard(
  hasActiveContextPack: boolean,
  client: DesktopShellClient = desktopShellClient,
): UseActiveWorkGuardResult {
  const [guard, setGuard] = useState<ActiveWorkGuardState>({ status: 'loading' });
  const [startState, setStartState] = useState<StartRealignmentState>({ status: 'idle' });

  const check = useCallback(async () => {
    if (!hasActiveContextPack) {
      setGuard({ status: 'allowed', hasUnprocessedFeedback: false });
      return;
    }
    setGuard({ status: 'loading' });
    const result = await client.checkActiveWorkGuard();
    if (result.ok && result.response.action === 'reinforcement.checkActiveWorkGuard') {
      if (result.response.allowed) {
        setGuard({ status: 'allowed', hasUnprocessedFeedback: result.response.hasUnprocessedFeedback });
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
      try {
        const result = await client.startRealignment({ contextPackDir, triggerTaskId });
        if (result.ok && result.response.action === 'reinforcement.startRealignment') {
          setStartState({ status: 'started', session: result.response.session });
        } else if (!result.ok) {
          log.warn('realignment.start.failed', {
            contextPackDir,
            triggerTaskId,
            reason: result.error,
          });
          setStartState({ status: 'error', message: result.error });
          // Active work may have appeared between the guard check and the start call
          check().catch(() => {});
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to start realignment.';
        log.warn('realignment.start.failed', {
          contextPackDir,
          triggerTaskId,
          reason: message,
        });
        setStartState({ status: 'error', message });
      }
    },
    [client, check],
  );

  return { guard, recheck: check, startState, startRealignment };
}
