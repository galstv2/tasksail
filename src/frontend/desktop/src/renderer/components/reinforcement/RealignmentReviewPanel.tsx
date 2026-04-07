import { useState } from 'react';

import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';
import type { ActiveWorkGuardState } from '../../hooks/useActiveWorkGuard';
import ConfirmOverlay from '../ConfirmOverlay';
import { StarIcon } from '../creation-steps/icons';
import RealignmentSessionDetail from './RealignmentSessionDetail';
import RealignmentSessionList from './RealignmentSessionList';

type RealignmentReviewPanelProps = {
  hasActiveContextPack: boolean;
  sessions: ReinforcementRealignmentSessionEntry[];
  selectedSession: ReinforcementRealignmentSessionEntry | null;
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
  onSelectSession: (sessionId: string | null) => void;
  activeWorkGuard: ActiveWorkGuardState;
  onStartRealignment: () => void;
};

function RealignmentReviewPanel({
  hasActiveContextPack,
  sessions,
  selectedSession,
  selectedSessionId,
  loading,
  error,
  onSelectSession,
  activeWorkGuard,
  onStartRealignment,
}: RealignmentReviewPanelProps): JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  if (selectedSession) {
    return (
      <div className="realignment-panel" data-testid="realignment-panel">
        <RealignmentSessionDetail
          session={selectedSession}
          onBack={() => onSelectSession(null)}
        />
      </div>
    );
  }

  return (
    <div className="realignment-panel" data-testid="realignment-panel">
      <p className="realignment-panel__source-label" data-testid="realignment-source">
        Corrective review sessions for tasks in the active context pack
      </p>
      <RealignmentSessionList
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={onSelectSession}
      />
      <div className="realignment-panel__guard" data-testid="realignment-guard">
        {activeWorkGuard.status === 'blocked' && (
          <p
            className="realignment-panel__guard-blocked"
            data-testid="realignment-guard-blocked"
          >
            {activeWorkGuard.message}
          </p>
        )}
        <button
          type="button"
          className="realignment-panel__start-btn"
          disabled={activeWorkGuard.status !== 'allowed' || !activeWorkGuard.hasUnprocessedFeedback}
          onClick={() => setConfirmOpen(true)}
          data-testid="realignment-start"
        >
          {activeWorkGuard.status === 'loading'
            ? 'Checking...'
            : 'Start Corrective Realignment'}
        </button>
      </div>

      <ConfirmOverlay
        visible={confirmOpen}
        icon={<StarIcon size={20} />}
        title="Start corrective realignment?"
        body="This will analyze recent feedback, update the realignment document, and adjust agent behavior going forward."
        confirmLabel="Start realignment"
        cancelLabel="Cancel"
        autoFocusCancel
        onConfirm={() => {
          setConfirmOpen(false);
          onStartRealignment();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export default RealignmentReviewPanel;
