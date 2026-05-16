import { useState } from 'react';

import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';
import type { RealignmentAnalysisRunState } from '../../hooks/useRealignmentSessions';
import ConfirmOverlay from '../ConfirmOverlay';
import { CloseIcon, StarIcon } from '../creation-steps/icons';
import RealignmentSessionDetail from './RealignmentSessionDetail';
import RealignmentSessionList from './RealignmentSessionList';
import { realignmentActionLabel } from './realignmentSessionActions';

type RealignmentReviewPanelProps = {
  hasActiveContextPack: boolean;
  sessions: ReinforcementRealignmentSessionEntry[];
  selectedSession: ReinforcementRealignmentSessionEntry | null;
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
  onSelectSession: (sessionId: string | null) => void;
  analysisRun: RealignmentAnalysisRunState;
  onRunAnalysis: (realignmentId: string) => void;
  onDismissRealignment: (realignmentId: string) => void;
};

function RealignmentReviewPanel({
  hasActiveContextPack,
  sessions,
  selectedSession,
  selectedSessionId,
  loading,
  error,
  onSelectSession,
  analysisRun,
  onRunAnalysis,
  onDismissRealignment,
}: RealignmentReviewPanelProps): JSX.Element {
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [dismissConfirmOpen, setDismissConfirmOpen] = useState(false);
  const selectedAction = selectedSession ? realignmentActionLabel(selectedSession.status) : null;
  const selectedRunActive =
    Boolean(selectedSession) &&
    analysisRun.status !== 'idle' &&
    analysisRun.realignmentId === selectedSession?.realignmentId &&
    (analysisRun.status === 'starting' || analysisRun.status === 'running');
  const runningSession = sessions.find((session) => session.status === 'running') ?? null;
  const realignmentLocked = Boolean(runningSession) || (
    analysisRun.status !== 'idle' &&
    (analysisRun.status === 'starting' || analysisRun.status === 'running')
  );
  const selectedDismissable = Boolean(selectedSession)
    && selectedSession?.status !== 'running'
    && selectedSession?.status !== 'reviewed'
    && selectedSession?.status !== 'archived';
  const startDisabled =
    !selectedAction ||
    selectedRunActive ||
    (realignmentLocked && selectedSession?.status !== 'running');
  if (!hasActiveContextPack) {
    return (
      <div className="realignment-panel" data-testid="realignment-panel">
        <p className="realignment-panel__empty" data-testid="realignment-empty">
          Activate a context pack to view realignment sessions.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="realignment-panel" data-testid="realignment-panel">
        <p className="realignment-panel__error" data-testid="realignment-error">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="realignment-panel" data-testid="realignment-panel">
        <p className="realignment-panel__loading">Loading sessions...</p>
      </div>
    );
  }

  return (
    <div className="realignment-panel" data-testid="realignment-panel">
      <p className="realignment-panel__source-label" data-testid="realignment-source">
        Corrective review sessions for the active context pack. Click an open task to perform realignment action.
      </p>
      {selectedSession ? (
        <RealignmentSessionDetail
          session={selectedSession}
          onBack={() => onSelectSession(null)}
          analysisRun={analysisRun}
        />
      ) : (
        <RealignmentSessionList
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          analysisRun={analysisRun}
        />
      )}
      {(selectedSession || realignmentLocked) && (
        <div className="realignment-panel__guard" data-testid="realignment-guard">
          {realignmentLocked && (
            <p className="realignment-panel__hint" data-testid="realignment-lock-hint">
              Realignment is in progress. Another realignment can start after it finishes or fails.
            </p>
          )}
          {selectedSession && (
            <div className="realignment-panel__actions">
              <button
                type="button"
                className="realignment-panel__start-btn"
                disabled={startDisabled}
                onClick={() => setStartConfirmOpen(true)}
                data-testid="realignment-start"
              >
                {selectedRunActive || selectedSession.status === 'running'
                  ? 'Analysis running...'
                  : selectedSession.status === 'error'
                    ? 'Retry Corrective Realignment'
                    : 'Start Corrective Realignment'}
              </button>
              <button
                type="button"
                className="realignment-panel__dismiss-btn"
                disabled={!selectedDismissable}
                onClick={() => setDismissConfirmOpen(true)}
                data-testid="realignment-dismiss"
              >
                Dismiss Realignment
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmOverlay
        visible={startConfirmOpen}
        icon={<StarIcon size={20} />}
        title="Start corrective realignment?"
        body="This will analyze recent feedback, update the realignment document, and adjust agent behavior going forward."
        confirmLabel="Start realignment"
        cancelLabel="Cancel"
        autoFocusCancel
        onConfirm={() => {
          setStartConfirmOpen(false);
          if (selectedSession && selectedAction) {
            onRunAnalysis(selectedSession.realignmentId);
          }
        }}
        onCancel={() => setStartConfirmOpen(false)}
      />
      <ConfirmOverlay
        visible={dismissConfirmOpen}
        icon={<CloseIcon />}
        title="Dismiss realignment?"
        body="This removes the selected realignment recommendation from the active review list."
        confirmLabel="Dismiss"
        cancelLabel="Cancel"
        confirmVariant="danger"
        autoFocusCancel
        onConfirm={() => {
          setDismissConfirmOpen(false);
          if (selectedSession) {
            onDismissRealignment(selectedSession.realignmentId);
          }
        }}
        onCancel={() => setDismissConfirmOpen(false)}
      />
    </div>
  );
}

export default RealignmentReviewPanel;
