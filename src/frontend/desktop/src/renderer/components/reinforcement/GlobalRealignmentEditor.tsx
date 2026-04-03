import type { DocumentDraft, SaveState, UseRealignmentDocumentResult } from '../../hooks/useRealignmentDocument';

type GlobalRealignmentEditorProps = {
  hasActiveContextPack: boolean;
  draft: DocumentDraft;
  version: number;
  updatedAt: string;
  loading: boolean;
  loadError: string | null;
  saveState: SaveState;
  dirty: boolean;
  onFieldChange: UseRealignmentDocumentResult['onFieldChange'];
  onSave: () => void;
  onDiscard: () => void;
  onReload: () => void;
};

type FieldSpec = {
  key: keyof DocumentDraft;
  label: string;
  placeholder: string;
};

const FIELDS: FieldSpec[] = [
  {
    key: 'standingExpectations',
    label: 'Standing Expectations',
    placeholder: 'One expectation per line...',
  },
  {
    key: 'behavioralGuidance',
    label: 'Behavioral Guidance',
    placeholder: 'One guidance item per line...',
  },
  {
    key: 'lessonsLearned',
    label: 'Lessons Learned',
    placeholder: 'One lesson per line...',
  },
  {
    key: 'fairnessFraming',
    label: 'Fairness Framing',
    placeholder: 'One framing item per line...',
  },
];

function GlobalRealignmentEditor({
  hasActiveContextPack,
  draft,
  version,
  updatedAt,
  loading,
  loadError,
  saveState,
  dirty,
  onFieldChange,
  onSave,
  onDiscard,
  onReload,
}: GlobalRealignmentEditorProps): JSX.Element {
  const canSave = dirty && saveState.status !== 'saving';

  if (!hasActiveContextPack) {
    return (
      <div className="document-editor" data-testid="document-editor">
        <p className="document-editor__empty">
          Activate a context pack to view and edit the Global Realignment Document.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="document-editor" data-testid="document-editor">
        <p className="document-editor__error" data-testid="document-editor-error">
          {loadError}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="document-editor" data-testid="document-editor">
        <p className="document-editor__loading">Loading document...</p>
      </div>
    );
  }

  return (
    <div className="document-editor" data-testid="document-editor">
      <div className="document-editor__meta">
        <span className="document-editor__version">Version {version}</span>
        {updatedAt && (
          <span className="document-editor__updated">
            Updated {updatedAt.slice(0, 10)}
          </span>
        )}
      </div>

      <p className="document-editor__source-label">
        Global realignment document — shared across all context packs.
        One item per line.
      </p>

      {FIELDS.map((field) => (
        <div key={field.key} className="document-editor__field">
          <label
            className="document-editor__label"
            htmlFor={`doc-field-${field.key}`}
          >
            {field.label}
          </label>
          <textarea
            id={`doc-field-${field.key}`}
            className="document-editor__textarea"
            value={draft[field.key]}
            placeholder={field.placeholder}
            rows={4}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
            data-testid={`doc-field-${field.key}`}
          />
        </div>
      ))}

      <div className="document-editor__actions">
        <button
          type="button"
          className="document-editor__save"
          disabled={!canSave}
          onClick={onSave}
          data-testid="doc-save"
        >
          {saveState.status === 'saving' ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          className="document-editor__discard"
          disabled={!dirty || saveState.status === 'saving'}
          onClick={onDiscard}
          data-testid="doc-discard"
        >
          Discard
        </button>
      </div>

      {saveState.status === 'saved' && (
        <p className="document-editor__status document-editor__status--success" data-testid="doc-status">
          {saveState.message}
        </p>
      )}
      {saveState.status === 'error' && (
        <p className="document-editor__status document-editor__status--error" data-testid="doc-status">
          {saveState.message}
        </p>
      )}
      {saveState.status === 'conflict' && (
        <div className="document-editor__conflict" data-testid="doc-conflict">
          <p className="document-editor__status document-editor__status--error">
            {saveState.message}
          </p>
          <button
            type="button"
            className="document-editor__reload"
            onClick={onReload}
            data-testid="doc-reload"
          >
            Reload
          </button>
        </div>
      )}
    </div>
  );
}

export default GlobalRealignmentEditor;
