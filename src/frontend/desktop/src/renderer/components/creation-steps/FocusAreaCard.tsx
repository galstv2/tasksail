import type {
  ContextPackCreationModalProps,
  FocusAreaEntryDraft,
} from '../../contextPack/contextPackCreationTypes';
import { CloseIcon } from '../icons';
import { toTitleCase } from '../../utils/toTitleCase';

type FocusAreaCardProps = {
  focusArea: FocusAreaEntryDraft;
  index: number;
  busy: boolean;
  onFocusAreaFieldChange: ContextPackCreationModalProps['onFocusAreaFieldChange'];
  onRemoveFocusArea: ContextPackCreationModalProps['onRemoveFocusArea'];
};

function FocusAreaCard({
  focusArea,
  index,
  busy,
  onFocusAreaFieldChange,
  onRemoveFocusArea,
}: FocusAreaCardProps): JSX.Element {
  const trimmedRelativePath = focusArea.relativePath.trim();
  const hasTraversalSegment = focusArea.relativePath
    .split(/[\\/]/)
    .some((segment) => segment === '..');
  const relativePathWarning =
    focusArea.relativePath.startsWith('/')
      ? 'Relative path should not start with "/".'
      : focusArea.relativePath.startsWith('\\')
        ? 'Relative path should not start with "\\".'
        : /^[A-Za-z]:[\\/]/.test(focusArea.relativePath)
          ? 'Relative path should not be a Windows drive path.'
          : hasTraversalSegment
            ? 'Relative path should not contain a ".." segment.'
            : trimmedRelativePath.endsWith('/')
              ? 'Relative path should not end with "/".'
              : trimmedRelativePath.endsWith('\\')
                ? 'Relative path should not end with "\\".'
                : focusArea.primary && !trimmedRelativePath
                  ? 'The working folder needs a relative path.'
                  : null;

  return (
    <article className="context-pack-modal__editor-card">
      <div className="panel__title-row context-pack-modal__card-header">
        <div>
          <span className="context-pack-modal__card-label">
            Focus area {index + 1}
          </span>
        </div>
        <div className="context-pack-modal__card-header-actions">
          <button
            type="button"
            className="context-pack-modal__icon-btn context-pack-modal__icon-btn--danger"
            disabled={busy}
            onClick={() => onRemoveFocusArea(focusArea.key)}
            aria-label="Remove"
            title="Remove focus area"
          >
            <CloseIcon />
          </button>
        </div>
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
          <span>Category</span>
          <select
            value={focusArea.focusCategory}
            onChange={(event) =>
              onFocusAreaFieldChange(focusArea.key, 'focusCategory', event.target.value)
            }
          >
            {[
              'service',
              'application',
              'frontend',
              'library',
              'infrastructure',
              'data',
              'documentation',
              'tool',
              'unknown',
            ].map((option) => (
              <option key={option} value={option}>
                {toTitleCase(option)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}

export default FocusAreaCard;
