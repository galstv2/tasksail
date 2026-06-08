import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ComposerStage,
  DesktopActionResponse,
} from '../../../shared/desktopContract';
import type { PlannerDraftModel } from '../../planner/plannerComposer';
import {
  createFollowUpDraft,
  toFollowUpDirectSubmissionDraft,
} from '../../planner/plannerComposer';
import { selectFollowUpTask, type CompletedTaskEntry } from '../../selectors/appViewModel';
import { desktopShellClient, type DesktopShellClient } from '../../services/desktopShellClient';
import { useIpcCall } from '../shared/useIpcCall';
import type { OperatorMode } from './usePlannerFlow';

export type FollowUpTask = CompletedTaskEntry;

export type FollowUpPromptState =
  | { kind: 'empty' }
  | {
      kind: 'blocked';
      task: FollowUpTask;
      blockedReason: string;
    }
  | {
      kind: 'ready';
      task: FollowUpTask;
      requestedAdjustment: string;
      parentTaskId: string;
      rootTaskId: string;
      isActive: boolean;
    };

export type UseFollowUpFlowArgs = {
  completedTasks: CompletedTaskEntry[];
  setDraft: React.Dispatch<React.SetStateAction<PlannerDraftModel>>;
  setComposerStage: React.Dispatch<React.SetStateAction<ComposerStage>>;
  setContractError: React.Dispatch<React.SetStateAction<string>>;
  setLastActionMessage: React.Dispatch<React.SetStateAction<string>>;
  setSubmissionPath: React.Dispatch<React.SetStateAction<string>>;
  setOperatorMode: React.Dispatch<React.SetStateAction<OperatorMode>>;
  client?: DesktopShellClient;
};

export type UseFollowUpFlowResult = {
  followUpSourceTaskId: string | null;
  selectedFollowUpCandidateId: string | null;
  selectedFollowUpTask: FollowUpTask | null;
  followUpPromptState: FollowUpPromptState;
  clearFollowUpFlow: () => void;
  selectFollowUpCandidate: (taskId: string) => void;
  startFollowUpPlanning: (taskId?: string) => void;
  runFollowUpAction: (draft: PlannerDraftModel, stage: ComposerStage) => Promise<void>;
};

function selectInitialFollowUpCandidateId(
  completedTasks: CompletedTaskEntry[],
): string | null {
  return (
    completedTasks.find((task) => task.followUpEligible)?.id ??
    completedTasks[0]?.id ??
    null
  );
}

function resolveFollowUpTask(
  completedTasks: CompletedTaskEntry[],
  taskId: string | null,
): FollowUpTask | null {
  if (!taskId) {
    return null;
  }

  return completedTasks.find((task) => task.id === taskId) ?? null;
}

export function deriveFollowUpPromptState(args: {
  completedTasks: CompletedTaskEntry[];
  selectedFollowUpCandidateId: string | null;
  followUpSourceTaskId: string | null;
}): FollowUpPromptState {
  const task = resolveFollowUpTask(args.completedTasks, args.selectedFollowUpCandidateId);

  if (!task) {
    return { kind: 'empty' };
  }

  if (!task.followUpEligible || !task.followUpContext) {
    return {
      kind: 'blocked',
      task,
      blockedReason:
        task.followUpBlockedReason ??
        'Follow-up lineage is unavailable for the selected completed task.',
    };
  }

  return {
    kind: 'ready',
    task,
    requestedAdjustment: task.followUpContext.requestedAdjustment,
    parentTaskId: task.followUpContext.parentTaskId,
    rootTaskId: task.followUpContext.rootTaskId,
    isActive: task.id === args.followUpSourceTaskId,
  };
}

export function useFollowUpFlow({
  completedTasks,
  setDraft,
  setComposerStage,
  setContractError,
  setLastActionMessage,
  setSubmissionPath,
  setOperatorMode,
  client = desktopShellClient,
}: UseFollowUpFlowArgs): UseFollowUpFlowResult {
  const [followUpSourceTaskId, setFollowUpSourceTaskId] = useState<string | null>(null);
  const [selectedFollowUpCandidateId, setSelectedFollowUpCandidateId] = useState<string | null>(
    () => selectInitialFollowUpCandidateId(completedTasks),
  );
  const { call } = useIpcCall(setContractError);

  const selectedFollowUpTask = useMemo(
    () => selectFollowUpTask(completedTasks, followUpSourceTaskId),
    [completedTasks, followUpSourceTaskId],
  );

  const followUpPromptState = useMemo(
    () =>
      deriveFollowUpPromptState({
        completedTasks,
        selectedFollowUpCandidateId,
        followUpSourceTaskId,
      }),
    [completedTasks, followUpSourceTaskId, selectedFollowUpCandidateId],
  );

  useEffect(() => {
    if (
      followUpSourceTaskId &&
      selectedFollowUpCandidateId !== followUpSourceTaskId &&
      resolveFollowUpTask(completedTasks, followUpSourceTaskId)
    ) {
      setSelectedFollowUpCandidateId(followUpSourceTaskId);
      return;
    }

    if (resolveFollowUpTask(completedTasks, selectedFollowUpCandidateId)) {
      return;
    }

    setSelectedFollowUpCandidateId(selectInitialFollowUpCandidateId(completedTasks));
  }, [completedTasks, followUpSourceTaskId, selectedFollowUpCandidateId]);

  const clearFollowUpFlow = useCallback((): void => {
    setFollowUpSourceTaskId(null);
  }, []);

  const selectFollowUpCandidate = useCallback((taskId: string): void => {
    setSelectedFollowUpCandidateId(taskId);
  }, []);

  const startFollowUpPlanning = useCallback(
    (taskId?: string): void => {
      const candidateTaskId = taskId ?? selectedFollowUpCandidateId;
      const task = completedTasks.find((entry) => entry.id === candidateTaskId);

      if (!task?.followUpEligible || !task.followUpContext) {
        setContractError(
          task?.followUpBlockedReason ??
            'Follow-up lineage is unavailable for the selected completed task.',
        );
        return;
      }

      setFollowUpSourceTaskId(task.id);
      setSelectedFollowUpCandidateId(task.id);
      setDraft(createFollowUpDraft(task.followUpContext));
      setComposerStage('compose');
      setOperatorMode('planning');
      setSubmissionPath('');
      setContractError('');
      setLastActionMessage(
        `Follow-up planner prefilled from completed task ${task.id}. Review the child-task draft before submission.`,
      );
    },
    [
      completedTasks,
      setComposerStage,
      setContractError,
      setDraft,
      setLastActionMessage,
      setOperatorMode,
      setSubmissionPath,
      selectedFollowUpCandidateId,
    ],
  );

  const runFollowUpAction = useCallback(
    async (draft: PlannerDraftModel, stage: ComposerStage): Promise<void> => {
      const callResult = await call<DesktopActionResponse>(
        () => client.initiateFollowUp(toFollowUpDirectSubmissionDraft(draft), stage),
        { label: 'follow-up submission' },
      );
      if (!callResult.ok) return;

      const { response } = callResult;
      setLastActionMessage(response.message);

      if (response.action === 'followup.begin' && response.mode === 'submitted') {
        setSubmissionPath(response.submittedPath ?? 'dropbox/');
        setOperatorMode('observation');
      }
    },
    [client, call, setLastActionMessage, setOperatorMode, setSubmissionPath],
  );

  return {
    followUpSourceTaskId,
    selectedFollowUpCandidateId,
    selectedFollowUpTask,
    followUpPromptState,
    clearFollowUpFlow,
    selectFollowUpCandidate,
    startFollowUpPlanning,
    runFollowUpAction,
  };
}
