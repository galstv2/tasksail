import type { ArtifactReference } from '../../../shared/desktopContract';
import { classNames } from '../../utils/classNames';

/** Accept both the plain ArtifactReference and the taskId-tagged variant emitted by the IPC snapshot. */
type ArtifactReferencesSectionProps = {
  artifactReferences: Array<ArtifactReference & { taskId?: string | null }>;
};

function statusLabel(status: string): string {
  if (status === 'present') return 'Available';
  if (status === 'empty') return 'Empty';
  return 'Not found';
}

function ArtifactRow({ artifact }: { artifact: ArtifactReference & { taskId?: string | null } }): JSX.Element {
  return (
    <div key={artifact.path} className="obs-file-row">
      <div className="obs-file-row__header">
        <span className="obs-file-row__name">{artifact.label}</span>
        <span
          className={classNames('obs-file-row__status', `obs-file-row__status--${artifact.status === 'present' ? 'ok' : artifact.status === 'empty' ? 'warn' : 'missing'}`)}
        >
          {statusLabel(artifact.status)}
        </span>
      </div>
      {artifact.detail && (
        <span className="obs-file-row__detail">{artifact.detail}</span>
      )}
    </div>
  );
}

function ArtifactReferencesSection({ artifactReferences }: ArtifactReferencesSectionProps): JSX.Element {
  // Group by taskId so repeated handoff/ImplementationSteps labels remain attributable.
  const taskIds = [...new Set(artifactReferences.map((a) => a.taskId ?? null))];
  const hasMultipleTasks = taskIds.length > 1 || (taskIds.length === 1 && taskIds[0] !== null);
  const grouped = taskIds.map((taskId) => ({
    taskId,
    artifacts: artifactReferences.filter((a) => (a.taskId ?? null) === taskId),
  }));

  return (
    <section className="obs-section">
      <h3 className="obs-section__title">Task Files</h3>
      <p className="obs-section__desc">Important files that the team creates as they work through the task — plans, specs, test results, and final deliverables.</p>
      {artifactReferences.length === 0 ? (
        <p className="obs-section__empty">No files have been created yet. They will appear here as the task progresses.</p>
      ) : (
        <div className="obs-file-list" aria-label="Task files">
          {grouped.map(({ taskId, artifacts }) => (
            <div key={taskId ?? '__unscoped__'} className="obs-artifact-group">
              {hasMultipleTasks && taskId && (
                <div className="obs-artifact-group__label" aria-label={`Artifacts for task ${taskId}`}>
                  {taskId}
                </div>
              )}
              {artifacts.map((artifact) => (
                <ArtifactRow key={artifact.path} artifact={artifact} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default ArtifactReferencesSection;
