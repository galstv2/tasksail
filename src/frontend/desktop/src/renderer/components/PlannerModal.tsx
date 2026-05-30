import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ArchivedTaskChildParentBlockedTip, ArchivedTaskEntry, ContextPackCatalogEntry, ContextPackFocusFilterSelection, MarkdownFileSelection, PlannerFocusValidationIssue, PlannerLilyPersonalityId, PlannerListConversationHistorySummary, StagedDraftContent } from '../../shared/desktopContract';
import type { ComposerStage, PlannerConversationMessage, PlannerDraftModel } from '../plannerComposer';
import { classNames } from '../utils/classNames';
import { BackIcon, CloseIcon } from './creation-steps/icons';
import SailScreen from './SailScreen';
import MarkdownView from './MarkdownView';
import ModalShell from './ModalShell';
import FocusSelectionSummaryCard from './FocusSelectionSummaryCard';
import { RecentsTrigger } from './planner/RecentsTrigger';
import { RecentsPopover } from './planner/RecentsPopover';
import ParentTaskPicker from './planner/ParentTaskPicker';
import { ParentArchivePreviewModal } from './planner/ParentArchivePreviewModal';
import ChildScopeOverridePanel, { type ChildScopeOverridePanelProps } from './planner/ChildScopeOverridePanel';
import type { usePlannerParentArchivePreview } from '../hooks/usePlannerParentArchivePreview';
import { childScopeToFocusFilterSelection } from '../plannerChildScope';
import type { PlannerWorkspaceScopeSummary } from '../plannerWorkspaceScope';

export type PlannerSessionStatus = 'idle' | 'connecting' | 'active' | 'busy' | 'failed';

export type PlannerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  draft: PlannerDraftModel;
  composerStage: ComposerStage;
  onPreview: () => void;
  onConfirm: () => void;
  isFollowUpDraft: boolean;
  planningEnabled: boolean;
  contractError: string;
  sessionStartError?: string;
  primaryActionLabel: string;
  stageCopy: string;
  messages: PlannerConversationMessage[];
  recentConversations?: PlannerListConversationHistorySummary[];
  loadingRecentConversations?: boolean;
  replayInFlight?: boolean;
  replaySourceRecordId?: string | null;
  recentConversationsMessage?: string;
  onSelectConversation?: (recordId: string) => void;
  onReturnToBlank?: () => void;
  isStreaming?: boolean;
  onSendMessage: (text: string) => void;
  sessionStatus?: PlannerSessionStatus;
  lilyPersonalityId?: PlannerLilyPersonalityId;
  personalityLocked?: boolean;
  onLilyPersonalityChange?: (id: PlannerLilyPersonalityId) => void;
  busyBadgeLabel?: 'thinking' | 'spinning' | 'synthesizing' | 'pondering' | 'musing' | 'analyzing' | 'evaluating' | 'reviewing' | 'checking';
  onReconnect?: () => void;
  awaitingDraft?: boolean;
  stagedDraft?: StagedDraftContent | null;
  draftError?: string;
  plannerFocusValidationIssues?: PlannerFocusValidationIssue[];
  onViewDraft?: () => void;
  onRefreshDraft?: () => Promise<void>;
  onFinalizeSpec?: () => Promise<boolean>;
  selectedMarkdownFile?: MarkdownFileSelection | null;
  onPickMarkdownFile?: () => void;
  onClearSelectedFile?: () => void;
  workspaceScopeSummary?: PlannerWorkspaceScopeSummary | null;
  childTaskMode?: boolean;
  onToggleChildTaskMode?: () => void;
  archivedTasks?: ArchivedTaskEntry[];
  childParentBlockedTips?: ArchivedTaskChildParentBlockedTip[];
  archivedTaskTotalCount?: number;
  selectedParentTask?: ArchivedTaskEntry | null;
  onSelectParentTask?: (task: ArchivedTaskEntry) => void;
  loadingArchivedTasks?: boolean;
  loadingChildTaskParent?: boolean;
  childTaskBlocked?: boolean;
  childScopeStatusLabel?: 'Using parent scope' | 'Child scope adjusted';
  childScopeSummary?: string;
  childScopeWarning?: string;
  childScopePanelOpen?: boolean;
  onOpenChildScopePanel?: () => void;
  onCloseChildScopePanel?: () => void;
  childScopePanelProps?: ChildScopeOverridePanelProps;
  parentArchivePreview?: ReturnType<typeof usePlannerParentArchivePreview>;
  onUploadSpec?: () => Promise<boolean>;
  onDownloadTemplate?: () => void;
};

