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

function ArtifactReferencesSection({ artifactReferences }: ArtifactReferencesSectionProps): JSX.Element {
  return (
    <section className="obs-section">
      <h3 className="obs-section__title">Task Files</h3>
      <p className="obs-section__desc">Important files that the team creates as they work through the task — plans, specs, test results, and final deliverables.</p>
      {artifactReferences.length === 0 ? (
        <p className="obs-section__empty">No files have been created yet. They will appear here as the task progresses.</p>
      ) : (
        <div className="obs-file-list" aria-label="Task files">
          {artifactReferences.map((artifact) => (
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
          ))}
        </div>
      )}
    </section>
  );
}

export default ArtifactReferencesSection;
