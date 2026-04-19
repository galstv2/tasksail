import { useCallback, useEffect, useRef, useState } from 'react';

import type { ArchivedTaskEntry, MarkdownFileSelection, StagedDraftContent } from '../../shared/desktopContract';
import type { ComposerStage, PlannerConversationMessage, PlannerDraftModel } from '../plannerComposer';
import { classNames } from '../utils/classNames';
import { CloseIcon } from './creation-steps/icons';
import SailScreen from './SailScreen';
import MarkdownView from './MarkdownView';
import ModalShell from './ModalShell';

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
  primaryActionLabel: string;
  stageCopy: string;
  messages: PlannerConversationMessage[];
  isStreaming?: boolean;
  onSendMessage: (text: string) => void;
  sessionStatus?: PlannerSessionStatus;
  onReconnect?: () => void;
  awaitingDraft?: boolean;
  stagedDraft?: StagedDraftContent | null;
  draftError?: string;
  onViewDraft?: () => void;
  onRefreshDraft?: () => Promise<void>;
  onFinalizeSpec?: () => void;
  selectedMarkdownFile?: MarkdownFileSelection | null;
  onPickMarkdownFile?: () => void;
  onClearSelectedFile?: () => void;
  childTaskMode?: boolean;
  onToggleChildTaskMode?: () => void;
  archivedTasks?: ArchivedTaskEntry[];
  selectedParentTask?: ArchivedTaskEntry | null;
  onSelectParentTask?: (task: ArchivedTaskEntry) => void;
  loadingArchivedTasks?: boolean;
  childTaskBlocked?: boolean;
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

const LILY_GREETING = "Hi there! I'm Lily, the planning specialist. Let's figure out what you need.";

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
  primaryActionLabel,
  stageCopy,
  messages,
  isStreaming,
  onSendMessage,
  sessionStatus,
  onReconnect,
  awaitingDraft,
  stagedDraft,
  draftError,
  onViewDraft,
  onRefreshDraft,
  onFinalizeSpec,
  selectedMarkdownFile,
  onPickMarkdownFile,
  onClearSelectedFile,
  childTaskMode,
  onToggleChildTaskMode,
  archivedTasks,
  selectedParentTask,
  onSelectParentTask,
  loadingArchivedTasks,
  childTaskBlocked,
  onUploadSpec,
  onDownloadTemplate,
}: PlannerModalProps): JSX.Element | null {
  const [inputText, setInputText] = useState('');
  const conversationRef = useRef<HTMLDivElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submittedExiting, setSubmittedExiting] = useState(false);
  const [draftPopoutOpen, setDraftPopoutOpen] = useState(false);
  const submittedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSubmitted(false);
      setSubmittedExiting(false);
      setDraftPopoutOpen(false);
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
    onFinalizeSpec?.();
    setSubmitted(true);
  }, [onFinalizeSpec]);

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
        title="Upload a completed planning-intake markdown and submit directly — skips Lily"
      >
        Bypass Lily
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
                {sessionStatus === 'busy' ? 'thinking' : sessionStatus}
              </span>
            )}
          </div>
          <div className="planner-modal__header-right">
            <button
              type="button"
              className={classNames('planner-modal__child-task-toggle', childTaskMode && 'planner-modal__child-task-toggle--active')}
              onClick={onToggleChildTaskMode}
              disabled={!planningEnabled}
              aria-pressed={!!childTaskMode}
              aria-label="Toggle child-task mode"
            >
              Child Task
            </button>
            <button type="button" className="planner-modal__close-btn" onClick={onClose} aria-label="Close planner">
              <CloseIcon />
            </button>
          </div>
        </header>

        {childTaskMode && (
          <div className="planner-modal__parent-select" aria-label="Parent task selection">
            <label htmlFor="parent-task-select">Parent task:</label>
            <select
              id="parent-task-select"
              value={selectedParentTask?.taskId ?? ''}
              onChange={(e) => {
                const task = archivedTasks?.find((t) => t.taskId === e.target.value);
                if (task) onSelectParentTask?.(task);
              }}
              disabled={loadingArchivedTasks}
            >
              <option value="">
                {loadingArchivedTasks
                  ? 'Loading archived tasks...'
                  : archivedTasks && archivedTasks.length > 0
                    ? 'Select a completed parent task...'
                    : 'No completed tasks found in archive'}
              </option>
              {archivedTasks?.map((task) => (
                <option key={task.taskId} value={task.taskId}>
                  {task.title} ({task.year})
                </option>
              ))}
            </select>
          </div>
        )}

        {isFollowUpDraft && (
          <div className="planner-modal__followup-banner" aria-label="Follow-up lineage">
            Continuing from <strong>{draft.parentTaskId}</strong>
            {draft.rootTaskId && draft.rootTaskId !== draft.parentTaskId && (
              <> &middot; root: {draft.rootTaskId}</>
            )}
          </div>
        )}

        {stageCopy && (
          <div className="planner-modal__stage-bar">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5v3.5H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>{stageCopy}</span>
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

        {(contractError || draftError) && (
          <div className="planner-modal__error" role="alert">
            {contractError || draftError}
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
            placeholder={childTaskBlocked ? 'Select a parent task to begin child-task planning.' : messages.length === 0 ? 'Start a conversation with Lily to begin planning your task.' : ''}
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
            <button
              type="button"
              className="action-button"
              onClick={onViewDraft}
              disabled={!!isStreaming || !!awaitingDraft || messages.length === 0}
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
              disabled={!!isStreaming || sessionStatus === 'busy' || !stagedDraft}
              title="Accept Lily's draft and submit to the task queue"
            >
              Finalize Spec
            </button>
          </div>
        ) : (
          <div className="planner-modal__actions">
            <span className="planner-modal__footer-esc">ESC to close</span>
            {bypassGroup}
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
    </>
  );
}

export default PlannerModal;
