import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ContextPackCatalogEntry,
  ContextPackListResponse,
  ContextPackReseedExecutionResult,
  ContextPackSwitchExecutionResult,
  WorkspaceScopeMode,
} from '../../shared/desktopContract';
import {
  isContextPackSwitchResponse,
  isContextPackReseedResponse,
} from '../../shared/desktopContractTypeGuards';
import { useToastContext } from '../contexts/ToastContext';
import { summarizeSwitchResult, summarizeReseedResult } from '../selectors/contextPackSidebarModel';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { formatIpcError, normalizeIpcThrownError, IpcTimeoutError } from '../services/ipcErrorHelpers';
import { useIpcCall } from './useIpcCall';

export type SwitchingStateSnapshot = {
  selectedContextPackDir: string;
  catalogResponse: ContextPackListResponse | null;
  scopeMode: WorkspaceScopeMode;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
};

type RefreshOptions = {
  preferredContextPackDir?: string;
  preserveFeedback?: boolean;
};

export type UseContextPackSwitchingResult = {
  actionPending: 'preview' | 'apply' | 'clear' | 'reseed' | null;
  lastResult: ContextPackSwitchExecutionResult | null;
  lastReseedResult: ContextPackReseedExecutionResult | null;
  showMultiPrimaryWarning: boolean;
  setLastResult: (result: ContextPackSwitchExecutionResult | null) => void;
  setLastReseedResult: (result: ContextPackReseedExecutionResult | null) => void;
  dismissMultiPrimaryWarning: () => void;
  runAction: (action: 'preview' | 'apply' | 'clear') => Promise<void>;
  runReseedAction: () => Promise<void>;
};