/** Minimum visible time (ms) for the "Submitted" card before it may begin fading. */
const SUBMITTED_HOLD_MS = 1200;
/** Duration (ms) of the exit fade animation. Must match CSS sail-fade-out. */
const SUBMITTED_EXIT_MS = 400;
/** Poll interval (ms) for probing whether `.staging` has been emptied by the backend finalize. */
const STAGING_POLL_INTERVAL_MS = 150;
/** Safety-net upper bound (ms) before the modal closes regardless of `.staging` state. */
const STAGING_AWAIT_TIMEOUT_MS = 10_000;
const FINALIZE_SPEC_TIMEOUT_MS = 30_000;
const FINALIZE_SPEC_TIMEOUT_MESSAGE = 'Finalization is taking longer than expected. The task may not have been submitted. Check logs and retry.';

const LILY_GREETING = "Hi there! I'm Lily, the planning specialist. Let's figure out what you need.";
const DEFAULT_COMPOSER_PLACEHOLDER = 'Start a conversation with Lily to begin planning your task.';
const CHILD_PARENT_COMPOSER_PLACEHOLDER = 'Tell Lily what this child task should continue, change, or investigate.';
const RECENT_COMPOSER_PLACEHOLDER = 'Continue this planning thread with Lily.';
const CHILD_PARENT_REQUIRED_PLACEHOLDER = 'Select a parent task to begin child-task planning.';
const PERSONALITY_LABELS: Record<PlannerLilyPersonalityId, string> = {
  balanced: 'Balanced',
  clinical: 'Clinical',
};
function buildPersonalityLockedHint(styleName: string): string {
  return `${styleName} style locked — start a new conversation to switch.`;
}

function ScopeInfoIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="5.1" r="0.95" fill="currentColor" />
      <rect x="7.15" y="7" width="1.7" height="4.7" rx="0.85" fill="currentColor" />
    </svg>
  );
}

function LockIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <path
        d="M5 7V5a3 3 0 1 1 6 0v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="3.5"
        y="7"
        width="9"
        height="6.5"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ParentControlsChevron(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M4 6.5 L8 10.5 L12 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChildScopeSummaryAffordance({
  selectedPack,
  selection,
  title,
  flag,
  cardClassName,
}: {
  selectedPack: ContextPackCatalogEntry | undefined;
  selection: ContextPackFocusFilterSelection;
  title: string;
  flag: string;
  cardClassName: string;
}): JSX.Element {
  const triggerLabel = `${title} details`;
  return (
    <span className="planner-modal__scope-summary-affordance">
      <span className="planner-modal__scope-summary-label">{title}</span>
      <button
        type="button"
        className="planner-modal__scope-summary-trigger"
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        <ScopeInfoIcon />
      </button>
      <span className="planner-modal__scope-summary-popover">
        <FocusSelectionSummaryCard
          selectedPack={selectedPack}
          selection={selection}
          title={title}
          flag={flag}
          className={cardClassName}
        />
      </span>
    </span>
  );
}

// Regular/recent-mode scope affordance for the stage bar. Compact info trigger
// that reveals the shared scope card on hover/focus. Distinct from
// ChildScopeSummaryAffordance, which stays unchanged for child-task mode.
function WorkspaceScopeSummaryAffordance({
  summary,
}: {
  summary: PlannerWorkspaceScopeSummary;
}): JSX.Element {
  return (
    <span className="planner-modal__stage-scope">
      <button
        type="button"
        className="planner-modal__stage-scope-trigger"
        aria-label={summary.triggerLabel}
        title={summary.triggerLabel}
      >
        <ScopeInfoIcon />
      </button>
      <span className="planner-modal__stage-scope-popover">
        <FocusSelectionSummaryCard
          selectedPack={summary.selectedPack}
          selection={summary.selection}
          title={summary.title}
          flag={summary.flag}
        />
      </span>
    </span>
  );
}

function PlannerModal({
  isOpen,
  onClose,
  draft,
  composerStage,
  onPreview,
  onConfirm,
  isFollowUpDraft,
  planningEnabled,
  contractError,
  sessionStartError,
  primaryActionLabel,
  stageCopy,
  messages,
  recentConversations,
  loadingRecentConversations,
  replayInFlight,
  replaySourceRecordId = null,
  onSelectConversation,
  onReturnToBlank,
  isStreaming,
  onSendMessage,
  sessionStatus,
  lilyPersonalityId = 'balanced',
  personalityLocked = false,
  onLilyPersonalityChange,
  busyBadgeLabel = 'thinking',
  onReconnect,
  awaitingDraft,
  stagedDraft,
  draftError,
  plannerFocusValidationIssues,
  onViewDraft,
  onRefreshDraft,
  onFinalizeSpec,
  selectedMarkdownFile,
  onPickMarkdownFile,
  onClearSelectedFile,
  workspaceScopeSummary = null,
  childTaskMode,
  onToggleChildTaskMode,
  archivedTasks,
  childParentBlockedTips,
  archivedTaskTotalCount,
  selectedParentTask,
  onSelectParentTask,
  loadingArchivedTasks,
  loadingChildTaskParent,
  childTaskBlocked,
  childScopeStatusLabel,
  childScopeSummary,
  childScopeWarning,
  childScopePanelOpen,
  onOpenChildScopePanel,
  childScopePanelProps,
  parentArchivePreview,
  onUploadSpec,
  onDownloadTemplate,
}: PlannerModalProps): JSX.Element | null {
  const [inputText, setInputText] = useState('');
  const conversationRef = useRef<HTMLDivElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submittedExiting, setSubmittedExiting] = useState(false);
  const [finalizingSpec, setFinalizingSpec] = useState(false);
  const [finalizeTimeoutError, setFinalizeTimeoutError] = useState('');
  const [draftPopoutOpen, setDraftPopoutOpen] = useState(false);
  const submittedAtRef = useRef<number | null>(null);
  const recentsTriggerRef = useRef<HTMLButtonElement>(null);
  const [recentsOpen, setRecentsOpen] = useState(false);
  const [replayingRecordId, setReplayingRecordId] = useState<string | null>(null);
  const [parentControlsCollapsed, setParentControlsCollapsed] = useState(false);

  const replayingTitle = useMemo(() => {
    if (!replayingRecordId) return null;
    return recentConversations?.find((r) => r.id === replayingRecordId)?.title ?? null;
  }, [recentConversations, replayingRecordId]);

  const handleSelectRecent = useCallback((recordId: string): void => {
    setReplayingRecordId(recordId);
    onSelectConversation?.(recordId);
  }, [onSelectConversation]);

  const handleRecentsToggle = useCallback(() => {
    setRecentsOpen((v) => !v);
  }, []);

  const handleRecentsClose = useCallback(() => {
    setRecentsOpen(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setSubmitted(false);
      setSubmittedExiting(false);
      setDraftPopoutOpen(false);
      setRecentsOpen(false);
      setReplayingRecordId(null);
      setParentControlsCollapsed(false);
      submittedAtRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!stagedDraft) {
      setDraftPopoutOpen(false);
    }
  }, [stagedDraft]);

  useEffect(() => {
    if (submitted) {
      if (submittedAtRef.current === null) submittedAtRef.current = Date.now();
    } else {
      submittedAtRef.current = null;
    }
  }, [submitted]);

  // While submitted with non-empty staging, poll `.staging` so we observe the moment
  // the backend finalize runs `clearStagingArtifacts` (i.e., dropbox write succeeded).
  useEffect(() => {
    if (!submitted || !stagedDraft || !onRefreshDraft) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function tick(): void {
      if (cancelled) return;
      void onRefreshDraft?.()?.finally(() => {
        if (!cancelled) timer = setTimeout(tick, STAGING_POLL_INTERVAL_MS);
      });
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [submitted, stagedDraft, onRefreshDraft]);

  // Gated close: fade out + onClose only once `.staging` is empty AND minimum hold elapsed.
  // Safety-net timeout prevents the modal hanging if backend never confirms.
  useEffect(() => {
    if (!submitted) return;
    const startedAt = submittedAtRef.current ?? Date.now();
    let scheduled = false;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;

    function tryClose(): boolean {
      if (scheduled) return true;
      const elapsed = Date.now() - startedAt;
      const stagingEmpty = !stagedDraft;
      const holdMet = elapsed >= SUBMITTED_HOLD_MS;
      const timedOut = elapsed >= STAGING_AWAIT_TIMEOUT_MS;
      if ((stagingEmpty && holdMet) || timedOut) {
        scheduled = true;
        setSubmittedExiting(true);
        exitTimer = setTimeout(() => onClose(), SUBMITTED_EXIT_MS);
        return true;
      }
      return false;
    }

    if (tryClose()) {
      return () => { if (exitTimer) clearTimeout(exitTimer); };
    }
    const interval = setInterval(() => {
      if (tryClose()) clearInterval(interval);
    }, 100);
    return () => {
      clearInterval(interval);
      if (exitTimer) clearTimeout(exitTimer);
    };
  }, [submitted, stagedDraft, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = useCallback((): void => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInputText('');
  }, [inputText, onSendMessage]);

  const handleConfirmWithSail = useCallback((): void => {
    onConfirm();
    setSubmitted(true);
  }, [onConfirm]);

  const handleFinalizeWithSail = useCallback((): void => {
    if (!onFinalizeSpec || finalizingSpec) return;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setFinalizingSpec(true);
    setFinalizeTimeoutError('');
    const timeoutPromise = new Promise<false>((resolve) => {
      timeout = setTimeout(() => {
        timedOut = true;
        setFinalizeTimeoutError(FINALIZE_SPEC_TIMEOUT_MESSAGE);
        resolve(false);
      }, FINALIZE_SPEC_TIMEOUT_MS);
    });
    void Promise.race([onFinalizeSpec(), timeoutPromise])
      .then((ok) => {
        if (ok) setSubmitted(true);
      })
      .catch(() => {
        // Error presentation is owned by the hook via draftError; keep the modal open.
      })
      .finally(() => {
        if (timeout) clearTimeout(timeout);
        if (!timedOut) setFinalizeTimeoutError('');
        setFinalizingSpec(false);
      });
  }, [finalizingSpec, onFinalizeSpec]);

  const handleUploadSpecWithSail = useCallback(async (): Promise<void> => {
    const ok = await onUploadSpec?.();
    if (!ok) return;
    setSubmitted(true);
  }, [onUploadSpec]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  if (!isOpen) return null;
  const selectedChildTaskParent = childTaskMode && selectedParentTask ? selectedParentTask : null;
  const parentScopeSummarySelection = childScopePanelProps
    ? childScopeToFocusFilterSelection(childScopePanelProps.parentScope)
    : null;
  const adjustedChildScopeSummarySelection = childScopePanelProps && childScopeStatusLabel === 'Child scope adjusted'
    ? childScopeToFocusFilterSelection(childScopePanelProps.childScope)
    : null;
  const showInlineChildScopeSummary = !adjustedChildScopeSummarySelection;
  const parentControlsActuallyCollapsed = parentControlsCollapsed && Boolean(selectedChildTaskParent);
  const hasOperatorMessage = messages.some((msg) => msg.role === 'operator');
  const lockedStyleName = PERSONALITY_LABELS[lilyPersonalityId ?? 'balanced'];
  const personalityLockedHint = buildPersonalityLockedHint(lockedStyleName);
  const composerPlaceholder = childTaskBlocked
    ? CHILD_PARENT_REQUIRED_PLACEHOLDER
    : selectedChildTaskParent
      ? CHILD_PARENT_COMPOSER_PLACEHOLDER
      : replaySourceRecordId
        ? RECENT_COMPOSER_PLACEHOLDER
        : DEFAULT_COMPOSER_PLACEHOLDER;

  const bypassGroup = (
    <div className="planner-modal__bypass-group">
      <button
        type="button"
        className="action-button"
        onClick={onDownloadTemplate}
        title="Download a blank planning-intake template to fill out"
      >
        Download Template
      </button>
      <button
        type="button"
        className="action-button"
        onClick={() => { void handleUploadSpecWithSail(); }}
        disabled={!planningEnabled || !!childTaskBlocked}
        title="Upload a completed planning-intake markdown and submit directly — skips the Planner"
      >
        Bypass Planner
      </button>
    </div>
  );

  if (submitted) {
    return <SailScreen exiting={submittedExiting} />;
  }

  return (
    <>
    <div
      className="planner-modal__overlay"
      role="presentation"
    >
      <section
        className="planner-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Planning agent"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="planner-modal__header">
          <div className="planner-modal__header-left">
            {(childTaskMode || replaySourceRecordId !== null) && !submitted && (
              <button
                type="button"
                className="planner-modal__back"
                onClick={onReturnToBlank}
                disabled={!!replayInFlight}
                aria-label="Return to blank planner"
                title="Return to blank planner"
              >
                <BackIcon />
              </button>
            )}
            <svg className="planner-modal__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5L1.5 5v6L8 14.5 14.5 11V5L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M8 8v6.5M1.5 5L8 8l6.5-3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <h2>Planning Specialist</h2>
            {sessionStatus && sessionStatus !== 'idle' && (
              <span
                className={classNames(
                  'planner-modal__session-status',
                  `planner-modal__session-status--${sessionStatus}`,
                )}
                aria-label={`Session ${sessionStatus}`}
              >
                {sessionStatus === 'busy' ? busyBadgeLabel : sessionStatus}
              </span>
            )}
          </div>
          <div className="planner-modal__header-right">
            <div
              className={classNames(
                'planner-modal__personality-toggle',
                personalityLocked && 'planner-modal__personality-toggle--locked',
              )}
              role="group"
              aria-label="Planning style"
              data-active={lilyPersonalityId}
            >
              {!personalityLocked && (
                <span className="planner-modal__personality-thumb" aria-hidden="true" />
              )}
              {personalityLocked ? (
                <span
                  className="planner-modal__personality-lock-copy"
                  title={personalityLockedHint}
                  aria-label={`Style locked to ${lockedStyleName}. ${personalityLockedHint}`}
                >
                  <LockIcon />
                  <strong className="planner-modal__personality-lock-name">
                    {lockedStyleName}
                  </strong>
                </span>
              ) : (
                (['balanced', 'clinical'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={classNames(
                      'planner-modal__personality-option',
                      lilyPersonalityId === id && 'planner-modal__personality-option--active',
                    )}
                    onClick={() => onLilyPersonalityChange?.(id)}
                    aria-pressed={lilyPersonalityId === id}
                    aria-label={`${id === 'balanced' ? 'Balanced' : 'Clinical'} planning style`}
                  >
                    {id === 'balanced' ? 'Balanced' : 'Clinical'}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              className={classNames('planner-modal__child-task-toggle', childTaskMode && 'planner-modal__child-task-toggle--active')}
              onClick={onToggleChildTaskMode}
              disabled={!planningEnabled || personalityLocked}
              aria-pressed={!!childTaskMode}
              aria-label="Toggle child-task mode"
              title={personalityLocked ? personalityLockedHint : undefined}
            >
              Child Task
            </button>
            <RecentsTrigger
              ref={recentsTriggerRef}
              count={recentConversations?.length ?? 0}
              loading={!!loadingRecentConversations}
              replayInFlight={!!replayInFlight}
              replayingTitle={replayingTitle}
              popoverOpen={recentsOpen}
              onToggle={handleRecentsToggle}
              disabled={personalityLocked}
              disabledHint={personalityLockedHint}
            />
            <button type="button" className="planner-modal__close-btn" onClick={onClose} aria-label="Close planner">
              <CloseIcon />
            </button>
          </div>
        </header>

        <RecentsPopover
          open={recentsOpen}
          records={recentConversations ?? []}
          triggerRef={recentsTriggerRef}
          onSelect={handleSelectRecent}
          onClose={handleRecentsClose}
        />

        {childTaskMode && (
          <div className="planner-modal__parent-card" id="planner-parent-controls" aria-label="Parent task context">
            {parentControlsActuallyCollapsed ? (
              <button
                type="button"
                className="planner-modal__parent-card-restore"
                onClick={() => setParentControlsCollapsed(false)}
                aria-expanded={false}
                aria-controls="planner-parent-controls"
                aria-label="Expand parent task controls"
              >
                <span className="planner-modal__parent-card-restore-chevron" aria-hidden="true">
                  <ParentControlsChevron />
                </span>
                <span className="planner-modal__parent-card-restore-label">
                  Parent task
                  <strong>{selectedChildTaskParent?.title}</strong>
                </span>
                {childScopeStatusLabel ? (
                  <span className="planner-modal__parent-card-restore-scope">{childScopeStatusLabel}</span>
                ) : null}
              </button>
            ) : (
            <>
            <ParentTaskPicker
              selectedTask={selectedParentTask}
              tasks={archivedTasks ?? []}
              blockedTips={childTaskMode ? childParentBlockedTips ?? [] : []}
              totalCount={archivedTaskTotalCount ?? 0}
              loadingArchivedTasks={loadingArchivedTasks}
              loadingChildTaskParent={loadingChildTaskParent}
              onSelectTask={(task) => onSelectParentTask?.(task)}
            />
            {selectedChildTaskParent ? (
              <div className="planner-modal__parent-card-scope">
                <div className="planner-modal__parent-card-scope-main" aria-label="Child task context">
                  {showInlineChildScopeSummary && childScopeStatusLabel ? (
                    <span className="planner-modal__child-task-scope">{childScopeStatusLabel}</span>
                  ) : null}
                  {showInlineChildScopeSummary && childScopeSummary ? (
                    <span className="planner-modal__child-task-summary">{childScopeSummary}</span>
                  ) : null}
                  {childScopeWarning ? (
                    <span className="planner-modal__child-scope-warning">{childScopeWarning}</span>
                  ) : null}
                  {(adjustedChildScopeSummarySelection || parentScopeSummarySelection) ? (
                    <div className="planner-modal__scope-summary-affordances" aria-label="Child task scope details">
                      {adjustedChildScopeSummarySelection ? (
                        <ChildScopeSummaryAffordance
                          selectedPack={childScopePanelProps?.selectedPack}
                          selection={adjustedChildScopeSummarySelection}
                          title="Adjusted child scope"
                          flag="Execution"
                          cardClassName="planner-modal__adjusted-scope-card"
                        />
                      ) : null}
                      {parentScopeSummarySelection ? (
                        <ChildScopeSummaryAffordance
                          selectedPack={childScopePanelProps?.selectedPack}
                          selection={parentScopeSummarySelection}
                          title="Parent task scope"
                          flag={parentScopeSummarySelection.deepFocusEnabled ? 'Deep Focus' : 'Archived'}
                          cardClassName="planner-modal__parent-scope-card"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="planner-modal__parent-card-actions">
                  {onOpenChildScopePanel ? (
                    <button type="button" className="planner-modal__secondary-btn" onClick={onOpenChildScopePanel}>
                      Adjust child scope
                    </button>
                  ) : null}
                  {selectedChildTaskParent.plannerFocusSnapshot && !loadingChildTaskParent && parentArchivePreview ? (
                    <button
                      type="button"
                      className="planner-modal__secondary-btn"
                      onClick={() => { void parentArchivePreview.openForTask(selectedChildTaskParent); }}
                    >
                      {parentArchivePreview.loading ? 'Loading archive...' : 'View parent archive'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="planner-modal__parent-card-collapse"
                    onClick={() => setParentControlsCollapsed(true)}
                    aria-expanded={true}
                    aria-controls="planner-parent-controls"
                    aria-label="Collapse parent task controls"
                    title="Collapse to give the conversation more room"
                  >
                    <ParentControlsChevron />
                  </button>
                </div>
              </div>
            ) : null}
            </>
            )}
          </div>
        )}

        {childTaskMode && childScopePanelOpen && childScopePanelProps ? (
          <div className="planner-modal__child-scope-overlay" role="presentation">
            <ChildScopeOverridePanel {...childScopePanelProps} />
          </div>
        ) : null}

        {isFollowUpDraft && !selectedChildTaskParent && (
          <div className="planner-modal__followup-banner" aria-label="Follow-up lineage">
            Continuing from <strong>{draft.parentTaskId}</strong>
            {draft.rootTaskId && draft.rootTaskId !== draft.parentTaskId && (
              <> &middot; root: {draft.rootTaskId}</>
            )}
          </div>
        )}

        {stageCopy && !selectedChildTaskParent && (
          <div className="planner-modal__stage-bar">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5v3.5H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>{stageCopy}</span>
            {!childTaskMode && workspaceScopeSummary ? (
              <WorkspaceScopeSummaryAffordance summary={workspaceScopeSummary} />
            ) : null}
          </div>
        )}

        {sessionStatus === 'failed' && onReconnect && (
          <div className="planner-modal__reconnect" role="alert">
            <span>Planner session needs attention.</span>
            <button type="button" onClick={onReconnect} className="planner-modal__reconnect-btn">
              Reconnect
            </button>
          </div>
        )}

        {(contractError || sessionStartError || draftError || finalizeTimeoutError) && (
          <div className="planner-modal__error" role="alert">
            <div>{contractError || sessionStartError || draftError || finalizeTimeoutError}</div>
            {plannerFocusValidationIssues && plannerFocusValidationIssues.length > 0 && (
              <ul className="planner-modal__validation-issues">
                {plannerFocusValidationIssues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.path ?? issue.id ?? index}`}>
                    {issue.label}: {issue.path ?? issue.id}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div
          className="planner-modal__conversation"
          ref={conversationRef}
          aria-label="Conversation"
        >
          {messages.length === 0 && (
            <div className={classNames('planner-msg', 'planner-msg--planner')}>
              <div className="planner-msg__body">
                <MarkdownView content={LILY_GREETING} />
              </div>
            </div>
          )}
          {messages.map((msg, idx) => (
            <div key={msg.id} className={classNames('planner-msg', `planner-msg--${msg.role}`)}>
              {msg.role === 'planner' ? (
                <div className="planner-msg__body">
                  <MarkdownView content={msg.text} />
                  {isStreaming && idx === messages.length - 1 && (
                    <span className="planner-msg__cursor" aria-hidden="true" />
                  )}
                </div>
              ) : (
                <p>{msg.text}</p>
              )}
            </div>
          ))}
        </div>

        {selectedMarkdownFile && (
          <div className="planner-modal__selected-file" aria-label="Selected file">
            <svg className="planner-modal__selected-file-icon" width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M4 1h6l4 4v10H4V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M10 1v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <span className="planner-modal__selected-file-name" title={selectedMarkdownFile.path}>
              {selectedMarkdownFile.filename}
            </span>
            <button
              type="button"
              className="planner-modal__selected-file-clear"
              onClick={onClearSelectedFile}
              aria-label="Clear selected file"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        )}

        <div className="planner-modal__composer">
          <textarea
            placeholder={composerPlaceholder}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Planner message input"
            rows={2}
            disabled={!!childTaskBlocked}
          />
          <button type="button" onClick={onPickMarkdownFile} aria-label="Attach markdown file" className="planner-modal__attach-btn" disabled={!!childTaskBlocked} title="Attach a markdown file for Lily to review">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M7.5 2.5a3.5 3.5 0 0 1 5 0 3.5 3.5 0 0 1 0 5l-6 6a2.25 2.25 0 0 1-3.18-3.18l6-6a1 1 0 0 1 1.41 1.41l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button type="button" onClick={handleSend} aria-label="Send message" disabled={!!childTaskBlocked}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M10 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        {sessionStatus === 'active' || sessionStatus === 'busy' || sessionStatus === 'failed' ? (
          <div className="planner-modal__actions">
            <span className="planner-modal__footer-esc">ESC to close</span>
            {bypassGroup}
            <span className="planner-modal__action-divider" aria-hidden="true" />
            <button
              type="button"
              className="action-button"
              onClick={onViewDraft}
              disabled={!!isStreaming || !!awaitingDraft || !hasOperatorMessage}
              title="Ask Lily to write a planning spec from the conversation so far"
            >
              {awaitingDraft ? 'Drafting\u2026' : 'Draft Spec'}
            </button>
            <button
              type="button"
              className="action-button"
              onClick={() => { void onRefreshDraft?.()?.then(() => setDraftPopoutOpen(true)); }}
              disabled={!stagedDraft}
              title="Review the spec Lily drafted"
            >
              View Draft
            </button>
            <button
              type="button"
              className="action-button action-button--primary"
              onClick={handleFinalizeWithSail}
              disabled={!!isStreaming || sessionStatus === 'busy' || !stagedDraft || finalizingSpec}
              title="Accept Lily's draft and submit to the task queue"
            >
              {finalizingSpec ? 'Finalizing\u2026' : 'Finalize Spec'}
            </button>
          </div>
        ) : (
          <div className="planner-modal__actions">
            <span className="planner-modal__footer-esc">ESC to close</span>
            {bypassGroup}
            <span className="planner-modal__action-divider" aria-hidden="true" />
            <button
              type="button"
              className="action-button"
              onClick={onPreview}
              disabled={!planningEnabled || composerStage === 'confirm' || !!childTaskBlocked}
              title="Preview the task before submitting"
            >
              Preview Plan
            </button>
            <button
              type="button"
              className="action-button action-button--primary"
              onClick={handleConfirmWithSail}
              disabled={!planningEnabled || composerStage === 'compose' || !!childTaskBlocked}
              title="Submit this task to the queue"
            >
              {primaryActionLabel || 'Submit to Queue'}
            </button>
          </div>
        )}
      </section>
    </div>
    {stagedDraft && draftPopoutOpen && (
      <ModalShell
        isOpen={true}
        onClose={() => setDraftPopoutOpen(false)}
        title={stagedDraft.filename}
        maxWidth="700px"
        variant="terminal"
        accentColor="var(--terminal-cyan)"
        className="planner-draft-popout"
        zIndex={101}
        footer={<>
          <span className="modal-shell__footer-esc">ESC to close</span>
          <span className="planner-draft-popout__time">
            Last saved {new Date(stagedDraft.modifiedAt).toLocaleTimeString()}
          </span>
        </>}
        ariaLabel={`Draft: ${stagedDraft.filename}`}
      >
        <MarkdownView content={stagedDraft.content} />
      </ModalShell>
    )}
    {parentArchivePreview ? (
      <ParentArchivePreviewModal
        isOpen={parentArchivePreview.open}
        onClose={parentArchivePreview.close}
        loading={parentArchivePreview.loading}
        error={parentArchivePreview.error}
        archive={parentArchivePreview.archive}
        onRetry={parentArchivePreview.retry}
      />
    ) : null}
    </>
  );
}

export default PlannerModal;
