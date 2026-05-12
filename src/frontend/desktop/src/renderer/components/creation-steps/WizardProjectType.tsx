import type { ContextPackCreationDraft } from '../../contextPackCreationTypes';
import { classNames } from '../../utils/classNames';

type WizardProjectTypeProps = {
  busy: boolean;
  mode: ContextPackCreationDraft['mode'];
  onModeChange: (mode: ContextPackCreationDraft['mode']) => void;
  onContinue: () => void;
};

type ApplicationShape = 'monolith' | 'distributed';
type InfrastructureRepoChoice = 'none' | 'with-infrastructure';

function modeToProjectTypeSelection(mode: ContextPackCreationDraft['mode']): {
  applicationShape: ApplicationShape;
  infrastructureRepos: InfrastructureRepoChoice;
} {
  return {
    applicationShape:
      mode === 'monolith' || mode === 'monolith-platform' ? 'monolith' : 'distributed',
    infrastructureRepos:
      mode === 'monolith-platform' || mode === 'distributed-platform'
        ? 'with-infrastructure'
        : 'none',
  };
}

function projectTypeSelectionToMode(
  applicationShape: ApplicationShape,
  infrastructureRepos: InfrastructureRepoChoice,
): ContextPackCreationDraft['mode'] {
  if (applicationShape === 'monolith') {
    return infrastructureRepos === 'with-infrastructure' ? 'monolith-platform' : 'monolith';
  }
  return infrastructureRepos === 'with-infrastructure' ? 'distributed-platform' : 'distributed';
}

function modeSummaryLabel(mode: ContextPackCreationDraft['mode']): string {
  switch (mode) {
    case 'monolith':
      return 'Monolith';
    case 'monolith-platform':
      return 'Monolith + infrastructure repos';
    case 'distributed':
      return 'Distributed';
    case 'distributed-platform':
      return 'Distributed + infrastructure repos';
  }
}

function WizardProjectType({
  busy,
  mode,
  onModeChange,
  onContinue,
}: WizardProjectTypeProps): JSX.Element {
  const { applicationShape, infrastructureRepos } = modeToProjectTypeSelection(mode);

  return (
    <section className="context-pack-modal__wizard-section context-pack-modal__project-type">
      <p className="context-pack-modal__project-type-header">How is this project organized?</p>
      <p className="context-pack-modal__wizard-heading">
        Pick the shape. Details come next.
      </p>

      <fieldset className="context-pack-modal__project-type-group">
        <legend className="context-pack-modal__project-type-label">Application shape</legend>
        <div className="context-pack-modal__seg-control">
          <label
            className={classNames(
              'context-pack-modal__seg-option',
              applicationShape === 'monolith' && 'context-pack-modal__seg-option--active',
            )}
          >
            <input
              type="radio"
              name="application-shape"
              value="monolith"
              checked={applicationShape === 'monolith'}
              onChange={() =>
                onModeChange(projectTypeSelectionToMode('monolith', infrastructureRepos))
              }
            />
            Monolith
          </label>
          <label
            className={classNames(
              'context-pack-modal__seg-option',
              applicationShape === 'distributed' &&
                'context-pack-modal__seg-option--active',
            )}
          >
            <input
              type="radio"
              name="application-shape"
              value="distributed"
              checked={applicationShape === 'distributed'}
              onChange={() =>
                onModeChange(projectTypeSelectionToMode('distributed', infrastructureRepos))
              }
            />
            Distributed
          </label>
        </div>
      </fieldset>

      <fieldset className="context-pack-modal__project-type-group">
        <legend className="context-pack-modal__project-type-label">Infrastructure repos</legend>
        <p className="context-pack-modal__project-type-help">
          Repos that support your application but ship separately — like
          deployment, CI/CD, IaC, or database schema repos.
        </p>
        <div className="context-pack-modal__seg-control">
          <label
            className={classNames(
              'context-pack-modal__seg-option',
              infrastructureRepos === 'none' && 'context-pack-modal__seg-option--active',
            )}
          >
            <input
              type="radio"
              name="infrastructure-repos"
              value="none"
              checked={infrastructureRepos === 'none'}
              onChange={() =>
                onModeChange(projectTypeSelectionToMode(applicationShape, 'none'))
              }
            />
            No
          </label>
          <label
            className={classNames(
              'context-pack-modal__seg-option',
              infrastructureRepos === 'with-infrastructure' &&
                'context-pack-modal__seg-option--active',
            )}
          >
            <input
              type="radio"
              name="infrastructure-repos"
              value="with-infrastructure"
              checked={infrastructureRepos === 'with-infrastructure'}
              onChange={() =>
                onModeChange(projectTypeSelectionToMode(applicationShape, 'with-infrastructure'))
              }
            />
            Yes
          </label>
        </div>
      </fieldset>

      <p className="context-pack-modal__project-type-summary">
        Selected: <strong>{modeSummaryLabel(mode)}</strong>
      </p>

      <div className="context-pack-modal__project-type-actions">
        <button
          type="button"
          className="action-button"
          disabled={busy}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

export default WizardProjectType;
