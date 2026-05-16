import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ArchivedTaskEntry,
  LifecycleState,
  MarkdownFileSelection,
  PlannerListConversationHistorySummary,
  PlannerFocusValidationIssue,
  PlannerStartSessionDeepFocusSelection,
  StagedDraftContent,
} from '../../shared/desktopContract';
import { PLANNER_FOCUS_FALLBACK_MESSAGE } from '../../shared/desktopContract';

// Soft, informational fallback notices auto-dismiss after this delay so they
// don't sit in the modal forever. Hard errors (validation, IPC failures) are
// still shown until the operator acts.
const PLANNER_FOCUS_FALLBACK_DISMISS_MS = 5000;
import type { PlannerConversationRecord, PlannerConversationTranscriptMessage, PlannerStagingSidecar } from '../../../../../backend/platform/planner-history/types.js';
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
import { createLogger } from '../log/logger';
import { normalizeIpcThrownError } from '../services/ipcErrorHelpers';
import { useFollowUpFlow } from './useFollowUpFlow';
import { usePlannerFlow } from './usePlannerFlow';
import type { ConversationMessage } from './usePlannerStream';
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
const MISSING_PARENT_FOCUS_ERROR = 'This archived parent task has no saved planner focus and cannot be used as a parent. Refresh the parent list and try again.';
const log = createLogger('src/renderer/hooks/usePlannerModal');

function toRendererMessage(message: PlannerConversationTranscriptMessage): ConversationMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    isStreaming: false,
    timestamp: message.timestamp,
  };
}

