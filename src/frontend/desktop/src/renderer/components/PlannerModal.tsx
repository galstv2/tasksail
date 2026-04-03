import { useCallback, useEffect, useRef, useState } from 'react';

import type { ArchivedTaskEntry, MarkdownFileSelection, StagedDraftContent } from '../../shared/desktopContract';
import type { ComposerStage, PlannerConversationMessage, PlannerDraftModel } from '../plannerComposer';
import { getPlannerConversationLabel } from '../../shared/agentRoster';
import { classNames } from '../utils/classNames';
import SailScreen from './SailScreen';
import TaskMarkdownView from './taskboard/TaskMarkdownView';

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
  onFinalizeSpec?: () => void;
  onDismissDraftPreview?: () => void;
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
};

type SailPhase = 'countdown' | 'sailing' | null;

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
  onFinalizeSpec,
  onDismissDraftPreview,
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
}: PlannerModalProps): JSX.Element | null {
  const [inputText, setInputText] = useState('');
  const conversationRef = useRef<HTMLDivElement>(null);
  const [sailPhase, setSailPhase] = useState<SailPhase>(null);
  const [countdown, setCountdown] = useState(3);
  const [draftViewMode, setDraftViewMode] = useState<'rendered' | 'source'>('rendered');

  useEffect(() => {
    if (!isOpen) {
      setSailPhase(null);
      setCountdown(3);
      setDraftViewMode('rendered');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!stagedDraft) setDraftViewMode('rendered');
  }, [stagedDraft]);

  useEffect(() => {
    if (sailPhase !== 'countdown') return;
    if (countdown <= 0) {
      setSailPhase('sailing');
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [sailPhase, countdown]);

  useEffect(() => {
    if (sailPhase !== 'sailing') return;
    const timer = setTimeout(() => {
      onClose();
    }, 2500);
    return () => clearTimeout(timer);
  }, [sailPhase, onClose]);

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
    setSailPhase('countdown');
    setCountdown(3);
  }, [onConfirm]);

  const handleFinalizeWithSail = useCallback((): void => {
    onFinalizeSpec?.();
    setSailPhase('countdown');
    setCountdown(3);
  }, [onFinalizeSpec]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  if (!isOpen) return null;

  if (sailPhase !== null) {
    return <SailScreen sailPhase={sailPhase} countdown={countdown} />;
  }

  return (
    <div
      className="planner-modal__overlay"
      onClick={onClose}
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
                {sessionStatus}
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
            <button type="button" onClick={onClose} aria-label="Close planner">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
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
          {messages.length === 0 ? (
            <div className="planner-modal__empty">
              <svg width="32" height="32" viewBox="0 0 16 16" fill="none" opacity="0.3">
                <path d="M2 4h12v8H5l-3 2V4z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                <path d="M5 7h6M5 9h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
              <p>Start a conversation to begin planning your task.</p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={msg.id} className={classNames('planner-msg', `planner-msg--${msg.role}`)}>
                <span className="planner-msg__role">
                  {msg.role === 'operator' ? 'You' : getPlannerConversationLabel(msg.role)}
                </span>
                <p>
                  {msg.text}
                  {isStreaming && msg.role === 'planner' && idx === messages.length - 1 && (
                    <span className="planner-msg__cursor" aria-hidden="true">{'\u2588'}</span>
                  )}
                </p>
              </div>
            ))
          )}
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
            placeholder={childTaskBlocked ? 'Select a parent task to begin child-task planning.' : "Describe what you'd like to build..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Planner message input"
            rows={2}
            disabled={!!childTaskBlocked}
          />
          <button type="button" onClick={onPickMarkdownFile} aria-label="Attach markdown file" className="planner-modal__attach-btn" disabled={!!childTaskBlocked}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M7.5 2.5a3.5 3.5 0 0 1 5 0 3.5 3.5 0 0 1 0 5l-6 6a2.25 2.25 0 0 1-3.18-3.18l6-6a1 1 0 0 1 1.41 1.41l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button type="button" onClick={handleSend} aria-label="Send message" disabled={!!childTaskBlocked}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M10 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        {stagedDraft && (
          <div className="planner-modal__draft-preview" aria-label="Draft preview">
            <div className="planner-modal__draft-preview-header">
              <span className="planner-modal__draft-preview-filename">{stagedDraft.filename}</span>
              <span className="planner-modal__draft-preview-time">
                {new Date(stagedDraft.modifiedAt).toLocaleTimeString()}
              </span>
              <div className="planner-modal__draft-preview-tabs">
                <button
                  type="button"
                  className={classNames('planner-modal__draft-preview-tab', draftViewMode === 'rendered' && 'planner-modal__draft-preview-tab--active')}
                  onClick={() => setDraftViewMode('rendered')}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className={classNames('planner-modal__draft-preview-tab', draftViewMode === 'source' && 'planner-modal__draft-preview-tab--active')}
                  onClick={() => setDraftViewMode('source')}
                >
                  Source
                </button>
              </div>
              <button
                type="button"
                className="planner-modal__draft-preview-dismiss"
                onClick={onDismissDraftPreview}
                aria-label="Dismiss draft preview"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="planner-modal__draft-preview-body">
              {draftViewMode === 'rendered' ? (
                <TaskMarkdownView content={stagedDraft.content} />
              ) : (
                <pre className="planner-modal__draft-preview-source">{stagedDraft.content}</pre>
              )}
            </div>
          </div>
        )}

        {sessionStatus === 'active' || sessionStatus === 'busy' || sessionStatus === 'failed' ? (
          <div className="planner-modal__actions">
            <span className="planner-modal__footer-esc">ESC to close</span>
            <button
              type="button"
              className="action-button"
              onClick={onViewDraft}
              disabled={!!isStreaming || !!awaitingDraft}
            >
              {awaitingDraft ? 'Drafting\u2026' : 'Draft Spec'}
            </button>
            <button
              type="button"
              className="action-button action-button--primary"
              onClick={handleFinalizeWithSail}
              disabled={!!isStreaming || sessionStatus === 'busy' || !stagedDraft}
            >
              Finalize Spec
            </button>
          </div>
        ) : (
          <div className="planner-modal__actions">
            <span className="planner-modal__footer-esc">ESC to close</span>
            <button
              type="button"
              className="action-button"
              onClick={onPreview}
              disabled={!planningEnabled || composerStage === 'confirm' || !!childTaskBlocked}
            >
              Preview Plan
            </button>
            <button
              type="button"
              className="action-button action-button--primary"
              onClick={handleConfirmWithSail}
              disabled={!planningEnabled || composerStage === 'compose' || !!childTaskBlocked}
            >
              {primaryActionLabel || 'Submit to Queue'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default PlannerModal;
