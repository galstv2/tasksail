import type { ReinforcementRealignmentSessionEntry } from '../../../shared/desktopContract';
import type { RealignmentAnalysisRunState } from '../../hooks/useRealignmentSessions';
import {
  realignmentActionLabel,
  realignmentRunMessage,
} from './realignmentSessionActions';

type RealignmentSessionDetailProps = {
  session: ReinforcementRealignmentSessionEntry;
  onBack: () => void;
  analysisRun: RealignmentAnalysisRunState;
  onRunAnalysis: (realignmentId: string) => void;
};

function RealignmentSessionDetail({
  session,
  onBack,
  analysisRun,
  onRunAnalysis,
}: RealignmentSessionDetailProps): JSX.Element {
  const label = realignmentActionLabel(session.status);
  const isCurrentRun =
    analysisRun.status !== 'idle' &&
    analysisRun.realignmentId === session.realignmentId &&
    (analysisRun.status === 'starting' || analysisRun.status === 'running');
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

      <h3 className="session-detail__title">{session.realignmentId}</h3>

      {label && (
        <button
          type="button"
          className="session-detail__analysis-btn"
          disabled={isCurrentRun}
          onClick={() => onRunAnalysis(session.realignmentId)}
          data-testid={`realignment-detail-run-${session.realignmentId}`}
        >
          {isCurrentRun ? 'Analysis running...' : label}
        </button>
      )}
      {message && (
        <p
          className={`session-detail__analysis-message session-detail__analysis-message--${analysisRun.status}`}
          data-testid={`realignment-detail-run-message-${session.realignmentId}`}
        >
          {message}
        </p>
      )}

      <div className="session-detail__meta">
        <span>Status: {session.status}</span>
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