function getContextPackName(sidecar: PlannerStagingSidecar): string {
  const explicitId = sidecar.contextPackBinding.contextPackId.trim();
  if (explicitId) {
    return explicitId;
  }
  const parts = sidecar.contextPackBinding.contextPackDir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function archivedTaskFromRecord(record: PlannerConversationRecord): ArchivedTaskEntry {
  const lineage = record.sidecarSnapshot.lineage;
  const fallbackParentTaskId = lineage.parentTaskId || record.id;
  return {
    taskId: fallbackParentTaskId,
    title: lineage.parentTaskId || record.title,
    summary: record.title,
    rootTaskId: lineage.rootTaskId || fallbackParentTaskId,
    qmdRecordId: lineage.parentQmdRecordId,
    followupReason: lineage.followUpReason,
    year: new Date(record.createdAt).getUTCFullYear().toString(),
    archivePath: record.finalizedDestinationPath,
    contextPackName: getContextPackName(record.sidecarSnapshot),
  };
}

export function usePlannerModal(
  client: DesktopShellClient,
  workflowState: LifecycleState | undefined,
  hasActiveContextPack: boolean,
  contractError: string,
  setContractError: Dispatch<SetStateAction<string>>,
  activeContextPackDir: string | null = null,
  deepFocusSelection?: PlannerStartSessionDeepFocusSelection,
): UsePlannerModalResult {
  const expectedSessionIdRef = useRef<string | null>(null);
  const suppressNextArchivedFetchRef = useRef(false);
  const plannerStream = usePlannerStream({ expectedSessionIdRef });
  const [plannerModalOpen, setPlannerModalOpen] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<PlannerSessionStatus>('idle');
  const startSession = useCallback(() => {
    expectedSessionIdRef.current = null;
    setSessionStatus('connecting');
    setPlannerFocusValidationIssues([]);
    if (!activeContextPackDir) {
      setSessionStatus('failed');
      return;
    }
    client.startPlannerSession({
      contextPackDir: activeContextPackDir,
      ...(deepFocusSelection?.deepFocusEnabled === true ? { deepFocusSelection } : {}),
    })
      .then((result) => {
        if (!result.ok || result.response.action !== 'planner.startSession') {
          expectedSessionIdRef.current = null;
          setSessionStatus('failed');
          log.warn('planner.session.start.failed', {
            contextPackDir: activeContextPackDir,
            reason: result.ok ? 'Unexpected planner start response.' : result.error,
          });
          return;
        }
        expectedSessionIdRef.current = result.response.sessionId;
        setSessionStatus('active');
      })
      .catch((err: unknown) => {
        expectedSessionIdRef.current = null;
        setSessionStatus('failed');
        log.error('planner.session.start.failed', err, {
          contextPackDir: activeContextPackDir,
        });
      });
  }, [client, activeContextPackDir, deepFocusSelection]);
  const openPlannerModal = useCallback(() => {
    if (!hasActiveContextPack) {
      return;
    }
    setPlannerModalOpen(true);
    startSession();
  }, [hasActiveContextPack, startSession]);
  const resetPlannerState = useCallback(() => {
    expectedSessionIdRef.current = null;
    setSessionStatus('idle');
    plannerStream.clearConversation();
    setSelectedMarkdownFile(null);
    setStagedDraft(null);
    setDraftError('');
    setPlannerFocusValidationIssues([]);
    setAwaitingDraft(false);
    setChildTaskMode(false);
    setSelectedParentTask(null);
    pendingChildTaskStarterPromptRef.current = null;
    setArchivedTasks([]);
    setRecentConversations([]);
    setLoadingRecentConversations(false);
    setReplayInFlight(false);
    setReplaySourceRecordId(null);
    setLoadingChildTaskParent(false);
    client.endPlannerSession().catch((err: unknown) => {
      log.warn('planner.session.end.failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    });
  }, [client, plannerStream.clearConversation]);

  const closePlannerModal = useCallback(() => {
    setPlannerModalOpen(false);
    resetPlannerState();
  }, [resetPlannerState]);
  const [awaitingDraft, setAwaitingDraft] = useState(false);
  const [stagedDraft, setStagedDraft] = useState<StagedDraftContent | null>(null);
  const [draftError, setDraftError] = useState('');
  const [plannerFocusValidationIssues, setPlannerFocusValidationIssues] = useState<PlannerFocusValidationIssue[]>([]);
  const [recentConversations, setRecentConversations] = useState<PlannerListConversationHistorySummary[]>([]);
  const [recentConversationsMessage, setRecentConversationsMessage] = useState('');
  const [loadingRecentConversations, setLoadingRecentConversations] = useState(false);
  const [replayInFlight, setReplayInFlight] = useState(false);
  const [replaySourceRecordId, setReplaySourceRecordId] = useState<string | null>(null);
  const [selectedMarkdownFile, setSelectedMarkdownFile] = useState<MarkdownFileSelection | null>(null);
  const selectedMarkdownFileRef = useRef<MarkdownFileSelection | null>(null);
  selectedMarkdownFileRef.current = selectedMarkdownFile;

  const [childTaskMode, setChildTaskMode] = useState(false);
  const childTaskModeRef = useRef(false);
  childTaskModeRef.current = childTaskMode;
  const [selectedParentTask, setSelectedParentTask] = useState<ArchivedTaskEntry | null>(null);
  const selectedParentTaskRef = useRef<ArchivedTaskEntry | null>(null);
  selectedParentTaskRef.current = selectedParentTask;
  // Child-task starter prompt is built when the operator selects a parent
  // task but is held here until the operator sends their first message.
  // Sending it eagerly would put Lily into "thinking" before the operator
  // has had a chance to provide direction (and previously caused failures
  // when the staged draft and operator intent were not yet aligned).
  const pendingChildTaskStarterPromptRef = useRef<string | null>(null);
  const [archivedTasks, setArchivedTasks] = useState<ArchivedTaskEntry[]>([]);
  const [loadingArchivedTasks, setLoadingArchivedTasks] = useState(false);
  const [loadingChildTaskParent, setLoadingChildTaskParent] = useState(false);

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
    if (draftError !== PLANNER_FOCUS_FALLBACK_MESSAGE) {
      return;
    }
    const timer = setTimeout(() => {
      setDraftError((current) => (current === PLANNER_FOCUS_FALLBACK_MESSAGE ? '' : current));
      setPlannerFocusValidationIssues([]);
    }, PLANNER_FOCUS_FALLBACK_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [draftError]);

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

    if (sessionStatus === 'failed' && expectedSessionIdRef.current === null) {
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
    if (suppressNextArchivedFetchRef.current) {
      suppressNextArchivedFetchRef.current = false;
      setLoadingArchivedTasks(false);
      return;
    }
    setLoadingArchivedTasks(true);
    client.listArchivedTasks()
      .then((result) => {
        if (cancelled) return;
        if (result.ok && 'response' in result && result.response.action === 'planner.listArchivedTasks') {
          const response = result.response as import('../../shared/desktopContract').PlannerListArchivedTasksResponse;
          setArchivedTasks(response.tasks);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = normalizeIpcThrownError(error, 'Failed to load archived tasks.');
        log.warn('planner.archived-tasks.load.failed', { reason: message });
        setArchivedTasks([]);
        setDraftError(message);
      })
      .finally(() => { if (!cancelled) setLoadingArchivedTasks(false); });
    return () => { cancelled = true; };
  }, [childTaskMode, client]);

  const fetchRecentConversations = useCallback((): (() => void) | undefined => {
    setRecentConversations([]);
    if (!activeContextPackDir) {
      setRecentConversationsMessage('Select a context pack to view recent conversations.');
      setLoadingRecentConversations(false);
      return;
    }

    let cancelled = false;
    setLoadingRecentConversations(true);
    setRecentConversationsMessage('');
    client.listPlannerConversationHistory()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          const error = result.error ?? 'Failed to load recent conversations.';
          setRecentConversations([]);
          setRecentConversationsMessage(error);
          setDraftError(error);
          return;
        }
        const response = result.response;
        if (response.action !== 'planner.listConversationHistory') {
          const error = 'Unexpected planner conversation history response.';
          setRecentConversations([]);
          setRecentConversationsMessage(error);
          setDraftError(error);
          return;
        }
        setRecentConversations(response.conversations);
        setRecentConversationsMessage(response.message);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = normalizeIpcThrownError(error, 'Failed to load recent conversations.');
        setRecentConversations([]);
        setRecentConversationsMessage(message);
        setDraftError(message);
      })
      .finally(() => {
        if (!cancelled) setLoadingRecentConversations(false);
      });

    return () => { cancelled = true; };
  }, [activeContextPackDir, client]);

  useEffect(() => {
    if (!plannerModalOpen) {
      return;
    }
    return fetchRecentConversations();
  }, [plannerModalOpen, fetchRecentConversations]);

  const childTaskBlocked = childTaskMode && !selectedParentTask;
  const selectableArchivedTasks = useMemo(
    () => archivedTasks.filter((task) => task.plannerFocusSnapshot),
    [archivedTasks],
  );

  const handleToggleChildTaskMode = useCallback(() => {
    setChildTaskMode((prev) => {
      if (prev) {
        // Toggling off: reset draft back to standard
        setDraft(createLocalDraft(EMPTY_DRAFT_SEED));
        setSelectedParentTask(null);
        setPlannerFocusValidationIssues([]);
        pendingChildTaskStarterPromptRef.current = null;
      }
      return !prev;
    });
  }, []);

  const handleReturnToBlank = useCallback(() => {
    if (replayInFlight) return;
    resetPlannerState();
    setDraft(createLocalDraft(EMPTY_DRAFT_SEED));
    setComposerStage('compose');
    startSession();
    fetchRecentConversations();
  }, [replayInFlight, resetPlannerState, startSession, fetchRecentConversations]);

  const handleSelectParentTask = useCallback((task: ArchivedTaskEntry) => {
    if (loadingChildTaskParent) return;
    setPlannerFocusValidationIssues([]);
    if (!task.plannerFocusSnapshot) {
      setDraftError(MISSING_PARENT_FOCUS_ERROR);
      return;
    }

    setSelectedParentTask(task);
    const followUpContext = normalizeArchivedTaskToFollowUpContext(task);
    setDraft(createFollowUpDraft(followUpContext));
    setLoadingChildTaskParent(true);
    setSessionStatus('connecting');
    expectedSessionIdRef.current = null;
    plannerStream.clearConversation();
    setStagedDraft(null);
    setDraftError('');
    setAwaitingDraft(false);
    setSelectedMarkdownFile(null);

    const childTaskLineage = {
      parentTaskId: task.taskId,
      parentQmdRecordId: task.qmdRecordId,
      parentQmdScope: deriveParentQmdScope(task.contextPackName),
      rootTaskId: task.rootTaskId || task.taskId,
      followUpReason: task.followupReason || 'Correction requested through child-task mode.',
    };

    void (async () => {
      try {
        if (!activeContextPackDir) {
          setDraftError('Planner session requires an active context pack.');
          setSessionStatus('failed');
          return;
        }
        const validation = await client.validateChildTaskFocus({
          contextPackDir: activeContextPackDir,
          snapshot: task.plannerFocusSnapshot!,
        });
        if (!validation.ok) {
          setDraftError(validation.error ?? 'Failed to validate parent task focus.');
          setSessionStatus('failed');
          return;
        }
        if (validation.response.action !== 'planner.validateChildTaskFocus') {
          setDraftError('Unexpected planner parent focus validation response.');
          setSessionStatus('failed');
          return;
        }
        if (validation.response.mode !== 'valid' && validation.response.mode !== 'fallback') {
          setDraftError('Unexpected planner parent focus validation mode.');
          setSessionStatus('failed');
          return;
        }
        await client.endPlannerSession();
        if (validation.response.mode === 'fallback') {
          setChildTaskMode(false);
          setSelectedParentTask(null);
          setDraft(createLocalDraft(EMPTY_DRAFT_SEED));
          setPlannerFocusValidationIssues(validation.response.issues);
          setDraftError(validation.response.message);
          const start = await client.startPlannerSession({
            contextPackDir: activeContextPackDir,
            ...(deepFocusSelection?.deepFocusEnabled === true ? { deepFocusSelection } : {}),
          });
          if (!start.ok || start.response.action !== 'planner.startSession') {
            expectedSessionIdRef.current = null;
            setDraftError(start.ok ? 'Unexpected planner start response.' : start.error ?? 'Failed to start planner session.');
            setSessionStatus('failed');
            return;
          }
          expectedSessionIdRef.current = start.response.sessionId;
          setSessionStatus('active');
          return;
        }
        const start = await client.startPlannerSession({
          contextPackDir: task.plannerFocusSnapshot!.contextPackDir,
          childTaskFocusSnapshot: task.plannerFocusSnapshot,
          childTaskLineage,
        });
        if (!start.ok || start.response.action !== 'planner.startSession') {
          expectedSessionIdRef.current = null;
          setDraftError(start.ok ? 'Unexpected planner child-task start response.' : start.error ?? 'Failed to start child-task planner session.');
          setSessionStatus('failed');
          return;
        }
        expectedSessionIdRef.current = start.response.sessionId;
        setSessionStatus('active');
        // Defer the child-task starter prompt: build it now (so the parent
        // task content is captured at selection time), but do not send it
        // until the operator submits their first message. This keeps Lily
        // from going into "thinking" the moment a parent is picked.
        pendingChildTaskStarterPromptRef.current = buildChildTaskStarterPrompt({
          parentTaskId: task.taskId,
          parentTaskTitle: task.title,
          rootTaskId: task.rootTaskId || task.taskId,
          parentQmdScope: deriveParentQmdScope(task.contextPackName),
          parentTaskContent: task.parentTaskContent,
        });
        plannerStream.sendMessage(
          `[Child-task mode activated — continuing from ${task.title}. Send a message to begin.]`,
        );
      } catch (error: unknown) {
        expectedSessionIdRef.current = null;
        setDraftError(normalizeIpcThrownError(error, 'Failed to start child-task planner session.'));
        setSessionStatus('failed');
      } finally {
        setLoadingChildTaskParent(false);
      }
    })();
  }, [activeContextPackDir, client, deepFocusSelection, plannerStream, loadingChildTaskParent]);

  const handleSelectConversation = useCallback((recordId: string): void => {
    if (replayInFlight) {
      return;
    }

    setReplayInFlight(true);
    void (async () => {
      try {
        const hydrate = await client.hydratePlannerConversation(recordId);
        if (!hydrate.ok) {
          setDraftError(hydrate.error ?? 'Failed to load recent conversation.');
          return;
        }
        if (hydrate.response.action !== 'planner.hydrateConversation' || hydrate.response.mode !== 'found' || !hydrate.response.record) {
          setDraftError(hydrate.response.message || 'Recent conversation was not found.');
          return;
        }

        const record = hydrate.response.record;
        expectedSessionIdRef.current = null;
        await client.endPlannerSession();

        plannerStream.clearConversation();
        setStagedDraft(null);
        setDraftError('');
        setAwaitingDraft(false);
        setSelectedMarkdownFile(null);
        setComposerStage('compose');
        setArchivedTasks([]);

        if (record.sidecarSnapshot.lineage.taskKind === 'child-task') {
          const parentTask = archivedTaskFromRecord(record);
          suppressNextArchivedFetchRef.current = !childTaskModeRef.current;
          setChildTaskMode(true);
          setSelectedParentTask(parentTask);
          setDraft(createFollowUpDraft({
            parentTaskId: parentTask.taskId,
            parentTaskTitle: parentTask.title,
            parentQmdRecordId: parentTask.qmdRecordId,
            parentQmdScope: record.sidecarSnapshot.lineage.parentQmdScope,
            rootTaskId: parentTask.rootTaskId,
            followupReason: parentTask.followupReason,
            carryForwardSummary: parentTask.summary,
            childTitle: record.title,
            requestedAdjustment: '',
            desiredOutcome: '',
            constraints: [],
            acceptanceSignals: [],
            planningNotes: '',
            suggestedPath: 'sequential',
          }));
        } else {
          setChildTaskMode(false);
          setSelectedParentTask(null);
          setDraft(createLocalDraft(EMPTY_DRAFT_SEED));
        }

        plannerStream.hydrateMessages(record.transcript.map(toRendererMessage));
        setSessionStatus('connecting');

        const start = await client.startPlannerSession({
          contextPackDir: record.sidecarSnapshot.contextPackBinding.contextPackDir,
          replayConversationId: recordId,
        });
        if (!start.ok || start.response.action !== 'planner.startSession') {
          expectedSessionIdRef.current = null;
          setDraftError(start.ok ? 'Unexpected planner replay start response.' : start.error ?? 'Failed to start replay conversation.');
          setSessionStatus('failed');
          return;
        }

        expectedSessionIdRef.current = start.response.sessionId;
        setReplaySourceRecordId(recordId);
        setSessionStatus('active');
        if (start.response.message.toLowerCase().includes('focus') && start.response.message.toLowerCase().includes('resolved')) {
          setDraftError('Some referenced focus paths could not be resolved. Lily will use the saved variables you provided.');
        }
      } catch (error: unknown) {
        expectedSessionIdRef.current = null;
        setDraftError(normalizeIpcThrownError(error, "Couldn't replay that conversation."));
        setSessionStatus('failed');
      } finally {
        setReplayInFlight(false);
      }
    })();
  }, [client, plannerStream, replayInFlight]);

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

        // First operator turn in child-task mode: prepend the deferred
        // starter prompt so Lily receives the parent-task context together
        // with the operator's intent, rather than ahead of it.
        const pendingStarter = pendingChildTaskStarterPromptRef.current;
        if (pendingStarter) {
          messageToSend = `${pendingStarter}\n\n---\n\nOperator message:\n${messageToSend}`;
          pendingChildTaskStarterPromptRef.current = null;
        }

        const displayText = attachedFile
          ? `[Attached ${attachedFile.filename} for review]${text ? `\n${text}` : ''}`
          : text;
        const result = await client.sendPlannerMessage(
          messageToSend,
          attachedFile ? displayText : undefined,
        );
        if (!result.ok) {
          plannerStream.sendMessage(`[send failed: ${result.error ?? 'unknown error'}]`);
          return;
        }
        if (attachedFile) {
          setSelectedMarkdownFile(null);
        }
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
      if (response.action !== 'planner.readStagedDraft') {
        return;
      }
      if (response.mode === 'found' && response.draft) {
        setStagedDraft(response.draft);
      } else if (response.mode === 'empty') {
        setStagedDraft(null);
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

  const handleDownloadTemplate = useCallback(async (): Promise<void> => {
    try {
      const content = await client.getBypassTemplate();
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'planning-intake.md';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setContractError(normalizeIpcThrownError(err));
    }
  }, [client, setContractError]);

  const handleUploadSpec = useCallback(async (): Promise<boolean> => {
    try {
      const pickResult = await client.pickMarkdownFile();
      if (!pickResult.ok || !pickResult.response || pickResult.response.action !== 'planner.pickMarkdownFile' || pickResult.response.mode === 'cancelled' || !pickResult.response.content) {
        return false;
      }
      const requirePlannerSidecar = childTaskModeRef.current || replaySourceRecordId !== null;
      const uploadOptions = requirePlannerSidecar
        ? {
            requirePlannerSidecar: true,
            expectedTaskKind: childTaskModeRef.current ? 'child-task' as const : 'standard' as const,
          }
        : undefined;
      const uploadResult = await client.uploadSpec(pickResult.response.content, uploadOptions);
      if (!uploadResult.ok) {
        setContractError(uploadResult.error ?? 'Upload spec failed.');
        return false;
      }
      setContractError('');
      return true;
    } catch (err: unknown) {
      setContractError(normalizeIpcThrownError(err));
      return false;
    }
  }, [client, replaySourceRecordId, setContractError]);

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
      plannerFocusValidationIssues,
      recentConversations,
      loadingRecentConversations,
      replayInFlight,
      replaySourceRecordId,
      recentConversationsMessage,
      primaryActionLabel,
      stageCopy,
      messages: mappedMessages,
      isStreaming: plannerStream.isStreaming,
      onSendMessage: handleSendMessage,
      onSelectConversation: handleSelectConversation,
      onReturnToBlank: handleReturnToBlank,
      sessionStatus,
      onReconnect: startSession,
      awaitingDraft,
      stagedDraft,
      onViewDraft: handleViewDraft,
      onRefreshDraft: refreshStagedDraft,
      onFinalizeSpec: handleFinalizeSpec,
      selectedMarkdownFile,
      onPickMarkdownFile: handlePickMarkdownFile,
      onUploadSpec: handleUploadSpec,
      onDownloadTemplate: handleDownloadTemplate,
      onClearSelectedFile: handleClearSelectedFile,
      childTaskMode,
      onToggleChildTaskMode: handleToggleChildTaskMode,
      archivedTasks: selectableArchivedTasks,
      archivedTaskTotalCount: archivedTasks.length,
      selectedParentTask,
      onSelectParentTask: handleSelectParentTask,
      loadingArchivedTasks,
      loadingChildTaskParent,
      childTaskBlocked,
    }),
    [plannerModalOpen, closePlannerModal, draft, composerStage, handlePreview, handleConfirm, isFollowUpDraft, planningEnabled, contractError, primaryActionLabel, stageCopy, mappedMessages, plannerStream.isStreaming, plannerStream.lastError, recentConversations, loadingRecentConversations, replayInFlight, replaySourceRecordId, recentConversationsMessage, handleSendMessage, handleSelectConversation, handleReturnToBlank, sessionStatus, startSession, awaitingDraft, stagedDraft, draftError, plannerFocusValidationIssues, handleViewDraft, refreshStagedDraft, handleFinalizeSpec, selectedMarkdownFile, handlePickMarkdownFile, handleUploadSpec, handleDownloadTemplate, handleClearSelectedFile, childTaskMode, handleToggleChildTaskMode, selectableArchivedTasks, archivedTasks.length, selectedParentTask, handleSelectParentTask, loadingArchivedTasks, loadingChildTaskParent, childTaskBlocked],
  );

  return { plannerModalProps, openPlannerModal };
}
