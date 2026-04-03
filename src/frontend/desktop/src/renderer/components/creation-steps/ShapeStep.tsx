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
      <div className="panel__title-row context-pack-modal__section-header">
        <div>
          <h3>
            {draft.mode === 'distributed'
              ? 'Repository estate definition'
              : 'Monolith focus definition'}
          </h3>
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
              <h3>Focus areas</h3>
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
