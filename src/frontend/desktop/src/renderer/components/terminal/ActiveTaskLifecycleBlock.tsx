import type { TaskLifecycleFeed } from '../../../shared/desktopContract';
import { classNames } from '../../utils/classNames';

type ActiveTaskLifecycleBlockProps = {
  activeTask: TaskLifecycleFeed;
  sessionCount: number;
};

function lifecycleChipClassName(stage: TaskLifecycleFeed['workflowStage']): string {
  switch (stage) {
    case 'active':
      return 'status-chip status-chip--active';
    case 'blocked':
      return 'status-chip status-chip--blocked';
    case 'complete':
      return 'status-chip status-chip--completed';
    default:
      return 'status-chip status-chip--idle';
  }
}

function taskHealthChipClassName(status: NonNullable<TaskLifecycleFeed['taskHealth']>['status']): string {
  switch (status) {
    case 'critical':
      return 'status-chip status-chip--blocked';
    case 'attention':
      return 'status-chip status-chip--active';
    case 'healthy':
      return 'status-chip status-chip--completed';
    default:
      return 'status-chip status-chip--idle';
  }
}

function guardrailChipClassName(
  status: NonNullable<TaskLifecycleFeed['guardrailSummary']>['status'],
): string {
  switch (status) {
    case 'critical':
      return 'status-chip status-chip--blocked';
    case 'attention':
      return 'status-chip status-chip--active';
    case 'healthy':
      return 'status-chip status-chip--completed';
    default:
      return 'status-chip status-chip--idle';
  }
}

function recoveryChipClassName(
  status: NonNullable<TaskLifecycleFeed['recoveryState']>['status'],
): string {
  switch (status) {
    case 'auto-failed':
    case 'recovery-needed':
      return 'status-chip status-chip--blocked';
    case 'pending-start':
      return 'status-chip status-chip--active';
    case 'repaired':
      return 'status-chip status-chip--completed';
    default:
      return 'status-chip status-chip--idle';
  }
}

