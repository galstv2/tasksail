import { useCallback, useState } from 'react';

import type {
  ComposerStage,
  DesktopActionResponse,
} from '../../../shared/desktopContract';
import { desktopShellClient, type DesktopShellClient } from '../../services/desktopShellClient';
import {
  toPlannerDirectSubmissionDraft,
  type PlannerDraftModel,
} from '../../planner/plannerComposer';
import { useIpcCall } from '../shared/useIpcCall';

export type OperatorMode = 'planning' | 'observation';

export const INITIAL_LAST_ACTION_MESSAGE =
  'No desktop orchestration action has been invoked yet.';

export type UsePlannerFlowResult = {
  lastActionMessage: string;
  submissionPath: string;
  operatorMode: OperatorMode;
  setLastActionMessage: React.Dispatch<React.SetStateAction<string>>;
  setSubmissionPath: React.Dispatch<React.SetStateAction<string>>;
  setOperatorMode: React.Dispatch<React.SetStateAction<OperatorMode>>;
  clearPlannerFlow: () => void;
  runPlannerAction: (draft: PlannerDraftModel, stage: ComposerStage) => Promise<void>;
};

export function usePlannerFlow(
  setContractError: React.Dispatch<React.SetStateAction<string>>,
  client: DesktopShellClient = desktopShellClient,
): UsePlannerFlowResult {
  const [lastActionMessage, setLastActionMessage] = useState<string>(INITIAL_LAST_ACTION_MESSAGE);
  const [submissionPath, setSubmissionPath] = useState<string>('');
  const [operatorMode, setOperatorMode] = useState<OperatorMode>('planning');
  const { call } = useIpcCall(setContractError);

  const clearPlannerFlow = useCallback((): void => {
    setOperatorMode('planning');
    setSubmissionPath('');
    setLastActionMessage(INITIAL_LAST_ACTION_MESSAGE);
  }, []);

  const runPlannerAction = useCallback(
    async (draft: PlannerDraftModel, stage: ComposerStage): Promise<void> => {
      const callResult = await call<DesktopActionResponse>(
        () => client.submitPlannerDraft(toPlannerDirectSubmissionDraft(draft), stage),
        { label: 'planner submission' },
      );
      if (!callResult.ok) return;

      const { response } = callResult;
      setLastActionMessage(response.message);

      if (response.action === 'planner.submitDraft' && response.mode === 'submitted') {
        setSubmissionPath(response.submittedPath ?? 'dropbox/');
        setOperatorMode(response.observationMode ? 'observation' : 'planning');
      }
    },
    [client, call],
  );

  return {
    lastActionMessage,
    submissionPath,
    operatorMode,
    setLastActionMessage,
    setSubmissionPath,
    setOperatorMode,
    clearPlannerFlow,
    runPlannerAction,
  };
}
