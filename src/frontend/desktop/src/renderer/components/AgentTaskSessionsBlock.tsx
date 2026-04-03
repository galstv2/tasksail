import type { AgentTerminalSession } from '../../shared/desktopContract';
import { classNames } from '../utils/classNames';

type AgentTaskSessionsBlockProps = {
  title: string;
  meta: string;
  emptyMessage: string;
  agentTerminalSessions: AgentTerminalSession[];
};

function humanizeStateLabel(value: string): string {
  return value.replace(/-/g, ' ');
}

function formatSessionSummary(session: AgentTerminalSession): string {
  return [
    session.taskId ? `task ${session.taskId}` : 'task unavailable',
    session.lastUpdatedAt ?? 'awaiting-update',
  ].join(' · ');
}

function terminalStateChipClassName(
  state: AgentTerminalSession['terminalState'],
): string {
  switch (state) {
    case 'running':
      return 'status-chip status-chip--active';
    case 'failed':
      return 'status-chip status-chip--blocked';
    case 'completed':
      return 'status-chip status-chip--completed';
    default:
      return 'status-chip status-chip--idle';
  }
}

function launchStateChipClassName(
  state: AgentTerminalSession['launchState'],
): string {
  switch (state) {
    case 'started':
      return 'status-chip status-chip--active';
    case 'failed':
      return 'status-chip status-chip--blocked';
    case 'completed':
      return 'status-chip status-chip--completed';
    default:
      return 'status-chip status-chip--idle';
  }
}

function livenessChipClassName(
  state: AgentTerminalSession['liveness'],
): string {
  switch (state) {
    case 'alive':
      return 'status-chip status-chip--active';
    case 'not-found':
      return 'status-chip status-chip--blocked';
    default:
      return 'status-chip status-chip--idle';
  }
}

function stuckStateChipClassName(
  state: AgentTerminalSession['stuckState'],
): string {
  switch (state) {
    case 'orphaned':
      return 'status-chip status-chip--blocked';
    case 'suspected-stuck':
      return 'status-chip status-chip--active';
    default:
      return 'status-chip status-chip--idle';
  }
}

function guardrailStateChipClassName(
  state: AgentTerminalSession['guardrailStatus'],
): string {
  switch (state) {
    case 'denied':
    case 'malformed':
      return 'status-chip status-chip--blocked';
    case 'internal-bypass':
      return 'status-chip status-chip--active';
    case 'allowed':
      return 'status-chip status-chip--completed';
    default:
      return 'status-chip status-chip--idle';
  }
}

function AgentTaskSessionsBlock({
  title,
  meta,
  emptyMessage,
  agentTerminalSessions,
}: AgentTaskSessionsBlockProps): JSX.Element {
  return (
    <div className="notes-block">
      <div className="panel__title-row">
        <h3>{title}</h3>
        <span className="panel__meta">{meta}</span>
      </div>
      <div className="terminal stream-terminal terminal-session-grid" aria-label={title}>
        {agentTerminalSessions.length === 0 ? (
          <p className="stream-empty">{emptyMessage}</p>
        ) : null}
        {agentTerminalSessions.map((session) => (
          <article
            key={session.sessionId}
            className={classNames('stream-event', 'terminal-session-card', `stream-event--${session.severity === 'error' ? 'system' : 'workflow'}`)}
          >
            <div className="stream-event__meta-row">
              <span className="stream-role stream-role--workflow">{session.agentLabel}</span>
              <span className={classNames('stream-severity', `stream-severity--${session.severity}`)}>
                {session.severity}
              </span>
            </div>
            <p className="stream-event__metadata">{formatSessionSummary(session)}</p>
            <div className="status-chip-row stream-chip-row" aria-label={`${session.agentLabel} identity`}>
              {session.instanceId ? (
                <span className="status-chip status-chip--owner">Instance {session.instanceId}</span>
              ) : null}
              {session.launchPid !== null ? (
                <span className="status-chip status-chip--owner">PID {session.launchPid}</span>
              ) : null}
              {session.sliceId ? (
                <span className="status-chip status-chip--owner">Slice {session.sliceId}</span>
              ) : (
                <span className="status-chip status-chip--owner">Task-scoped session</span>
              )}
              <span className="status-chip status-chip--owner">Session {session.sessionId}</span>
            </div>
            <div className="status-chip-row stream-chip-row" aria-label={`${session.agentLabel} states`}>
              <span className={launchStateChipClassName(session.launchState)}>
                Launch {session.launchState}
              </span>
              <span className={terminalStateChipClassName(session.terminalState)}>
                Terminal {session.terminalState}
              </span>
              <span className={livenessChipClassName(session.liveness)}>
                PID {humanizeStateLabel(session.liveness)}
              </span>
              {session.stuckState !== 'none' ? (
                <span className={stuckStateChipClassName(session.stuckState)}>
                  {humanizeStateLabel(session.stuckState)}
                </span>
              ) : null}
            </div>
            <p className="stream-event__message">
              {session.sliceId
                ? `${session.sliceId} · ${session.slicePath ?? 'slice path unavailable'}`
                : 'Task-scoped session'}
            </p>
            {session.stuckReason ? (
              <p className="stream-event__metadata">{session.stuckReason}</p>
            ) : null}
            {session.guardrailStatus ? (
              <>
                <div
                  className="status-chip-row stream-chip-row"
                  aria-label={`${session.agentLabel} guardrails`}
                >
                  <span
                    className={guardrailStateChipClassName(
                      session.guardrailStatus,
                    )}
                  >
                    Guardrail {humanizeStateLabel(session.guardrailStatus)}
                  </span>
                  {session.guardrailViolationCount ? (
                    <span className="status-chip status-chip--owner">
                      Violations {session.guardrailViolationCount}
                    </span>
                  ) : null}
                </div>
                {session.guardrailReason ? (
                  <p className="stream-event__metadata">
                    {session.guardrailReason}
                  </p>
                ) : null}
                {session.guardrailReceiptPath ? (
                  <p className="stream-event__metadata">
                    Receipt {session.guardrailReceiptPath}
                  </p>
                ) : null}
              </>
            ) : null}
            {session.latestOutputLines.length > 0 ? (
              <pre
                className="stream-event__message stream-event__excerpt"
              >
                {session.latestOutputLines.join('\n')}
              </pre>
            ) : (
              <p className="stream-empty">No terminal excerpt observed yet.</p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

export default AgentTaskSessionsBlock;