function humanizeState(value: string): string {
  return value.replace(/-/g, ' ');
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ActiveTaskLifecycleBlock({ activeTask, sessionCount }: ActiveTaskLifecycleBlockProps): JSX.Element {
  return (
    <div className="notes-block active-task-block">
      <div className="panel__title-row">
        <h3>Active task</h3>
        <span className="panel__meta">repo-observed task thread</span>
      </div>
      <h4 className="summary-panel__title">{activeTask.taskTitle ?? 'Unnamed task'}</h4>
      <p className="panel__lede active-task-block__meta">
        {activeTask.taskId ? `${activeTask.taskId} · ` : ''}
        {activeTask.activePath ?? activeTask.sourceArtifact ?? 'repo-observer'}
      </p>
      <div className="status-chip-row task-lifecycle-chip-row" aria-label="Active task summary chips">
        <span className={lifecycleChipClassName(activeTask.workflowStage)}>
          Stage {activeTask.workflowStage}
        </span>
        <span className="status-chip status-chip--owner">
          Kind {activeTask.taskKind ?? 'unset'}
        </span>
        <span
          className={classNames(
            'status-chip',
            activeTask.parallelizationEnabled ? 'status-chip--active' : 'status-chip--idle',
          )}
        >
          {activeTask.parallelizationEnabled ? 'Fleet mode' : 'Single agent'}
        </span>
        <span className="status-chip status-chip--owner">
          {sessionCount} session{sessionCount === 1 ? '' : 's'} observed
        </span>
      </div>
      <p className="stream-event__metadata">
        {[
          activeTask.startedAt ? `started ${activeTask.startedAt}` : null,
          activeTask.lastUpdatedAt ? `updated ${activeTask.lastUpdatedAt}` : null,
        ].join(' · ')}
      </p>
      {activeTask.taskHealth ? (
        <>
          <div className="panel__title-row task-health-rollup__title-row">
            <h3>Operator summary</h3>
            <span className="panel__meta">runtime-derived health rollup</span>
          </div>
          <p className="panel__lede">{activeTask.taskHealth.summary}</p>
          <div className="status-chip-row task-lifecycle-chip-row" aria-label="Active task health chips">
            <span className={taskHealthChipClassName(activeTask.taskHealth.status)}>
              Health {humanizeState(activeTask.taskHealth.status)}
            </span>
            <span className="status-chip status-chip--owner">
              Running {activeTask.taskHealth.runningCount}
            </span>
            <span className="status-chip status-chip--owner">
              Completed {activeTask.taskHealth.completedCount}
            </span>
            {activeTask.taskHealth.suspectedStuckCount > 0 ? (
              <span className="status-chip status-chip--active">
                Suspected stuck {activeTask.taskHealth.suspectedStuckCount}
              </span>
            ) : null}
            {activeTask.taskHealth.orphanedCount > 0 ? (
              <span className="status-chip status-chip--blocked">
                Orphaned {activeTask.taskHealth.orphanedCount}
              </span>
            ) : null}
            {activeTask.taskHealth.failedCount > 0 ? (
              <span className="status-chip status-chip--blocked">
                Failed {activeTask.taskHealth.failedCount}
              </span>
            ) : null}
            <span className="status-chip status-chip--owner">
              PID alive {activeTask.taskHealth.aliveCount}
            </span>
          </div>
        </>
      ) : null}
      {activeTask.recoveryState ? (
        <>
          <div className="panel__title-row task-health-rollup__title-row">
            <h3>Recovery status</h3>
            <span className="panel__meta">desktop safeguard controller</span>
          </div>
          <p className="panel__lede">{activeTask.recoveryState.summary}</p>
          <div className="status-chip-row task-lifecycle-chip-row" aria-label="Active task recovery chips">
            <span className={recoveryChipClassName(activeTask.recoveryState.status)}>
              Recovery {humanizeState(activeTask.recoveryState.status)}
            </span>
            <span className="status-chip status-chip--owner">
              Kind {humanizeState(activeTask.recoveryState.kind)}
            </span>
            {activeTask.recoveryState.deadlineAt ? (
              <span className="status-chip status-chip--owner">
                Deadline {formatDeadline(activeTask.recoveryState.deadlineAt)}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
      {activeTask.guardrailSummary ? (
        <>
          <div className="panel__title-row task-health-rollup__title-row">
            <h3>Guardrail summary</h3>
            <span className="panel__meta">receipt-derived launch posture</span>
          </div>
          <p className="panel__lede">{activeTask.guardrailSummary.summary}</p>
          <div
            className="status-chip-row task-lifecycle-chip-row"
            aria-label="Active task guardrail chips"
          >
            <span
              className={guardrailChipClassName(
                activeTask.guardrailSummary.status,
              )}
            >
              Guardrails {humanizeState(activeTask.guardrailSummary.status)}
            </span>
            <span className="status-chip status-chip--owner">
              Receipts {activeTask.guardrailSummary.observedReceiptCount}
            </span>
            {activeTask.guardrailSummary.allowedCount > 0 ? (
              <span className="status-chip status-chip--completed">
                Allowed {activeTask.guardrailSummary.allowedCount}
              </span>
            ) : null}
            {activeTask.guardrailSummary.internalBypassCount > 0 ? (
              <span className="status-chip status-chip--active">
                Internal bypass {activeTask.guardrailSummary.internalBypassCount}
              </span>
            ) : null}
            {activeTask.guardrailSummary.deniedCount > 0 ? (
              <span className="status-chip status-chip--blocked">
                Denied {activeTask.guardrailSummary.deniedCount}
              </span>
            ) : null}
            {activeTask.guardrailSummary.malformedCount > 0 ? (
              <span className="status-chip status-chip--blocked">
                Malformed {activeTask.guardrailSummary.malformedCount}
              </span>
            ) : null}
            {activeTask.guardrailSummary.violationCount > 0 ? (
              <span className="status-chip status-chip--owner">
                Violations {activeTask.guardrailSummary.violationCount}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default ActiveTaskLifecycleBlock;
