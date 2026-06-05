import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ArchivedTaskChildParentBlockedTip,
  ArchivedTaskEntry,
  LifecycleState,
  MarkdownFileSelection,
  PlannerListConversationHistorySummary,
  PlannerFocusValidationIssue,
  PlannerLilyPersonalityId,
  PlannerReadParentChainArchiveBundleResponse,
  PlannerReadParentContextBundleResponse,
  PlannerStartSessionDeepFocusSelection,
  StagedDraftContent,
} from '../../shared/desktopContract';
import { PLANNER_FOCUS_FALLBACK_MESSAGE } from '../../shared/desktopContract';

// Soft, informational fallback notices auto-dismiss after this delay so they
// don't sit in the modal forever. Hard errors (validation, IPC failures) are
// still shown until the operator acts.
const PLANNER_FOCUS_FALLBACK_DISMISS_MS = 5000;
import type { PlannerConversationTranscriptMessage } from '../../../../../backend/platform/planner-history/types.js';
import { buildChildTaskMarkdownReviewPrompt, buildChildTaskStarterPrompt, buildMarkdownReviewPrompt, PLANNER_SAVE_DRAFT_WORKFLOW } from '../../shared/plannerWorkflow';
import type { PlannerModalProps, PlannerSessionStatus } from '../components/PlannerModal';
import { buildRecentTaskScopeSummary, type PlannerWorkspaceScopeSummary } from '../plannerWorkspaceScope';
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
import {
  buildParentTaskBranchViewRequest,
  PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE,
  restartChildPlannerWithScope,
} from '../plannerChildScopeSession';
import { buildChildTaskLineage } from '../plannerArchivedTaskHelpers';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { createLogger } from '../log/logger';
import { normalizeIpcThrownError } from '../services/ipcErrorHelpers';
import { useFollowUpFlow } from './useFollowUpFlow';
import { useChildTaskScopeOverride, type ChildTaskScopeCatalog, type SaveChildScopeArgs } from './useChildTaskScopeOverride';
import { usePlannerFlow } from './usePlannerFlow';
import { usePlannerParentArchivePreview } from './usePlannerParentArchivePreview';
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
const BALANCED_BUSY_BADGE_LABELS = ['thinking', 'spinning', 'synthesizing', 'pondering', 'musing'] as const;
const CLINICAL_BUSY_BADGE_LABELS = ['thinking', 'analyzing', 'evaluating', 'reviewing', 'checking'] as const;
type BusyBadgeLabel = (typeof BALANCED_BUSY_BADGE_LABELS)[number] | (typeof CLINICAL_BUSY_BADGE_LABELS)[number];
const log = createLogger('src/renderer/hooks/usePlannerModal');

function chooseBusyBadgeLabel(personalityId: PlannerLilyPersonalityId): BusyBadgeLabel {
  const labels = personalityId === 'clinical' ? CLINICAL_BUSY_BADGE_LABELS : BALANCED_BUSY_BADGE_LABELS;
  return labels[Math.floor(Math.random() * labels.length)] ?? 'thinking';
}

function isSelectableArchivedParent(task: ArchivedTaskEntry): boolean {
  return Boolean(task.plannerFocusSnapshot && task.childParentEligibility?.eligible === true);
}

