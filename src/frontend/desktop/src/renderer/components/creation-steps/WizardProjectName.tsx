import { classNames } from '../../utils/classNames';

type WizardProjectNameProps = {
  estateName: string;
  contextPackId: string;
  contextPackDir: string;
  onEstateNameChange: (value: string) => void;
};

function WizardProjectName({
  estateName,
  contextPackId,
  contextPackDir,
  onEstateNameChange,
}: WizardProjectNameProps): JSX.Element {
  const hasId = Boolean(contextPackId.trim());
  const hasDir = Boolean(contextPackDir.trim());

  return (
    <section className="context-pack-modal__wizard-section">
      <header className="context-pack-modal__wizard-section-header">
        <p className="context-pack-modal__project-type-header">Name your project</p>
        <p className="context-pack-modal__wizard-heading">
          We'll generate an ID and destination from your name.
        </p>
      </header>

      <label className="composer-field">
        <span>Display name</span>
        <input
          value={estateName}
          onChange={(event) => onEstateNameChange(event.target.value)}
        />
      </label>

      <div className="context-pack-modal__summary-list">
        <div className="context-pack-modal__summary-row">
          <span className="context-pack-modal__summary-label">Context pack ID</span>
          <span
            className={classNames(
              'context-pack-modal__summary-value',
              'context-pack-modal__summary-value--mono',
              !hasId && 'context-pack-modal__summary-value--empty',
            )}
          >
            {hasId ? contextPackId : 'Set a name to generate'}
          </span>
        </div>
        <div className="context-pack-modal__summary-row context-pack-modal__summary-row--stacked">
          <span className="context-pack-modal__summary-label">Pack destination</span>
          <span
            className={classNames(
              'context-pack-modal__summary-value',
              'context-pack-modal__summary-value--mono',
              !hasDir && 'context-pack-modal__summary-value--empty',
            )}
          >
            {hasDir ? contextPackDir : 'Choose a location to generate'}
          </span>
        </div>
      </div>
    </section>
  );
}

export default WizardProjectName;
