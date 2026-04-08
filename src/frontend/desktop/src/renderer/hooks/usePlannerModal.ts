import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ArchivedTaskEntry, LifecycleState, MarkdownFileSelection, StagedDraftContent } from '../../shared/desktopContract';
import { buildChildTaskMarkdownReviewPrompt, buildChildTaskStarterPrompt, buildMarkdownReviewPrompt, PLANNER_SAVE_DRAFT_WORKFLOW } from '../../shared/plannerWorkflow';
import type { PlannerModalProps, PlannerSessionStatus } from '../components/PlannerModal';
import {
  createFollowUpDraft,
  createLocalDraft,
  deriveParentQmdScope,
  normalizeArchivedTaskToFollowUpContext,
  type ComposerStage,
  type PlannerDraftModel,
  type PlannerDraftSeed,
} from '../plannerComposer';
import { buildAppViewModel } from '../selectors/appViewModel';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { normalizeIpcThrownError } from '../services/ipcErrorHelpers';
import { useFollowUpFlow } from './useFollowUpFlow';
import { usePlannerFlow } from './usePlannerFlow';
import { usePlannerStream } from './usePlannerStream';

export type UsePlannerModalResult = {
  plannerModalProps: PlannerModalProps;
  openPlannerModal: () => void;
};

const EMPTY_DRAFT_SEED: PlannerDraftSeed = {
  title: '',
  summary: '',
  desiredOutcome: '',
  constraints: [],
  acceptanceSignals: [],
  planningNotes: '',
  suggestedPath: 'sequential',
};

const DRAFT_READ_POLL_INTERVAL_MS = 100;
const DRAFT_READ_MAX_ATTEMPTS = 20;

