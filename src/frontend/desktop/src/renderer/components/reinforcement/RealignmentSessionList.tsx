import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';

type RealignmentSessionListProps = {
  sessions: ReinforcementRealignmentSessionEntry[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
};

function statusLabel(status: string): string {
  switch (status) {
    case 'open': return 'Open';
    case 'reviewed': return 'Reviewed';
    case 'archived': return 'Archived';
    default: return status;
  }
}

function RealignmentSessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
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
      {sessions.map((session) => (
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
        </li>
      ))}
    </ul>
  );
}

export default RealignmentSessionList;
