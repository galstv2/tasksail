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
  return (
    <section className="context-pack-modal__wizard-section">
      <p className="context-pack-modal__wizard-heading">
        Name your project
      </p>

      <label className="composer-field">
        <span>Display name</span>
        <input
          value={estateName}
          onChange={(event) => onEstateNameChange(event.target.value)}
        />
      </label>

      <div className="context-pack-modal__grid">
        <label className="composer-field">
          <span>Context pack ID</span>
          <div
            className={`context-pack-modal__destination${
              !contextPackId.trim() ? ' context-pack-modal__destination--empty' : ''
            }`}
          >
            {contextPackId.trim() || 'Set a project name to generate'}
          </div>
        </label>

        <label className="composer-field">
          <span>Pack destination</span>
          <div
            className={`context-pack-modal__destination${
              !contextPackDir.trim() ? ' context-pack-modal__destination--empty' : ''
            }`}
          >
            {contextPackDir.trim() || 'Choose a location to generate'}
          </div>
        </label>
      </div>
    </section>
  );
}

export default WizardProjectName;
