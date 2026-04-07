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
      <p className="context-pack-modal__wizard-heading">
        What kind of project are you building?
      </p>

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
          <strong>Monolith</strong>
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
          <strong>Distributed</strong>
          <p className="panel__meta">
            Each component has its own repository. They may interact with each other.
          </p>
        </button>
      </div>
    </section>
  );
}

export default WizardProjectType;
