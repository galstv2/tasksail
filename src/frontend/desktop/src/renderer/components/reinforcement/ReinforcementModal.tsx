import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReinforcementModalProps } from '../../hooks/reinforcement/useReinforcementModal';
import { useFeedbackSubmission } from '../../hooks/reinforcement/useFeedbackSubmission';
import { useReinforcementOverview } from '../../hooks/reinforcement/useReinforcementOverview';
import { useRealignmentSessions } from '../../hooks/reinforcement/useRealignmentSessions';
import { useReinforcementTasks } from '../../hooks/reinforcement/useReinforcementTasks';
import { useRealignmentDocument } from '../../hooks/reinforcement/useRealignmentDocument';
import { useStreamEvents } from '../../hooks/observability/useStreamEvents';
import { filterSessionsForTasks, selectScopedSession } from '../../selectors/reinforcementSessionFilter';
import { CloseIcon } from '../icons';
import FeedbackPanel from './FeedbackPanel';
import GlobalRealignmentEditor from './GlobalRealignmentEditor';
import RealignmentReviewPanel from './RealignmentReviewPanel';
import ReinforcementOverviewPanel from './ReinforcementOverviewPanel';
import TaskLedgerTable from './TaskLedgerTable';

type ModalTab = 'feedback' | 'overview' | 'ledger' | 'sessions' | 'document';

const TABS: { value: ModalTab; label: string }[] = [
  { value: 'feedback', label: 'Feedback' },
  { value: 'overview', label: 'Overview' },
  { value: 'ledger', label: 'Ledger' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'document', label: 'Document' },
];

