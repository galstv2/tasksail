import type { ContextPackCreationModalProps } from '../../contextPackCreationTypes';
import RepositoryCard from './RepositoryCard';
import FocusAreaCard from './FocusAreaCard';

type ShapeStepProps = Pick<
  ContextPackCreationModalProps,
  | 'busy'
  | 'draft'
  | 'onAddRepository'
  | 'onRemoveRepository'
  | 'onRepositoryFieldChange'
  | 'onSetPrimaryRepository'
  | 'onAddFocusArea'
  | 'onRemoveFocusArea'
  | 'onFocusAreaFieldChange'
  | 'onSetPrimaryFocusArea'
>;

function ShapeStep({
  busy,
  draft,
  onAddRepository,
  onRemoveRepository,
  onRepositoryFieldChange,
  onSetPrimaryRepository,
  onAddFocusArea,
  onRemoveFocusArea,
  onFocusAreaFieldChange,
  onSetPrimaryFocusArea,
}: ShapeStepProps): JSX.Element {
  return (
    <div className="context-pack-modal__body">
      {draft.creationOrigin === 'new' ? (
        <div className="context-pack-modal__new-project-hint">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>
            Your project is ready. Adjust advanced details below or go straight to Review.
          </span>
        </div>
      ) : null}

      <div className="panel__title-row context-pack-modal__section-header">
        <div>
          <p className="context-pack-modal__section-label">
            {draft.mode === 'distributed'
              ? 'Repository estate definition'
              : 'Monolith focus definition'}
          </p>
          <p className="panel__meta">
            {draft.mode === 'distributed'
              ? 'Discovery suggestions stay editable and extra repositories can be added manually.'
              : 'Define the main monolith repo, optional attached datapmse repos, and focus areas.'}
          </p>
        </div>
        <button
          type="button"
          className="action-button action-button--secondary"
          disabled={busy}
          onClick={onAddRepository}
        >
          {draft.mode === 'distributed' ? 'Add repository' : 'Add datapmse repo'}
        </button>
      </div>

      <div className="context-pack-modal__editor-list">
        {draft.repositories.map((repository, index) => (
          <RepositoryCard
            key={repository.key}
            repository={repository}
            index={index}
            mode={draft.mode}
            busy={busy}
            onRepositoryFieldChange={onRepositoryFieldChange}
            onSetPrimaryRepository={onSetPrimaryRepository}
            onRemoveRepository={onRemoveRepository}
          />
        ))}
      </div>

      {draft.mode === 'monolith' ? (
        <>
          <div className="panel__title-row context-pack-modal__section-header">
            <div>
              <p className="context-pack-modal__section-label">Focus areas</p>
              <p className="panel__meta">
                Focus areas come from discovery but remain editable.
              </p>
            </div>
            <button
              type="button"
              className="action-button action-button--secondary"
              disabled={busy}
              onClick={onAddFocusArea}
            >
              Add focus area
            </button>
          </div>
          <div className="context-pack-modal__editor-list">
            {draft.focusAreas.map((focusArea, index) => (
              <FocusAreaCard
                key={focusArea.key}
                focusArea={focusArea}
                index={index}
                busy={busy}
                onFocusAreaFieldChange={onFocusAreaFieldChange}
                onSetPrimaryFocusArea={onSetPrimaryFocusArea}
                onRemoveFocusArea={onRemoveFocusArea}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default ShapeStep;
