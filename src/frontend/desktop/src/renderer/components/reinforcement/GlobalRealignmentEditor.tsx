import type { DocumentDraft } from '../../hooks/reinforcement/useRealignmentDocument';

type GlobalRealignmentEditorProps = {
  hasActiveContextPack: boolean;
  draft: DocumentDraft;
  updatedAt: string;
  loading: boolean;
  loadError: string | null;
};

type FieldSpec = {
  key: keyof DocumentDraft;
  label: string;
};

const FIELDS: FieldSpec[] = [
  { key: 'standingExpectations', label: 'Standing expectations' },
  { key: 'behavioralGuidance', label: 'Behavioral guidance' },
  { key: 'lessonsLearned', label: 'Lessons learned' },
  { key: 'fairnessFraming', label: 'Fairness framing' },
];

function GlobalRealignmentEditor({
  hasActiveContextPack,
  draft,
  updatedAt,
  loading,
  loadError,
}: GlobalRealignmentEditorProps): JSX.Element {
  if (!hasActiveContextPack) {
    return (
      <div className="document-editor" data-testid="document-editor">
        <p className="document-editor__empty">
          Activate a context pack to view the realignment document.
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

  const visibleFields = FIELDS
    .map((field) => ({ ...field, value: draft[field.key].trim() }))
    .filter((field) => field.value);

  return (
    <div className="document-editor" data-testid="document-editor">
      <p className="document-editor__source-label">
        This document captures what agents have learned from your feedback.
        It updates automatically after each realignment session.
        {updatedAt ? ` Last updated ${updatedAt.slice(0, 10)}.` : ''}
      </p>

      {visibleFields.length > 0 ? (
        visibleFields.map((field) => (
          <div key={field.key} className="document-editor__field">
            <span className="document-editor__label">{field.label}</span>
            <div
              className="document-editor__readonly"
              data-testid={`doc-field-${field.key}`}
            >
              {field.value}
            </div>
          </div>
        ))
      ) : (
        <p className="document-editor__empty-field" data-testid="document-editor-empty-fields">
          No realignment document entries yet.
        </p>
      )}
    </div>
  );
}

export default GlobalRealignmentEditor;
