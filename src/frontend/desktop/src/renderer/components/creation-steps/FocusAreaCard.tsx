import type {
  ContextPackCreationModalProps,
  FocusAreaEntryDraft,
} from '../../contextPackCreationTypes';
import { classNames } from '../../utils/classNames';

type FocusAreaCardProps = {
  focusArea: FocusAreaEntryDraft;
  index: number;
  busy: boolean;
  onFocusAreaFieldChange: ContextPackCreationModalProps['onFocusAreaFieldChange'];
  onSetPrimaryFocusArea: ContextPackCreationModalProps['onSetPrimaryFocusArea'];
  onRemoveFocusArea: ContextPackCreationModalProps['onRemoveFocusArea'];
};

function FocusAreaCard({
  focusArea,
  index,
  busy,
  onFocusAreaFieldChange,
  onSetPrimaryFocusArea,
  onRemoveFocusArea,
}: FocusAreaCardProps): JSX.Element {
  const trimmedRelativePath = focusArea.relativePath.trim();
  const relativePathWarning =
    focusArea.relativePath.startsWith('/')
      ? 'Relative path should not start with "/".'
      : focusArea.relativePath.includes('..')
        ? 'Relative path should not contain "..".'
        : trimmedRelativePath.endsWith('/')
          ? 'Relative path should not end with "/".'
          : focusArea.primary && !trimmedRelativePath
            ? 'The working folder needs a relative path.'
            : null;

  return (
    <article className="context-pack-modal__editor-card">
      <div className="panel__title-row context-pack-modal__card-header">
        <div>
          <span className="context-pack-modal__card-label">
            Focus area {index + 1}
            {focusArea.repositoryType ? (
              <span
                className={classNames(
                  'scope-focus-row__type',
                  focusArea.repositoryType === 'primary' && 'scope-focus-row__type--primary',
                )}
              >
                {focusArea.repositoryType === 'primary' ? 'Active' : 'Context'}
              </span>
            ) : null}
          </span>
          <p className="panel__meta">Editable monolith focus suggestion.</p>
        </div>
        <button
          type="button"
          className="action-button action-button--secondary"
          disabled={busy}
          onClick={() => onRemoveFocusArea(focusArea.key)}
        >
          Remove
        </button>
      </div>

      <div className="context-pack-modal__grid">
        <label className="composer-field">
          <span>Focus ID</span>
          <input
            value={focusArea.focusId}
            onChange={(event) =>
              onFocusAreaFieldChange(focusArea.key, 'focusId', event.target.value)
            }
          />
        </label>
        <label className="composer-field">
          <span>Focus name</span>
          <input
            value={focusArea.focusName}
            onChange={(event) =>
              onFocusAreaFieldChange(focusArea.key, 'focusName', event.target.value)
            }
          />
        </label>
        <label className="composer-field">
          <span>Relative path</span>
          <input
            value={focusArea.relativePath}
            onChange={(event) =>
              onFocusAreaFieldChange(focusArea.key, 'relativePath', event.target.value)
            }
          />
          {relativePathWarning ? (
            <span className="panel__meta" role="status">
              {relativePathWarning}
            </span>
          ) : null}
        </label>
        <label className="composer-field">
          <span>Focus type</span>
          <input
            value={focusArea.focusType}
            onChange={(event) =>
              onFocusAreaFieldChange(focusArea.key, 'focusType', event.target.value)
            }
          />
        </label>
        <label className="composer-field">
          <span>Group</span>
          <input
            value={focusArea.group}
            onChange={(event) =>
              onFocusAreaFieldChange(focusArea.key, 'group', event.target.value)
            }
          />
        </label>
      </div>

      <button
        type="button"
        className={classNames(
          'context-pack-modal__toggle-pill',
          focusArea.primary && 'context-pack-modal__toggle-pill--active',
        )}
        onClick={() => onSetPrimaryFocusArea(focusArea.key)}
        aria-pressed={focusArea.primary}
      >
        <span className="context-pack-modal__toggle-dot" />
        Start from here
      </button>
    </article>
  );
}

export default FocusAreaCard;
