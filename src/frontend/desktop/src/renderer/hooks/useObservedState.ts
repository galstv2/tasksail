import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  EnvironmentStatusResponse,
  ObservabilitySnapshotResponse,
} from '../../shared/desktopContract';
import { desktopShellClient, type DesktopShellClient } from '../services/desktopShellClient';
import { normalizeIpcThrownError, withIpcTimeout, DEFAULT_IPC_TIMEOUT_MS } from '../services/ipcErrorHelpers';

const OBSERVED_STATE_POLL_MS = 10 * 1000;

export type UseObservedStateResult = {
  queueStatusMessage: string;
  observability: ObservabilitySnapshotResponse | null;
  environmentStatus: EnvironmentStatusResponse | null;
  contractError: string;
  setContractError: React.Dispatch<React.SetStateAction<string>>;
  refreshObservedState: () => Promise<void>;
};

export function useObservedState(
  refreshKey: unknown,
  client: DesktopShellClient = desktopShellClient,
): UseObservedStateResult {
  const [queueStatusMessage, setQueueStatusMessage] = useState<string>('Loading queue status…');
  const [observability, setObservability] = useState<ObservabilitySnapshotResponse | null>(null);
  const [environmentStatus, setEnvironmentStatus] = useState<EnvironmentStatusResponse | null>(null);
  const [contractError, setContractError] = useState<string>('');
  const generationRef = useRef(0);

  const refreshObservedState = useCallback(async (): Promise<void> => {
    const generation = ++generationRef.current;

    const [queueSettled, environmentSettled, observabilitySettled] = await Promise.allSettled([
      withIpcTimeout(client.getQueueStatus(), DEFAULT_IPC_TIMEOUT_MS, 'getQueueStatus'),
      withIpcTimeout(client.getEnvironmentStatus(), DEFAULT_IPC_TIMEOUT_MS, 'getEnvironmentStatus'),
      withIpcTimeout(client.getObservabilitySnapshot(), DEFAULT_IPC_TIMEOUT_MS, 'getObservabilitySnapshot'),
    ]);

    if (generationRef.current !== generation) return;

    const errors: string[] = [];

    if (queueSettled.status === 'rejected') {
      errors.push(normalizeIpcThrownError(queueSettled.reason, 'Queue status unavailable.'));
    } else if (!queueSettled.value.ok) {
      errors.push(queueSettled.value.error);
    } else if (queueSettled.value.response.action === 'queue.readStatus') {
      setQueueStatusMessage(queueSettled.value.response.message);
    }

    if (observabilitySettled.status === 'rejected') {
      errors.push(normalizeIpcThrownError(observabilitySettled.reason, 'Observability snapshot unavailable.'));
    } else if (!observabilitySettled.value.ok) {
      errors.push(observabilitySettled.value.error);
    } else if (observabilitySettled.value.response.action === 'observability.readSnapshot') {
      setObservability(observabilitySettled.value.response);
    }

    if (environmentSettled.status === 'rejected') {
      errors.push(normalizeIpcThrownError(environmentSettled.reason, 'Environment status unavailable.'));
    } else if (!environmentSettled.value.ok) {
      errors.push(environmentSettled.value.error);
    } else if (environmentSettled.value.response.action === 'environment.readStatus') {
      setEnvironmentStatus(environmentSettled.value.response);
    }

    setContractError(errors.length > 0 ? errors.join('; ') : '');
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    const interval = window.setInterval(() => {
      void refreshObservedState().catch((error: unknown) => {
        if (!cancelled) {
          setContractError(normalizeIpcThrownError(error, 'Observability state unavailable.'));
        }
      });
    }, OBSERVED_STATE_POLL_MS);

    void refreshObservedState().catch((error: unknown) => {
      if (!cancelled) {
        setContractError(normalizeIpcThrownError(error, 'Observability state unavailable.'));
      }
    });
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      generationRef.current++;
    };
  }, [refreshKey, refreshObservedState]);

  return {
    queueStatusMessage,
    observability,
    environmentStatus,
    contractError,
    setContractError,
    refreshObservedState,
  };
}
