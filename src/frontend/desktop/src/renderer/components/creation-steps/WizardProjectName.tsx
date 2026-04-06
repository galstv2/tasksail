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
      <div>
        <h3>Give your project a name</h3>
        <p className="panel__meta">
          This is how your project will appear in the dashboard. You can change it anytime.
        </p>
      </div>

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