function ReinforcementModal({
  isOpen,
  onClose,
  hasActiveContextPack,
  activeContextPackDir,
}: ReinforcementModalProps): JSX.Element | null {
  const [activeTab, setActiveTab] = useState<ModalTab>('feedback');
  const [optimisticReviewedTaskIds, setOptimisticReviewedTaskIds] = useState<Set<string>>(() => new Set());

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // All four hooks are now keyed on activeContextPackDir (the identity boundary).
  const {
    tasks, availableYears, selectedYear, loading: tasksLoading,
    error: tasksError, onSelectYear, reload: reloadTasks,
  } = useReinforcementTasks(activeContextPackDir);

  const {
    overview, loading: overviewLoading, error: overviewError,
    reload: reloadOverview,
  } = useReinforcementOverview(activeContextPackDir);

  const {
    sessions, selectedSessionId,
    loading: sessionsLoading, error: sessionsError, analysisRun,
    onSelectSession, runAnalysis, dismissRealignment, completeAnalysisRun, reload: reloadSessions,
  } = useRealignmentSessions(activeContextPackDir);
  const { events: streamEvents } = useStreamEvents(50);
  const runStartEventId = useRef<string | null>(null);
  const lastCompletionEventId = useRef<string | null>(null);

  const contextPackSessions = useMemo(
    () => filterSessionsForTasks(sessions, tasks),
    [sessions, tasks],
  );
  const contextPackSelectedSession = useMemo(
    () => selectScopedSession(contextPackSessions, selectedSessionId),
    [contextPackSessions, selectedSessionId],
  );

  const doc = useRealignmentDocument(activeContextPackDir);
  const { reload: reloadDocument } = doc;

  const feedback = useFeedbackSubmission();

  const prefilled = useRef(false);
  const { onSelectTask, onSubmit: submitFeedback } = feedback;
  const currentTaskId = feedback.draft.taskId;

  // Reset optimistic state and prefill when pack changes
  const prevPackDirRef = useRef(activeContextPackDir);
  useEffect(() => {
    if (prevPackDirRef.current !== activeContextPackDir) {
      prevPackDirRef.current = activeContextPackDir;
      setOptimisticReviewedTaskIds(new Set());
      prefilled.current = false;
      feedback.onReset();
    }
  }, [activeContextPackDir]);

  useEffect(() => {
    if (tasks.length > 0 && !currentTaskId && !prefilled.current) {
      onSelectTask(tasks[0].taskId);
      prefilled.current = true;
    }
  }, [tasks, currentTaskId, onSelectTask]);

  const handleSubmit = useCallback(() => {
    if (!activeContextPackDir) return;
    // Block feedback submit if the draft taskId is not in the current loaded tasks
    const draftTaskId = feedback.draft.taskId;
    if (!draftTaskId || !tasks.some((t) => t.taskId === draftTaskId)) return;
    const submittedPackDir = activeContextPackDir;
    submitFeedback(activeContextPackDir).then((outcome) => {
      if (!outcome) return;
      // Ignore a stale continuation if the modal switched packs while the submit
      // was in flight — do not apply pack A optimistic state or reloads onto pack B.
      // prevPackDirRef.current always reflects the latest active pack.
      if (prevPackDirRef.current !== submittedPackDir) return;
      setOptimisticReviewedTaskIds((current) => new Set(current).add(outcome.taskId));
      reloadTasks();
      reloadOverview();
      reloadSessions().catch(() => {});
    }).catch(() => {});
  }, [activeContextPackDir, feedback.draft.taskId, tasks, reloadOverview, reloadSessions, reloadTasks, submitFeedback]);

  const handleRunAnalysis = useCallback(
    (realignmentId: string) => {
      if (!activeContextPackDir) return;
      runStartEventId.current = streamEvents.length > 0
        ? streamEvents[streamEvents.length - 1].id
        : null;
      runAnalysis(activeContextPackDir, realignmentId).catch(() => {});
    },
    [activeContextPackDir, runAnalysis, streamEvents.length],
  );

  const handleDismissRealignment = useCallback(
    (realignmentId: string) => {
      if (!activeContextPackDir) return;
      dismissRealignment(activeContextPackDir, realignmentId).catch(() => {});
    },
    [activeContextPackDir, dismissRealignment],
  );

  const activeRunId =
    analysisRun.status === 'running' || analysisRun.status === 'starting'
      ? analysisRun.realignmentId
      : null;

  // Complete analysisRun only when event.realignmentId matches analysisRun.realignmentId
  useEffect(() => {
    if (!activeRunId) {
      return;
    }
    const runStartIndex = runStartEventId.current
      ? streamEvents.findIndex((event) => event.id === runStartEventId.current)
      : -1;
    const candidateEvents = runStartIndex >= 0
      ? streamEvents.slice(runStartIndex + 1)
      : streamEvents;
    const terminalEvent = candidateEvents
      .find((event) => (
        event.source === 'runtime.realignment' &&
        event.realignmentId === activeRunId &&
        event.id !== lastCompletionEventId.current &&
        (
          event.message.includes('archived') ||
          event.message.includes('failed') ||
          event.message.includes('skipped') ||
          event.message.includes('partially completed')
        )
      ));
    if (!terminalEvent) {
      return;
    }
    lastCompletionEventId.current = terminalEvent.id;
    completeAnalysisRun(terminalEvent.message);
    reloadSessions().catch(() => {});
    reloadDocument().catch(() => {});
  }, [
    activeRunId,
    completeAnalysisRun,
    reloadDocument,
    reloadSessions,
    streamEvents,
  ]);

  const visibleTasks = useMemo(
    () => tasks.map((task) => (
      optimisticReviewedTaskIds.has(task.taskId)
        ? {
          ...task,
          reviewStatus: 'reviewed' as const,
          feedbackCount: Math.max(task.feedbackCount ?? 0, 1),
        }
        : task
    )),
    [optimisticReviewedTaskIds, tasks],
  );

  if (!isOpen) return null;

  return (
    <div
      className="reinforcement-modal__overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="reinforcement-modal"
        role="dialog"
        aria-label="Reinforcement"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reinforcement-modal__header">
          <h2>Reinforcement</h2>
          <div className="reinforcement-modal__tabs" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                className={`reinforcement-tab ${activeTab === tab.value ? 'reinforcement-tab--active' : ''}`}
                aria-selected={activeTab === tab.value}
                onClick={() => setActiveTab(tab.value)}
                data-testid={`tab-${tab.value}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="reinforcement-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="reinforcement-modal__body">
          {activeTab === 'feedback' && (
            <FeedbackPanel
              hasActiveContextPack={hasActiveContextPack}
              tasks={visibleTasks}
              availableYears={availableYears}
              selectedYear={selectedYear}
              tasksLoading={tasksLoading}
              tasksError={tasksError}
              draft={feedback.draft}
              submitState={feedback.submitState}
              canSubmit={feedback.canSubmit}
              onSelectYear={onSelectYear}
              onSelectTask={feedback.onSelectTask}
              onSelectFeedbackType={feedback.onSelectFeedbackType}
              onSelectStarRating={feedback.onSelectStarRating}
              onChangeComment={feedback.onChangeComment}
              onSubmit={handleSubmit}
              onReset={feedback.onReset}
            />
          )}
          {activeTab === 'overview' && (
            <ReinforcementOverviewPanel
              hasActiveContextPack={hasActiveContextPack}
              overview={overview}
              loading={overviewLoading}
              error={overviewError}
            />
          )}
          {activeTab === 'ledger' && (
            <TaskLedgerTable
              hasActiveContextPack={hasActiveContextPack}
              tasks={visibleTasks}
              availableYears={availableYears}
              selectedYear={selectedYear}
              loading={tasksLoading}
              error={tasksError}
              onSelectYear={onSelectYear}
            />
          )}
          {activeTab === 'sessions' && (
            <RealignmentReviewPanel
              hasActiveContextPack={hasActiveContextPack}
              sessions={contextPackSessions}
              selectedSession={contextPackSelectedSession}
              selectedSessionId={selectedSessionId}
              loading={sessionsLoading || tasksLoading}
              error={sessionsError}
              onSelectSession={onSelectSession}
              analysisRun={analysisRun}
              onRunAnalysis={handleRunAnalysis}
              onDismissRealignment={handleDismissRealignment}
            />
          )}
          {activeTab === 'document' && (
            <GlobalRealignmentEditor
              hasActiveContextPack={hasActiveContextPack}
              draft={doc.draft}
              updatedAt={doc.updatedAt}
              loading={doc.loading}
              loadError={doc.loadError}
            />
          )}
        </div>
        <div className="reinforcement-modal__footer">
          <span className="reinforcement-modal__footer-esc">ESC to close</span>
        </div>
      </div>
    </div>
  );
}

export default ReinforcementModal;
