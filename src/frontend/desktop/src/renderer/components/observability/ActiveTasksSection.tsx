import type {
  AgentTerminalSession,
  ArtifactReference,
  TaskLifecycleFeed,
} from '../../../shared/desktopContract';
import { classNames } from '../../utils/classNames';

type ActiveTasksSectionProps = {
  activeTasks: TaskLifecycleFeed[];
  artifactReferences?: Array<ArtifactReference & { taskId?: string | null }>;
  agentTerminalSessions?: AgentTerminalSession[];
};

function lifecycleChip(stage: TaskLifecycleFeed['workflowStage']): { label: string; className: string } {
  switch (stage) {
    case 'active':
      return { label: 'Active', className: 'status-chip status-chip--active' };
    case 'blocked':
      return { label: 'Blocked', className: 'status-chip status-chip--blocked' };
    case 'complete':
      return { label: 'Complete', className: 'status-chip status-chip--completed' };
    case 'queued':
      return { label: 'Queued', className: 'status-chip status-chip--owner' };
    default:
      return { label: 'Idle', className: 'status-chip status-chip--idle' };
  }
}

function guardrailChip(status: NonNullable<TaskLifecycleFeed['guardrailSummary']>['status']): { label: string; className: string } {
  switch (status) {
    case 'critical':
      return { label: 'Critical', className: 'status-chip status-chip--blocked' };
    case 'attention':
      return { label: 'Attention', className: 'status-chip status-chip--active' };
    case 'healthy':
      return { label: 'Healthy', className: 'status-chip status-chip--completed' };
    default:
      return { label: 'Idle', className: 'status-chip status-chip--idle' };
  }
}

function statusLabel(status: ArtifactReference['status']): string {
  if (status === 'present') return 'Available';
  if (status === 'empty') return 'Empty';
  return 'Not found';
}

type ActiveTaskRowProps = {
  feed: TaskLifecycleFeed;
  artifacts: Array<ArtifactReference & { taskId?: string | null }>;
  sessions: AgentTerminalSession[];
};

function ActiveTaskRow({ feed, artifacts, sessions }: ActiveTaskRowProps): JSX.Element {
  const lifecycle = lifecycleChip(feed.workflowStage);
  const taskSessions = sessions.filter((s) => s.taskId === feed.taskId);
  const sessionCount = taskSessions.length;

  return (
    <div className="obs-active-task" aria-label={`Active task ${feed.taskId ?? 'unknown'}`}>
      <div className="obs-active-task__header">
        <span className="obs-active-task__title">{feed.taskTitle ?? 'Unnamed task'}</span>
        {feed.taskId && (
          <span className="obs-active-task__id">{feed.taskId}</span>
        )}
      </div>
      <div className="status-chip-row obs-active-task__chips" aria-label={`Task ${feed.taskId ?? ''} status chips`}>
        <span className={lifecycle.className}>{lifecycle.label}</span>
        <span className="status-chip status-chip--owner">
          {sessionCount} session{sessionCount === 1 ? '' : 's'}
        </span>
        {feed.taskHealth && (
          <span className={classNames(
            'status-chip',
            feed.taskHealth.status === 'critical' ? 'status-chip--blocked'
              : feed.taskHealth.status === 'attention' ? 'status-chip--active'
              : 'status-chip--completed',
          )}>
            Health {feed.taskHealth.status}
          </span>
        )}
        {feed.recoveryState && (
          <span className="status-chip status-chip--active">
            Recovery {feed.recoveryState.status.replace(/-/g, ' ')}
          </span>
        )}
        {feed.guardrailSummary && (() => {
          const chip = guardrailChip(feed.guardrailSummary.status);
          return (
            <span className={chip.className} aria-label={`Task ${feed.taskId ?? ''} guardrail posture`}>
              Guardrails {chip.label}
            </span>
          );
        })()}
      </div>
      {artifacts.length > 0 && (
        <div className="obs-active-task__artifacts">
          {artifacts.map((artifact) => (
            <div key={artifact.path} className="obs-file-row obs-file-row--compact">
              <span className="obs-file-row__name">{artifact.label}</span>
              <span className={classNames(
                'obs-file-row__status',
                `obs-file-row__status--${artifact.status === 'present' ? 'ok' : artifact.status === 'empty' ? 'warn' : 'missing'}`,
              )}>
                {statusLabel(artifact.status)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveTasksSection({
  activeTasks,
  artifactReferences = [],
  agentTerminalSessions = [],
}: ActiveTasksSectionProps): JSX.Element {
  return (
    <section className="obs-section obs-active-tasks-section">
      <h3 className="obs-section__title">Active Tasks</h3>
      <p className="obs-section__desc">
        Each task running right now — its lifecycle stage, agent sessions, recovery state, artifacts, and per-task guardrail posture.
      </p>
      {activeTasks.length === 0 ? (
        <p className="obs-section__empty">No tasks are currently active.</p>
      ) : (
        <div className="obs-active-task-list">
          {activeTasks.map((feed) => {
            const taskArtifacts = artifactReferences.filter((a) => a.taskId === feed.taskId);
            const taskSessions = agentTerminalSessions.filter((s) => s.taskId === feed.taskId);
            return (
              <ActiveTaskRow
                key={feed.taskId ?? feed.taskTitle ?? 'unknown'}
                feed={feed}
                artifacts={taskArtifacts}
                sessions={taskSessions}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

export default ActiveTasksSection;