export function usePlannerModal(
  client: DesktopShellClient,
  workflowState: LifecycleState | undefined,
  hasActiveContextPack: boolean,
  contractError: string,
  setContractError: Dispatch<SetStateAction<string>>,
  activeContextPackDir: string | null = null,
): UsePlannerModalResult {
  const plannerStream = usePlannerStream();
  const [plannerModalOpen, setPlannerModalOpen] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<PlannerSessionStatus>('idle');
  const startSession = useCallback(() => {
    setSessionStatus('connecting');
    client.startPlannerSession(activeContextPackDir ?? undefined)
      .then((result) => {
        if (!result.ok) {
          setSessionStatus('failed');
          return;
        }
        setSessionStatus('active');
      })
      .catch(() => setSessionStatus('failed'));
  }, [client, activeContextPackDir]);
  const openPlannerModal = useCallback(() => {
    if (!hasActiveContextPack) {
      return;
    }
    setPlannerModalOpen(true);
    startSession();
  }, [hasActiveContextPack, startSession]);
  const resetPlannerState = useCallback(() => {
    setSessionStatus('idle');
    plannerStream.clearConversation();
    setSelectedMarkdownFile(null);
    setStagedDraft(null);
    setDraftError('');
    setAwaitingDraft(false);
    setChildTaskMode(false);
    setSelectedParentTask(null);
    setArchivedTasks([]);
    client.endPlannerSession().catch(() => {});
  }, [client, plannerStream.clearConversation]);

  const closePlannerModal = useCallback(() => {
    setPlannerModalOpen(false);
    resetPlannerState();
  }, [resetPlannerState]);
  const [awaitingDraft, setAwaitingDraft] = useState(false);
  const [stagedDraft, setStagedDraft] = useState<StagedDraftContent | null>(null);
  const [draftError, setDraftError] = useState('');
  const [selectedMarkdownFile, setSelectedMarkdownFile] = useState<MarkdownFileSelection | null>(null);
  const selectedMarkdownFileRef = useRef<MarkdownFileSelection | null>(null);
  selectedMarkdownFileRef.current = selectedMarkdownFile;

  const [childTaskMode, setChildTaskMode] = useState(false);
  const childTaskModeRef = useRef(false);
  childTaskModeRef.current = childTaskMode;
  const [selectedParentTask, setSelectedParentTask] = useState<ArchivedTaskEntry | null>(null);
  const selectedParentTaskRef = useRef<ArchivedTaskEntry | null>(null);
  selectedParentTaskRef.current = selectedParentTask;
  const [archivedTasks, setArchivedTasks] = useState<ArchivedTaskEntry[]>([]);
  const [loadingArchivedTasks, setLoadingArchivedTasks] = useState(false);

  const [composerStage, setComposerStage] = useState<ComposerStage>('compose');
  const [draft, setDraft] = useState<PlannerDraftModel>(() => createLocalDraft(EMPTY_DRAFT_SEED));

  const {
    setLastActionMessage,
    setSubmissionPath,
    setOperatorMode,
    runPlannerAction,
  } = usePlannerFlow(setContractError, client);

  const {
    followUpSourceTaskId,
    runFollowUpAction,
  } = useFollowUpFlow({
    completedTasks: [],
    setDraft,
    setComposerStage,
    setContractError,
    setLastActionMessage,
    setSubmissionPath,
    setOperatorMode,
    client,
  });

  const {
    planningEnabled,
    isFollowUpDraft,
    planningLockReason,
    primaryActionLabel,
    stageCopy,
  } = useMemo(
    () =>
      buildAppViewModel({
        workflowState,
        completedTasks: [],
        followUpSourceTaskId,
        draft,
        composerStage,
        hasActiveContextPack,
      }),
    [composerStage, draft, followUpSourceTaskId, hasActiveContextPack, workflowState],
  );

  const mappedMessages = useMemo(
    () => plannerStream.messages.map((m) => ({ id: m.id, role: m.role, text: m.text })),
    [plannerStream.messages],
  );

  useEffect(() => {
    if (!plannerModalOpen || sessionStatus === 'connecting' || sessionStatus === 'idle') {
      return;
    }

    if (plannerStream.brokerStatus === 'running') {
      setSessionStatus('busy');
      return;
    }

    if (plannerStream.brokerStatus === 'failed') {
      setSessionStatus('failed');
      return;
    }

    setSessionStatus('active');
  }, [plannerModalOpen, plannerStream.brokerStatus, sessionStatus]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        openPlannerModal();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openPlannerModal]);

  const prevContextPackDirRef = useRef(activeContextPackDir);
  useEffect(() => {
    if (prevContextPackDirRef.current === activeContextPackDir) {
      return;
    }
    prevContextPackDirRef.current = activeContextPackDir;
    if (plannerModalOpen) {
      setPlannerModalOpen(false);
    }
    resetPlannerState();
  }, [activeContextPackDir, plannerModalOpen, resetPlannerState]);

  // Fetch archived tasks when child-task mode is toggled on
  useEffect(() => {
    if (!childTaskMode) {
      setArchivedTasks([]);
      setSelectedParentTask(null);
      return;
    }
    let cancelled = false;
    setLoadingArchivedTasks(true);
    client.listArchivedTasks()
      .then((result) => {
        if (cancelled) return;
        if (result.ok && 'response' in result && result.response.action === 'planner.listArchivedTasks') {
          const response = result.response as import('../../shared/desktopContract').PlannerListArchivedTasksResponse;
          setArchivedTasks(response.tasks);
        }
      })
      .catch(() => { if (!cancelled) setArchivedTasks([]); })
      .finally(() => { if (!cancelled) setLoadingArchivedTasks(false); });
    return () => { cancelled = true; };
  }, [childTaskMode, client]);

  const childTaskBlocked = childTaskMode && !selectedParentTask;

  const handleToggleChildTaskMode = useCallback(() => {
    setChildTaskMode((prev) => {
      if (prev) {
        // Toggling off: reset draft back to standard
        setDraft(createLocalDraft(EMPTY_DRAFT_SEED));
      }
      return !prev;
    });
  }, []);

  const handleSelectParentTask = useCallback((task: ArchivedTaskEntry) => {
    setSelectedParentTask(task);
    const followUpContext = normalizeArchivedTaskToFollowUpContext(task);
    setDraft(createFollowUpDraft(followUpContext));

    const starterPrompt = buildChildTaskStarterPrompt({
      parentTaskId: task.taskId,
      parentTaskTitle: task.title,
      rootTaskId: task.rootTaskId || task.taskId,
      parentQmdScope: deriveParentQmdScope(task.contextPackName),
      carryForwardSummary: task.summary,
    });

    void (async () => {
      const result = await client.sendPlannerMessage(starterPrompt);
      if (!result.ok) {
        plannerStream.sendMessage(`[send failed: ${result.error ?? 'unknown error'}]`);
        return;
      }
      plannerStream.sendMessage(`[Child-task mode activated — continuing from ${task.title}]`);
    })();
  }, [client, plannerStream]);

  const handleSendMessage = useCallback(
    (text: string): void => {
      void (async () => {
        let messageToSend = text;
        const attachedFile = selectedMarkdownFileRef.current;

        if (attachedFile) {
          const parentTask = selectedParentTaskRef.current;
          const reviewPrompt = childTaskModeRef.current && parentTask
            ? buildChildTaskMarkdownReviewPrompt(attachedFile.filename, attachedFile.content)
            : buildMarkdownReviewPrompt(attachedFile.filename, attachedFile.content);
          messageToSend = text ? `${reviewPrompt}\n\nAdditional context from the Guide:\n${text}` : reviewPrompt;
        }

        const result = await client.sendPlannerMessage(messageToSend);
        if (!result.ok) {
          plannerStream.sendMessage(`[send failed: ${result.error ?? 'unknown error'}]`);
          return;
        }
        if (attachedFile) {
          setSelectedMarkdownFile(null);
        }
        const displayText = attachedFile
          ? `[Attached ${attachedFile.filename} for review]${text ? `\n${text}` : ''}`
          : text;
        plannerStream.sendMessage(displayText);
        setDraft((prev) => ({ ...prev, summary: prev.summary ? `${prev.summary}\n${displayText}` : displayText }));
      })();
    },
    [plannerStream, client],
  );

  const handleViewDraft = useCallback((): void => {
    setStagedDraft(null);
    setDraftError('');
    setAwaitingDraft(true);
    plannerStream.sendMessage(PLANNER_SAVE_DRAFT_WORKFLOW.guideMessage);

    void (async () => {
      try {
        const saveResult = await client.savePlannerDraft();
        if (!saveResult.ok) {
          setDraftError(saveResult.error);
          return;
        }
        for (let attempt = 0; attempt < DRAFT_READ_MAX_ATTEMPTS; attempt += 1) {
          const readResult = await client.readStagedDraft();
          if (!readResult.ok) {
            setDraftError(readResult.error);
            return;
          }

          const response = readResult.response;
          if (response.action !== 'planner.readStagedDraft') {
            setDraftError('Unexpected staged draft response.');
            return;
          }
          if (response.mode === 'found' && response.draft) {
            setStagedDraft(response.draft);
            return;
          }
          if (response.brokerStatus !== 'running') {
            setDraftError('Lily has not written a draft yet. Try again shortly.');
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, DRAFT_READ_POLL_INTERVAL_MS));
        }

        setDraftError('Lily is still writing the draft. Try again shortly.');
      } catch (error: unknown) {
        setDraftError(normalizeIpcThrownError(error, 'Failed to read staged draft.'));
      } finally {
        setAwaitingDraft(false);
      }
    })();
  }, [plannerStream, client]);

  const refreshStagedDraft = useCallback(async (): Promise<void> => {
    try {
      const readResult = await client.readStagedDraft();
      if (!readResult.ok) {
        setDraftError(readResult.error);
        return;
      }
      const response = readResult.response;
      if (response.action === 'planner.readStagedDraft' && response.mode === 'found' && response.draft) {
        setStagedDraft(response.draft);
      }
    } catch (error: unknown) {
      setDraftError(normalizeIpcThrownError(error, 'Failed to refresh staged draft.'));
    }
  }, [client]);

  const handleFinalizeSpec = useCallback(async (): Promise<void> => {
    try {
      const result = await client.finalizeSpec(childTaskModeRef.current ? 'child-task' : undefined);
      if (!result.ok) {
        setDraftError(result.error);
        return;
      }
      if (result.response.action !== 'planner.finalizeSpec') {
        setDraftError('Unexpected planner finalize response.');
        return;
      }
      setAwaitingDraft(false);
      setDraftError('');
      setStagedDraft(null);
      setSessionStatus(result.response.brokerStatus === 'idle' ? 'idle' : 'active');
    } catch (error: unknown) {
      setDraftError(normalizeIpcThrownError(error, 'Spec finalization failed unexpectedly.'));
    }
  }, [client]);

  const handlePickMarkdownFile = useCallback((): void => {
    void (async () => {
      try {
        const result = await client.pickMarkdownFile();
        if (!result.ok) {
          setDraftError(result.error);
          return;
        }
        const response = result.response;
        if (response.action === 'planner.pickMarkdownFile' && response.mode === 'selected' && response.filename && response.path && response.content) {
          setSelectedMarkdownFile({ filename: response.filename, path: response.path, content: response.content });
          setDraftError('');
          return;
        }
        // Cancelled — no error, no state change
      } catch (error: unknown) {
        setDraftError(normalizeIpcThrownError(error, 'Failed to select Markdown file.'));
      }
    })();
  }, [client]);

  const handleClearSelectedFile = useCallback((): void => {
    setSelectedMarkdownFile(null);
  }, []);

  const handlePreview = useCallback(async (): Promise<void> => {
    setComposerStage('preview');
    if (!planningEnabled) {
      setContractError(planningLockReason);
      return;
    }
    if (!isFollowUpDraft) {
      await runPlannerAction(draft, 'preview');
    } else {
      await runFollowUpAction(draft, 'preview');
    }
  }, [draft, isFollowUpDraft, planningEnabled, planningLockReason, runFollowUpAction, runPlannerAction, setContractError]);

  const handleConfirm = useCallback(async (): Promise<void> => {
    setComposerStage('confirm');
    if (!planningEnabled) {
      setContractError(planningLockReason);
      return;
    }
    if (!isFollowUpDraft) {
      await runPlannerAction(draft, 'confirm');
    } else {
      await runFollowUpAction(draft, 'confirm');
    }
  }, [draft, isFollowUpDraft, planningEnabled, planningLockReason, runFollowUpAction, runPlannerAction, setContractError]);

  const plannerModalProps = useMemo(
    () => ({
      isOpen: plannerModalOpen,
      onClose: closePlannerModal,
      draft,
      composerStage,
      onPreview: handlePreview,
      onConfirm: handleConfirm,
      isFollowUpDraft,
      planningEnabled,
      contractError,
      draftError: draftError || plannerStream.lastError,
      primaryActionLabel,
      stageCopy,
      messages: mappedMessages,
      isStreaming: plannerStream.isStreaming,
      onSendMessage: handleSendMessage,
      sessionStatus,
      onReconnect: startSession,
      awaitingDraft,
      stagedDraft,
      onViewDraft: handleViewDraft,
      onRefreshDraft: refreshStagedDraft,
      onFinalizeSpec: handleFinalizeSpec,
      selectedMarkdownFile,
      onPickMarkdownFile: handlePickMarkdownFile,
      onClearSelectedFile: handleClearSelectedFile,
      childTaskMode,
      onToggleChildTaskMode: handleToggleChildTaskMode,
      archivedTasks,
      selectedParentTask,
      onSelectParentTask: handleSelectParentTask,
      loadingArchivedTasks,
      childTaskBlocked,
    }),
    [plannerModalOpen, closePlannerModal, draft, composerStage, handlePreview, handleConfirm, isFollowUpDraft, planningEnabled, contractError, primaryActionLabel, stageCopy, mappedMessages, plannerStream.isStreaming, plannerStream.lastError, handleSendMessage, sessionStatus, startSession, awaitingDraft, stagedDraft, draftError, handleViewDraft, refreshStagedDraft, handleFinalizeSpec, selectedMarkdownFile, handlePickMarkdownFile, handleClearSelectedFile, childTaskMode, handleToggleChildTaskMode, archivedTasks, selectedParentTask, handleSelectParentTask, loadingArchivedTasks, childTaskBlocked],
  );

  return { plannerModalProps, openPlannerModal };
}
