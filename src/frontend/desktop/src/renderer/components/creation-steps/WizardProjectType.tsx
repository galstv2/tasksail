import type { ContextPackCreationDraft } from '../../contextPackCreationTypes';
import { classNames } from '../../utils/classNames';

type WizardProjectTypeProps = {
  busy: boolean;
  mode: ContextPackCreationDraft['mode'];
  onSelect: (mode: ContextPackCreationDraft['mode']) => void;
};

function WizardProjectType({
  busy,
  mode,
  onSelect,
}: WizardProjectTypeProps): JSX.Element {
  return (
    <section className="context-pack-modal__wizard-section">
      <div>
        <h3>What kind of project are you building?</h3>
        <p className="panel__meta">
          Choose the structure that best matches how your code is organized.
        </p>
      </div>

      <div className="context-pack-modal__wizard-type-grid">
        <button
          type="button"
          className={classNames(
            'context-pack-modal__editor-card',
            'context-pack-modal__wizard-choice-card',
            mode === 'monolith' && 'context-pack-modal__editor-card--active',
          )}
          disabled={busy}
          onClick={() => onSelect('monolith')}
        >
          <span className="context-pack-modal__wizard-choice-kicker">Single repo</span>
          <h4>Monolith</h4>
          <p className="panel__meta">
            All components share the same repository, organized into folders.
          </p>
        </button>

        <button
          type="button"
          className={classNames(
            'context-pack-modal__editor-card',
            'context-pack-modal__wizard-choice-card',
            mode === 'distributed' && 'context-pack-modal__editor-card--active',
          )}
          disabled={busy}
          onClick={() => onSelect('distributed')}
        >
          <span className="context-pack-modal__wizard-choice-kicker">Multi-repo</span>
          <h4>Distributed</h4>
          <p className="panel__meta">
            Each component has its own repository. They may interact with each other.
          </p>
        </button>
      </div>
    </section>
  );
}

export default WizardProjectType;