function childParentEligibilityCounts(tasks: ArchivedTaskEntry[]): Record<string, number> {
  return tasks.reduce<Record<string, number>>((counts, task) => {
    const eligibility = task.childParentEligibility;
    if (eligibility?.eligible === false) {
      counts[eligibility.reason] = (counts[eligibility.reason] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function toRendererMessage(message: PlannerConversationTranscriptMessage): ConversationMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    isStreaming: false,
    timestamp: message.timestamp,
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
  childScopeCatalog?: ChildTaskScopeCatalog,
  currentWorkspaceScopeSummary?: PlannerWorkspaceScopeSummary | null,
): UsePlannerModalResult {
  const expectedSessionIdRef = useRef<string | null>(null);
  const viewDraftSeqRef = useRef(0);
  const plannerStream = usePlannerStream({ expectedSessionIdRef });
  const parentArchivePreview = usePlannerParentArchivePreview(client);
  const [plannerModalOpen, setPlannerModalOpen] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<PlannerSessionStatus>('idle');
  const [sessionStartError, setSessionStartError] = useState('');
  const [selectedLilyPersonalityId, setSelectedLilyPersonalityId] = useState<PlannerLilyPersonalityId>('balanced');
  const selectedLilyPersonalityIdRef = useRef<PlannerLilyPersonalityId>('balanced');
  const [personalityLocked, setPersonalityLocked] = useState(false);
  const [busyBadgeLabel, setBusyBadgeLabel] = useState<BusyBadgeLabel>('thinking');
  const startSession = useCallback(() => {
    expectedSessionIdRef.current = null;
    setSessionStatus('connecting');
    setSessionStartError('');
    setPlannerFocusValidationIssues([]);
    setRecentTaskScopeSummary(null);
    pendingChildTaskStarterPromptRef.current = null;
    parentContextBundleRef.current = undefined;
    parentChainArchiveBundleRef.current = undefined;
    if (!activeContextPackDir) {
      setSessionStatus('failed');
      setSessionStartError('No active context pack is selected.');
      return;
    }
    client.startPlannerSession({
      contextPackDir: activeContextPackDir,
      lilyPersonalityId: selectedLilyPersonalityIdRef.current,
      ...(deepFocusSelection?.deepFocusEnabled === true ? { deepFocusSelection } : {}),
    })
      .then((result) => {
        if (!result.ok || result.response.action !== 'planner.startSession') {
          expectedSessionIdRef.current = null;
          setSessionStatus('failed');
          setSessionStartError(result.ok ? 'Unexpected planner start response.' : result.error);
          log.warn('planner.session.start.failed', {
            contextPackDir: activeContextPackDir,
            reason: result.ok ? 'Unexpected planner start response.' : result.error,
          });
          return;
        }
        expectedSessionIdRef.current = result.response.sessionId;
        setSessionStartError('');
        setSessionStatus('active');
      })
      .catch((err: unknown) => {
        expectedSessionIdRef.current = null;
        setSessionStatus('failed');
        setSessionStartError(normalizeIpcThrownError(err, 'Unable to start planner session.'));
        log.error('planner.session.start.failed', err, {
          contextPackDir: activeContextPackDir,
        });
      });
  }, [client, activeContextPackDir, deepFocusSelection]);
  const openPlannerModal = useCallback(() => {
    if (!hasActiveContextPack) {
      return;
    }
    selectedLilyPersonalityIdRef.current = 'balanced';
    setSelectedLilyPersonalityId('balanced');
    setPersonalityLocked(false);
    setBusyBadgeLabel('thinking');
    setPlannerModalOpen(true);
    startSession();
  }, [hasActiveContextPack, startSession]);
  const resetPlannerState = useCallback(() => {
    expectedSessionIdRef.current = null;
    // Cancel any in-flight draft poll so it can't apply state after reset/close.
    viewDraftSeqRef.current += 1;
    setSessionStatus('idle');
    plannerStream.clearConversation();
    setSelectedMarkdownFile(null);
    setStagedDraft(null);
    setDraftError('');
    setSessionStartError('');
    setPlannerFocusValidationIssues([]);
    setAwaitingDraft(false);
    setChildTaskMode(false);
    setSelectedParentTask(null);
    setChildTaskParentReady(false);
    pendingChildTaskStarterPromptRef.current = null;
    parentContextBundleRef.current = undefined;
    parentChainArchiveBundleRef.current = undefined;
    setArchivedTasks([]);
    setChildParentBlockedTips([]);
    setRecentConversations([]);
    setLoadingRecentConversations(false);
    setReplayInFlight(false);
    setReplaySourceRecordId(null);
    setRecentTaskScopeSummary(null);
    setLoadingChildTaskParent(false);
    selectedLilyPersonalityIdRef.current = 'balanced';
    setSelectedLilyPersonalityId('balanced');
    setPersonalityLocked(false);
    setBusyBadgeLabel('thinking');
    client.endPlannerSession().catch((err: unknown) => {
      log.warn('planner.session.end.failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    });
  }, [client, plannerStream.clearConversation]);

  const handleLilyPersonalityChange = useCallback((id: PlannerLilyPersonalityId): void => {
    if (personalityLocked) {
      return;
    }
    const previousId = selectedLilyPersonalityIdRef.current;
    selectedLilyPersonalityIdRef.current = id;
    setSelectedLilyPersonalityId(id);
    void client.updatePlannerSessionPersonality({ lilyPersonalityId: id })
      .then((result) => {
        if (!result.ok) {
          selectedLilyPersonalityIdRef.current = previousId;
          setSelectedLilyPersonalityId(previousId);
        }
      })
      .catch(() => {
        selectedLilyPersonalityIdRef.current = previousId;
        setSelectedLilyPersonalityId(previousId);
      });
  }, [client, personalityLocked]);

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
  const [recentTaskScopeSummary, setRecentTaskScopeSummary] = useState<PlannerWorkspaceScopeSummary | null>(null);
  const [selectedMarkdownFile, setSelectedMarkdownFile] = useState<MarkdownFileSelection | null>(null);
  const selectedMarkdownFileRef = useRef<MarkdownFileSelection | null>(null);
  selectedMarkdownFileRef.current = selectedMarkdownFile;

  const [childTaskMode, setChildTaskMode] = useState(false);
  const childTaskModeRef = useRef(false);
  childTaskModeRef.current = childTaskMode;
  const childScopeCatalogRef = useRef(childScopeCatalog);
  childScopeCatalogRef.current = childScopeCatalog;
  const [selectedParentTask, setSelectedParentTask] = useState<ArchivedTaskEntry | null>(null);
  const selectedParentTaskRef = useRef<ArchivedTaskEntry | null>(null);
  selectedParentTaskRef.current = selectedParentTask;
  // Child-task starter prompt is built when the operator selects a parent
  // task but is held here until the operator sends their first message.
  // Sending it eagerly would put Lily into "thinking" before the operator
  // has had a chance to provide direction (and previously caused failures
  // when the staged draft and operator intent were not yet aligned).
  const pendingChildTaskStarterPromptRef = useRef<string | null>(null);
  const parentContextBundleRef = useRef<PlannerReadParentContextBundleResponse['bundle'] | undefined>(undefined);
  const parentChainArchiveBundleRef = useRef<PlannerReadParentChainArchiveBundleResponse['bundle'] | undefined>(undefined);
  const [archivedTasks, setArchivedTasks] = useState<ArchivedTaskEntry[]>([]);
  const [childParentBlockedTips, setChildParentBlockedTips] = useState<ArchivedTaskChildParentBlockedTip[]>([]);
  const [loadingArchivedTasks, setLoadingArchivedTasks] = useState(false);
  const [loadingChildTaskParent, setLoadingChildTaskParent] = useState(false);
  const [childTaskParentReady, setChildTaskParentReady] = useState(false);

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

  const saveChildScopeOverride = useCallback(async (args: SaveChildScopeArgs): Promise<boolean> => {
    const task = selectedParentTaskRef.current;
    if (!task?.plannerFocusSnapshot) {
      throw new Error(MISSING_PARENT_FOCUS_ERROR);
    }
    try {
        await restartChildPlannerWithScope({
          client,
          task,
          childScope: args.childScope,
          reloadScope: args.reloadScope,
          lilyPersonalityId: selectedLilyPersonalityIdRef.current,
          parentContextBundle: parentContextBundleRef.current,
        onBeforeStart: () => {
          expectedSessionIdRef.current = null;
          plannerStream.clearConversation();
          setStagedDraft(null);
          setSelectedMarkdownFile(null);
          setDraftError('');
          setSessionStatus('connecting');
        },
        onStatus: (message) => plannerStream.sendMessage(message),
        onStarted: (sessionId, starterPrompt) => {
          expectedSessionIdRef.current = sessionId;
          setSessionStatus('active');
          pendingChildTaskStarterPromptRef.current = starterPrompt;
        },
      });
      plannerStream.sendMessage('[Child scope adjusted — Lily reloaded with updated implementation scope and read-only parent context.]');
      return true;
    } catch (error: unknown) {
      const reason = normalizeIpcThrownError(error, 'Failed to save child scope override.');
      setDraftError(reason);
      setSessionStatus('failed');
      log.warn('planner.child-scope.override.failed', { taskId: task.taskId, reason });
      throw new Error(reason);
    }
  }, [client, plannerStream]);

  const childScopeOverride = useChildTaskScopeOverride({
    catalog: childScopeCatalog,
    selectedParentTask,
    loadingChildTaskParent,
    parentReady: childTaskParentReady,
    onSaveChangedScope: saveChildScopeOverride,
  });
  useEffect(() => {
    if (!plannerModalOpen || !childTaskMode) {
      childScopeOverride.reset();
    }
  }, [plannerModalOpen, childTaskMode, childScopeOverride.reset]);
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
      setChildParentBlockedTips([]);
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
          setChildParentBlockedTips(response.childParentBlockedTips ?? []);
          const chainStateValid = response.childChainStateStatus?.status !== 'invalid';
          const hiddenCounts = childParentEligibilityCounts(response.tasks);
          const hasHiddenByEligibility = Object.keys(hiddenCounts).length > 0;
          if (chainStateValid && hasHiddenByEligibility) {
            log.warn('planner.child-task-parent.filtered', { countsByReason: hiddenCounts });
          }
          if (!chainStateValid) {
            setDraftError('Child-task chain state is invalid. Parent selection is temporarily unavailable until it is repaired.');
            return;
          }
          if (response.tasks.length > 0 && hasHiddenByEligibility && !response.tasks.some(isSelectableArchivedParent)) {
            setDraftError('Only the current child-chain tip can be used as the next parent.');
          }
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = normalizeIpcThrownError(error, 'Failed to load archived tasks.');
        log.warn('planner.archived-tasks.load.failed', { reason: message });
        setArchivedTasks([]);
        setChildParentBlockedTips([]);
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
    () => archivedTasks.filter(isSelectableArchivedParent),
    [archivedTasks],
  );

  const handleToggleChildTaskMode = useCallback(() => {
    setRecentTaskScopeSummary(null);
    setChildTaskMode((prev) => {
      if (prev) {
        // Toggling off: reset draft back to standard
        setDraft(createLocalDraft(EMPTY_DRAFT_SEED));
        setSelectedParentTask(null);
        setChildParentBlockedTips([]);
        setPlannerFocusValidationIssues([]);
        pendingChildTaskStarterPromptRef.current = null;
        parentContextBundleRef.current = undefined;
        parentChainArchiveBundleRef.current = undefined;
        setChildTaskParentReady(false);
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
    pendingChildTaskStarterPromptRef.current = null;
    if (loadingChildTaskParent) return;
    setPlannerFocusValidationIssues([]);
    childScopeOverride.reset();
    parentContextBundleRef.current = undefined;
    parentChainArchiveBundleRef.current = undefined;
    setChildTaskParentReady(false);
    if (task.childParentEligibility && !task.childParentEligibility.eligible) {
      setDraftError(task.childParentEligibility.message);
      log.warn('planner.child-task-parent.selection.rejected', {
        taskId: task.taskId,
        reason: task.childParentEligibility.reason,
      });
      return;
    }
    if (!task.plannerFocusSnapshot) {
      setDraftError(MISSING_PARENT_FOCUS_ERROR);
      return;
    }
    childScopeOverride.initializeFromParent(task);

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

    const childTaskLineage = buildChildTaskLineage(task);

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
        const parentContextBundleResult = validation.response.mode === 'valid'
          ? await client.readParentContextBundle({
            parentTaskId: task.taskId,
            contextPackDir: task.plannerFocusSnapshot!.contextPackDir,
            contextPackId: task.plannerFocusSnapshot!.contextPackId,
          })
          : null;
        if (parentContextBundleResult && !parentContextBundleResult.ok) {
          setDraftError(parentContextBundleResult.error ?? 'Failed to read parent context bundle.');
          setSessionStatus('failed');
          return;
        }
        if (
          parentContextBundleResult?.ok
          && parentContextBundleResult.response.action !== 'planner.readParentContextBundle'
        ) {
          setDraftError('Unexpected parent context bundle response.');
          setSessionStatus('failed');
          return;
        }
        parentContextBundleRef.current = parentContextBundleResult?.ok
          ? (parentContextBundleResult.response as PlannerReadParentContextBundleResponse).bundle
          : undefined;
        const parentChainArchiveBundleResult = validation.response.mode === 'valid'
          ? await client.readParentChainArchiveBundle({
            parentTaskId: task.taskId,
            rootTaskId: task.rootTaskId || task.taskId,
            contextPackDir: task.plannerFocusSnapshot!.contextPackDir,
            contextPackId: task.plannerFocusSnapshot!.contextPackId,
          })
          : null;
        if (parentChainArchiveBundleResult && !parentChainArchiveBundleResult.ok) {
          log.warn('planner.parent-chain-archive-bundle.read.failed', {
            taskId: task.taskId,
            reason: parentChainArchiveBundleResult.error ?? 'unknown',
          });
          setDraftError(parentChainArchiveBundleResult.error ?? 'Failed to read parent chain archive bundle.');
          setSessionStatus('failed');
          return;
        }
        if (
          parentChainArchiveBundleResult?.ok
          && parentChainArchiveBundleResult.response.action !== 'planner.readParentChainArchiveBundle'
        ) {
          setDraftError('Unexpected parent chain archive bundle response.');
          setSessionStatus('failed');
          return;
        }
        parentChainArchiveBundleRef.current = parentChainArchiveBundleResult?.ok
          ? (parentChainArchiveBundleResult.response as PlannerReadParentChainArchiveBundleResponse).bundle
          : undefined;
        await client.endPlannerSession();
        if (validation.response.mode === 'fallback') {
          setChildTaskMode(false);
          setSelectedParentTask(null);
          setDraft(createLocalDraft(EMPTY_DRAFT_SEED));
          setPlannerFocusValidationIssues(validation.response.issues);
          setDraftError(validation.response.message);
          const start = await client.startPlannerSession({
            contextPackDir: activeContextPackDir,
            lilyPersonalityId: selectedLilyPersonalityIdRef.current,
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
          lilyPersonalityId: selectedLilyPersonalityIdRef.current,
          childTaskFocusSnapshot: task.plannerFocusSnapshot,
          childTaskLineage,
          parentTaskBranchView: buildParentTaskBranchViewRequest(task),
        });
        if (!start.ok || start.response.action !== 'planner.startSession') {
          expectedSessionIdRef.current = null;
          setDraftError(start.ok ? 'Unexpected planner child-task start response.' : start.error ?? 'Failed to start child-task planner session.');
          setSessionStatus('failed');
          return;
        }
        expectedSessionIdRef.current = start.response.sessionId;
        setSessionStatus('active');
        setChildTaskParentReady(true);
        if (start.response.parentBranchViewStatus?.mode === 'skipped-missing-handoffs') {
          plannerStream.sendMessage(PARENT_BRANCH_VIEW_MISSING_HANDOFFS_MESSAGE);
        }
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
          parentContextBundle: parentContextBundleRef.current,
          parentChainArchiveBundle: parentChainArchiveBundleRef.current,
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
  }, [activeContextPackDir, childScopeOverride, client, deepFocusSelection, plannerStream, loadingChildTaskParent]);

  const handleSelectConversation = useCallback((recordId: string): void => {
    if (replayInFlight) {
      return;
    }

    setReplayInFlight(true);
    setRecentTaskScopeSummary(null);
    void (async () => {
      try {
        pendingChildTaskStarterPromptRef.current = null;
        parentContextBundleRef.current = undefined;
        parentChainArchiveBundleRef.current = undefined;
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
        // Recent-task scope is surfaced for both standard and child-task recent
        // replays, sourced from the hydrated sidecar binding.
        const recentScopeBinding = record.sidecarSnapshot.contextPackBinding;
        const recentScopeMatchedPack = childScopeCatalogRef.current?.contextPacks?.find(
          (entry) =>
            entry.contextPackDir === recentScopeBinding.contextPackDir ||
            entry.contextPackId === recentScopeBinding.contextPackId,
        );
        const recentScopeSummary: PlannerWorkspaceScopeSummary = buildRecentTaskScopeSummary(
          recentScopeBinding,
          recentScopeMatchedPack,
        );
        expectedSessionIdRef.current = null;
        await client.endPlannerSession();

        plannerStream.clearConversation();
        setStagedDraft(null);
        setDraftError('');
        setAwaitingDraft(false);
        setSelectedMarkdownFile(null);
        setComposerStage('compose');
        setArchivedTasks([]);

        // Replaying a recent task — even one originally created as a child task —
        // always starts a fresh standalone STANDARD draft. The source chain is left
        // untouched; this is a disjointed copy, not a continuation. (Live child-task
        // creation via the toggle/parent dropdown is unaffected.)
        setChildTaskMode(false);
        setSelectedParentTask(null);
        setDraft(createLocalDraft(EMPTY_DRAFT_SEED));

        plannerStream.hydrateMessages(record.transcript.map(toRendererMessage));
        setSessionStatus('connecting');

        const start = await client.startPlannerSession({
          contextPackDir: record.sidecarSnapshot.contextPackBinding.contextPackDir,
          lilyPersonalityId: selectedLilyPersonalityIdRef.current,
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
        setRecentTaskScopeSummary(recentScopeSummary);
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
        setPersonalityLocked(true);
        setBusyBadgeLabel(chooseBusyBadgeLabel(selectedLilyPersonalityIdRef.current));
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
    const seq = (viewDraftSeqRef.current += 1);
    setStagedDraft(null);
    setDraftError('');
    setAwaitingDraft(true);
    plannerStream.sendMessage(PLANNER_SAVE_DRAFT_WORKFLOW.guideMessage);

    void (async () => {
      const isStale = (): boolean => viewDraftSeqRef.current !== seq;
      try {
        const saveResult = await client.savePlannerDraft();
        if (isStale()) return;
        if (!saveResult.ok) {
          setDraftError(saveResult.error);
          return;
        }
        for (let attempt = 0; attempt < DRAFT_READ_MAX_ATTEMPTS; attempt += 1) {
          const readResult = await client.readStagedDraft();
          if (isStale()) return;
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
          if (isStale()) return;
        }

        setDraftError('Lily is still writing the draft. Try again shortly.');
      } catch (error: unknown) {
        if (isStale()) return;
        setDraftError(normalizeIpcThrownError(error, 'Failed to read staged draft.'));
      } finally {
        if (!isStale()) setAwaitingDraft(false);
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

  const handleFinalizeSpec = useCallback(async (): Promise<boolean> => {
    try {
      const result = await client.finalizeSpec(childTaskModeRef.current ? 'child-task' : undefined);
      if (!result.ok) {
        setDraftError(result.error);
        return false;
      }
      if (result.response.action !== 'planner.finalizeSpec') {
        setDraftError('Unexpected planner finalize response.');
        return false;
      }
      setAwaitingDraft(false);
      setDraftError('');
      setStagedDraft(null);
      setSessionStatus(result.response.brokerStatus === 'idle' ? 'idle' : 'active');
      return true;
    } catch (error: unknown) {
      setDraftError(normalizeIpcThrownError(error, 'Spec finalization failed unexpectedly.'));
      return false;
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
      sessionStartError,
      draftError: draftError || plannerStream.lastError,
      plannerFocusValidationIssues,
      recentConversations,
      loadingRecentConversations,
      replayInFlight,
      replaySourceRecordId,
      // Recent replay (standard or child-task) shows the recent task's scope; non-recent child mode shows nothing here (parent/adjusted affordances cover it); standard non-recent shows the current workspaceScopeSummary.
      workspaceScopeSummary: replaySourceRecordId !== null && recentTaskScopeSummary ? recentTaskScopeSummary : (childTaskMode ? null : currentWorkspaceScopeSummary ?? null),
      recentConversationsMessage,
      primaryActionLabel,
      stageCopy,
      messages: mappedMessages,
      isStreaming: plannerStream.isStreaming,
      onSendMessage: handleSendMessage,
      onSelectConversation: handleSelectConversation,
      onReturnToBlank: handleReturnToBlank,
      sessionStatus,
      lilyPersonalityId: selectedLilyPersonalityId,
      personalityLocked,
      onLilyPersonalityChange: handleLilyPersonalityChange,
      busyBadgeLabel,
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
      childParentBlockedTips,
      archivedTaskTotalCount: archivedTasks.length,
      selectedParentTask,
      onSelectParentTask: handleSelectParentTask,
      loadingArchivedTasks,
      loadingChildTaskParent,
      childTaskBlocked,
      childScopeStatusLabel: childScopeOverride.childScopeStatusLabel,
      childScopeSummary: childScopeOverride.childScopeSummary,
      childScopeWarning: childScopeOverride.childScopeWarning,
      childScopePanelOpen: childScopeOverride.childScopePanelOpen,
      onOpenChildScopePanel: childScopeOverride.onOpenChildScopePanel,
      onCloseChildScopePanel: childScopeOverride.onCloseChildScopePanel,
      childScopePanelProps: childScopeOverride.childScopePanelProps,
      parentArchivePreview,
    }),
    [plannerModalOpen, closePlannerModal, draft, composerStage, handlePreview, handleConfirm, isFollowUpDraft, planningEnabled, contractError, sessionStartError, primaryActionLabel, stageCopy, mappedMessages, plannerStream.isStreaming, plannerStream.lastError, recentConversations, loadingRecentConversations, replayInFlight, replaySourceRecordId, recentConversationsMessage, handleSendMessage, handleSelectConversation, handleReturnToBlank, sessionStatus, selectedLilyPersonalityId, personalityLocked, handleLilyPersonalityChange, busyBadgeLabel, startSession, awaitingDraft, stagedDraft, draftError, plannerFocusValidationIssues, handleViewDraft, refreshStagedDraft, handleFinalizeSpec, selectedMarkdownFile, handlePickMarkdownFile, handleUploadSpec, handleDownloadTemplate, handleClearSelectedFile, childTaskMode, handleToggleChildTaskMode, selectableArchivedTasks, childParentBlockedTips, archivedTasks.length, selectedParentTask, handleSelectParentTask, loadingArchivedTasks, loadingChildTaskParent, childTaskBlocked, childScopeOverride, parentArchivePreview, currentWorkspaceScopeSummary, recentTaskScopeSummary],
  );

  return { plannerModalProps, openPlannerModal };
}
