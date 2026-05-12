import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';
import type { RealignmentAnalysisRunState } from '../../hooks/useRealignmentSessions';
import {
  realignmentActionLabel,
  realignmentRunMessage,
} from './realignmentSessionActions';

type RealignmentSessionListProps = {
  sessions: ReinforcementRealignmentSessionEntry[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
  analysisRun: RealignmentAnalysisRunState;
  onRunAnalysis: (realignmentId: string) => void;
};

function statusLabel(status: string): string {
  switch (status) {
    case 'open': return 'Open';
    case 'reviewed': return 'Reviewed';
    case 'archived': return 'Archived';
    case 'error': return 'Error';
    default: return status;
  }
}

function RealignmentSessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
  analysisRun,
  onRunAnalysis,
}: RealignmentSessionListProps): JSX.Element {
  if (sessions.length === 0) {
    return (
      <p className="session-list__empty" data-testid="session-list-empty">
        No realignment sessions recorded.
      </p>
    );
  }

  return (
    <ul className="session-list" data-testid="session-list">
      {sessions.map((session) => {
        const label = realignmentActionLabel(session.status);
        const isCurrentRun =
          analysisRun.status !== 'idle' &&
          analysisRun.realignmentId === session.realignmentId &&
          (analysisRun.status === 'starting' || analysisRun.status === 'running');
        const message = realignmentRunMessage(session, analysisRun);
        return (
          <li key={session.realignmentId}>
            <button
              type="button"
              className={`session-list__item ${session.realignmentId === selectedSessionId ? 'session-list__item--selected' : ''}`}
              onClick={() => onSelectSession(
                session.realignmentId === selectedSessionId ? null : session.realignmentId,
              )}
              data-testid={`session-item-${session.realignmentId}`}
            >
              <div className="session-list__item-header">
                <span className="session-list__id">{session.realignmentId}</span>
                <span className={`status-chip status-chip--sm status-chip--${session.status === 'open' ? 'active' : 'idle'}`}>
                  {statusLabel(session.status)}
                </span>
              </div>
              <div className="session-list__item-meta">
                <span>Task: {session.triggerTaskId}</span>
                <span>{session.createdAt.slice(0, 10) || '\u2014'}</span>
              </div>
            </button>
            {label && (
              <button
                type="button"
                className="session-list__analysis-btn"
                disabled={isCurrentRun}
                onClick={() => onRunAnalysis(session.realignmentId)}
                data-testid={`realignment-run-${session.realignmentId}`}
              >
                {isCurrentRun ? 'Analysis running...' : label}
              </button>
            )}
            {message && (
              <p
                className={`session-list__analysis-message session-list__analysis-message--${analysisRun.status}`}
                data-testid={`realignment-run-message-${session.realignmentId}`}
              >
                {message}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default RealignmentSessionList;
