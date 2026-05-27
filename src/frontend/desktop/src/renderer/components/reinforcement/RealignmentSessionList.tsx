import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';
import type { RealignmentAnalysisRunState } from '../../hooks/useRealignmentSessions';
import { realignmentRunMessage } from './realignmentSessionActions';

type RealignmentSessionListProps = {
  sessions: ReinforcementRealignmentSessionEntry[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
  analysisRun: RealignmentAnalysisRunState;
};

function statusLabel(status: string): string {
  switch (status) {
    case 'open': return 'Open';
    case 'running': return 'In Progress';
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
                <span className={`status-chip status-chip--sm status-chip--${session.status === 'open' || session.status === 'running' ? 'active' : 'idle'}`}>
                  {statusLabel(session.status)}
                </span>
              </div>
              <div className="session-list__item-meta">
                <span>
                  Task <span className="session-list__meta-mono">{session.triggerTaskId}</span>
                </span>
                <span>{session.createdAt.slice(0, 10) || '\u2014'}</span>
              </div>
            </button>
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