export function useContextPackSwitching(
  client: DesktopShellClient,
  getState: () => SwitchingStateSnapshot,
  setError: (error: string) => void,
  setMessage: (message: string) => void,
  refreshCatalog: (options?: RefreshOptions) => Promise<void>,
): UseContextPackSwitchingResult {
  const [actionPending, setActionPending] = useState<
    'preview' | 'apply' | 'clear' | 'reseed' | null
  >(null);
  const [lastResult, setLastResult] =
    useState<ContextPackSwitchExecutionResult | null>(null);
  const [lastReseedResult, setLastReseedResult] =
    useState<ContextPackReseedExecutionResult | null>(null);
  const [showMultiPrimaryWarning, setShowMultiPrimaryWarning] = useState(false);
  const { addToast } = useToastContext();
  const { call } = useIpcCall(setError);

  const runAction = useCallback(
    async (action: 'preview' | 'apply' | 'clear'): Promise<void> => {
      const {
        selectedContextPackDir,
        catalogResponse,
        scopeMode,
        selectedRepoIds,
        selectedFocusIds,
      } = getState();
      const hasActiveContextPack = Boolean(catalogResponse?.activeContextPackDir);

      if (action !== 'clear' && selectedContextPackDir.length === 0) {
        setError('Select a context pack before running workspace actions.');
        return;
      }
      if (action === 'clear' && !hasActiveContextPack) {
        setError('No active context pack is currently applied.');
        return;
      }

      const selectedPack = catalogResponse?.contextPacks.find(
        (entry: ContextPackCatalogEntry) =>
          entry.contextPackDir === selectedContextPackDir,
      );
      if (
        action !== 'clear' &&
        selectedPack?.estateType === 'distributed-platform' &&
        selectedPack.focusTargets.length > 0 &&
        selectedRepoIds.length === 0
      ) {
        setError('Select at least one working focus repo before running distributed activation.');
        return;
      }
      if (
        action !== 'clear' &&
        selectedPack &&
        selectedPack.estateType !== 'distributed-platform' &&
        selectedPack.focusTargets.length > 0 &&
        selectedFocusIds.length === 0
      ) {
        setError('Select at least one working focus area before running monolith activation.');
        return;
      }
      if (
        action !== 'clear' &&
        selectedPack
      ) {
        let hasTypedTargets = false;
        let selectedPrimaryCount = 0;
        const selectedIds = selectedPack.estateType === 'distributed-platform'
          ? selectedRepoIds
          : selectedFocusIds;
        for (const t of selectedPack.focusTargets) {
          if (t.repositoryType !== null) hasTypedTargets = true;
          if (t.repositoryType === 'primary' && selectedIds.includes(t.focusId)) {
            selectedPrimaryCount++;
          }
        }
        if (hasTypedTargets && selectedPrimaryCount !== 1) {
          setShowMultiPrimaryWarning(true);
          return;
        }
      }

      setActionPending(action);
      try {
        const result =
          action === 'preview'
            ? await client.previewContextPackSwitch(
                selectedContextPackDir,
                scopeMode,
                selectedRepoIds,
                selectedFocusIds,
              )
            : action === 'apply'
              ? await client.applyContextPackSwitch(
                  selectedContextPackDir,
                  scopeMode,
                  selectedRepoIds,
                  selectedFocusIds,
                )
              : await client.clearActiveContextPack();

        if (!result.ok) {
          setError(formatIpcError(result));
          setLastResult(result.contextPackResult ?? null);
          setMessage('Context-pack workspace action failed.');
          await refreshCatalog({ preserveFeedback: true }).catch(() => {});
          return;
        }

        if (!isContextPackSwitchResponse(result.response)) {
          setError('Context-pack workspace action returned an unexpected response.');
          setMessage('Context-pack workspace action failed.');
          return;
        }

        setError('');
        setLastResult(result.response.result);
        setMessage(result.response.message);

        if (action === 'apply' || action === 'clear') {
          await refreshCatalog({
            preferredContextPackDir:
              action === 'apply' ? selectedContextPackDir : undefined,
            preserveFeedback: true,
          });
        }
      } catch (error: unknown) {
        const msg = error instanceof IpcTimeoutError
          ? `${(error as IpcTimeoutError).message} The action may still be running — click Refresh to check the current state.`
          : normalizeIpcThrownError(error, 'Context-pack workspace action failed unexpectedly.');
        setError(msg);
        setMessage('Context-pack workspace action failed.');
        await refreshCatalog({ preserveFeedback: true }).catch(() => {});
      } finally {
        setActionPending(null);
      }
    },
    [client, getState, setError, setMessage, refreshCatalog],
  );

  const runReseedAction = useCallback(async (): Promise<void> => {
    const { selectedContextPackDir } = getState();

    if (selectedContextPackDir.length === 0) {
      setError('Select a context pack before reseeding pack memory.');
      return;
    }

    setActionPending('reseed');
    try {
      const callResult = await call(
        () => client.reseedContextPack(selectedContextPackDir),
        { validate: isContextPackReseedResponse, label: 'context-pack reseed' },
      );

      if (!callResult.ok) {
        setMessage('Context-pack reseed failed.');
        return;
      }

      setLastReseedResult(callResult.response.result);
      setMessage(callResult.response.message);

      await refreshCatalog({
        preferredContextPackDir: selectedContextPackDir,
        preserveFeedback: true,
      });
    } catch (error: unknown) {
      setError(normalizeIpcThrownError(error, 'Context-pack reseed failed unexpectedly.'));
      setMessage('Context-pack reseed failed.');
    } finally {
      setActionPending(null);
    }
  }, [client, getState, setMessage, refreshCatalog, call]);

  const prevLastResultRef = useRef(lastResult);
  const prevLastReseedResultRef = useRef(lastReseedResult);

  useEffect(() => {
    if (lastResult && lastResult !== prevLastResultRef.current) {
      const summary = summarizeSwitchResult(lastResult);
      const warnings = lastResult.warnings.length > 0
        ? ': ' + lastResult.warnings.join(', ')
        : '';
      addToast({
        message: (summary ?? 'Switch completed') + warnings,
        severity: lastResult.ok ? 'success' : 'error',
      });
    }
    prevLastResultRef.current = lastResult;
  }, [lastResult, addToast]);

  useEffect(() => {
    if (lastReseedResult && lastReseedResult !== prevLastReseedResultRef.current) {
      const summary = summarizeReseedResult(lastReseedResult);
      addToast({
        message: summary ?? 'Reseed completed',
        severity: lastReseedResult.overallStatus === 'seeded' ? 'success' : 'warning',
      });
    }
    prevLastReseedResultRef.current = lastReseedResult;
  }, [lastReseedResult, addToast]);

  return {
    actionPending,
    lastResult,
    lastReseedResult,
    showMultiPrimaryWarning,
    setLastResult,
    setLastReseedResult,
    dismissMultiPrimaryWarning: () => setShowMultiPrimaryWarning(false),
    runAction,
    runReseedAction,
  };
}
