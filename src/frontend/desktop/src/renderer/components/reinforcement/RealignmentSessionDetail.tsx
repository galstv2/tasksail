import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';
import type { RealignmentAnalysisRunState } from '../../hooks/reinforcement/useRealignmentSessions';
import { realignmentRunMessage } from './realignmentSessionActions';

type RealignmentSessionDetailProps = {
  session: ReinforcementRealignmentSessionEntry;
  onBack: () => void;
  analysisRun: RealignmentAnalysisRunState;
};

function statusLabel(status: string): string {
  if (status === 'running') return 'In Progress';
  return status;
}

function RealignmentSessionDetail({
  session,
  onBack,
  analysisRun,
}: RealignmentSessionDetailProps): JSX.Element {
  const message = realignmentRunMessage(session, analysisRun);

  return (
    <div className="session-detail" data-testid="session-detail">
      <button
        type="button"
        className="session-detail__back"
        onClick={onBack}
        data-testid="session-detail-back"
      >
        &larr; Back to list
      </button>

      <h3 className="session-detail__title">
        <span className="session-detail__title-eyebrow">Realignment</span>
        <span className="session-detail__title-id">{session.realignmentId}</span>
      </h3>

      {message && (
        <p
          className={`session-detail__analysis-message session-detail__analysis-message--${analysisRun.status}`}
          data-testid={`realignment-detail-run-message-${session.realignmentId}`}
        >
          {message}
        </p>
      )}

      <div className="session-detail__meta">
        <span>Status: {statusLabel(session.status)}</span>
        <span>Created: {session.createdAt.slice(0, 10) || '\u2014'}</span>
      </div>

      <div className="session-detail__section">
        <h4>Trigger</h4>
        <p>Task: {session.triggerTaskId}</p>
        {session.triggerFeedbackId && <p>Feedback: {session.triggerFeedbackId}</p>}
      </div>

      <div className="session-detail__section">
        <h4>Participating Agents</h4>
        {session.participatingAgents.length > 0 ? (
          <ul className="session-detail__agent-list">
            {session.participatingAgents.map((agent) => (
              <li key={agent}>{agent}</li>
            ))}
          </ul>
        ) : (
          <p className="session-detail__empty-field">None specified.</p>
        )}
      </div>

      {session.failureAnalysis && (
        <div className="session-detail__section">
          <h4>Failure Analysis</h4>
          <p>{session.failureAnalysis}</p>
        </div>
      )}

      {session.rootCause && (
        <div className="session-detail__section">
          <h4>Root Cause</h4>
          <p>{session.rootCause}</p>
        </div>
      )}

      {session.correctiveActions.length > 0 && (
        <div className="session-detail__section">
          <h4>Corrective Actions</h4>
          <ul className="session-detail__action-list">
            {session.correctiveActions.map((action, i) => (
              <li key={i}>{action}</li>
            ))}
          </ul>
        </div>
      )}

      {session.meetingNotes && (
        <div className="session-detail__section">
          <h4>Meeting Notes</h4>
          <p className="session-detail__notes">{session.meetingNotes}</p>
        </div>
      )}
    </div>
  );
}

export default RealignmentSessionDetail;
