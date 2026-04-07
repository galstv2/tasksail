import { slugifyValue } from '../../hooks/useContextPackDraft';
import type { ContextPackCreationDraft, PartDraft } from '../../contextPackCreationTypes';
import { classNames } from '../../utils/classNames';
import LanguageSelector from './LanguageSelector';
import RoleSelector from './RoleSelector';
import {
  getLanguageEntry,
  getRoleOption,
  isWizardPartConfigured,
} from './buildWizardConstants';
import { CloseIcon, CollapseIcon, EditIcon, PlusIcon } from './icons';

type WizardBuildPartsProps = {
  busy: boolean;
  draft: ContextPackCreationDraft;
  parts: PartDraft[];
  onAddPart: () => void;
  onUpdatePart: (key: string, field: keyof PartDraft, value: string | boolean) => void;
  onRemovePart: (key: string) => void;
};

function resolvePartName(estateName: string, role: PartDraft['role']): string {
  const roleLabel = getRoleOption(role ?? '')?.shortLabel;
  if (!roleLabel) {
    return estateName;
  }
  return `${estateName} ${roleLabel}`.trim();
}

function resolveSuggestedLocation(
  draft: ContextPackCreationDraft,
  part: PartDraft,
  candidateName: string,
): string {
  if (draft.mode === 'monolith') {
    return part.primary ? '.' : slugifyValue(candidateName);
  }
  if (part.primary) {
    return draft.discoveryRoot;
  }
  return `${draft.discoveryRoot.replace(/\/+$/, '')}/${slugifyValue(candidateName)}`;
}

function resolveLanguageLabel(part: PartDraft): string {
  if (part.role === 'documents') {
    return 'Markdown';
  }
  if (part.languageIsOther) {
    return part.language || 'Other';
  }
  return getLanguageEntry(part.language)?.label ?? part.language ?? 'Choose a language';
}

function WizardBuildParts({
  busy,
  draft,
  parts,
  onAddPart,
  onUpdatePart,
  onRemovePart,
}: WizardBuildPartsProps): JSX.Element {
  return (
    <section className="context-pack-modal__wizard-section">
      <p className="context-pack-modal__wizard-heading">
        Build your project
      </p>

      <div className="context-pack-modal__editor-list">
        {parts.map((part, index) => {
          const partName = part.name.trim() || `Part ${index + 1}`;
          const roleLabel = getRoleOption(part.role)?.label ?? 'Choose a role';
          const locationLabel = part.location.trim() || 'Set a location';

          return (
            <article
              key={part.key}
              className={classNames(
                'context-pack-modal__editor-card',
                'context-pack-modal__wizard-part-card',
                part.primary && 'context-pack-modal__editor-card--primary',
              )}
            >
              <div className="panel__title-row context-pack-modal__card-header">
                <div>
                  <span className="context-pack-modal__card-label">{partName}</span>
                  <p className="panel__meta">
                    {roleLabel}
                    {part.role ? ` • ${resolveLanguageLabel(part)}` : ''}
                  </p>
                </div>

                <div className="context-pack-modal__wizard-part-actions">
                  {part.primary ? (
                    <span className="context-pack-modal__repo-chip context-pack-modal__repo-chip--primary">
                      Primary
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="context-pack-modal__icon-btn"
                    disabled={busy}
                    onClick={() => onUpdatePart(part.key, 'editing', !part.editing)}
                    aria-label={part.editing ? 'Collapse' : 'Edit'}
                    title={part.editing ? 'Collapse' : 'Edit'}
                  >
                    {part.editing ? <CollapseIcon /> : <EditIcon />}
                  </button>
                  <button
                    type="button"
                    className="context-pack-modal__icon-btn context-pack-modal__icon-btn--danger"
                    disabled={busy}
                    onClick={() => onRemovePart(part.key)}
                    aria-label="Remove"
                    title="Remove"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>

              <p className="context-pack-modal__wizard-part-location">{locationLabel}</p>

              <div
                className={classNames(
                  'context-pack-modal__wizard-part-editor',
                  part.editing && 'context-pack-modal__wizard-part-editor--open',
                )}
              >
                {part.editing ? (
                  <div className="context-pack-modal__wizard-part-fields">
                    <div className="context-pack-modal__grid">
                      <label className="composer-field">
                        <span>Name</span>
                        <input
                          value={part.name}
                          onChange={(event) => {
                            const value = event.target.value;
                            onUpdatePart(part.key, 'name', value);
                            if (!part.location.trim() && value.trim()) {
                              onUpdatePart(
                                part.key,
                                'location',
                                resolveSuggestedLocation(draft, part, value),
                              );
                            }
                          }}
                        />
                      </label>

                      <label className="composer-field">
                        <span>{draft.mode === 'monolith' ? 'Folder path' : 'Location'}</span>
                        <input
                          value={part.location}
                          onChange={(event) =>
                            onUpdatePart(part.key, 'location', event.target.value)
                          }
                          placeholder={draft.mode === 'monolith' ? 'src/api' : draft.discoveryRoot}
                        />
                        <span className="panel__meta" role="status">
                          {draft.mode === 'monolith'
                            ? 'Folder path within your project (for example: src/api or frontend).'
                            : 'Absolute repository path for this part.'}
                        </span>
                      </label>
                    </div>

                    <button
                      type="button"
                      className={classNames(
                        'context-pack-modal__toggle-pill',
                        part.primary && 'context-pack-modal__toggle-pill--active',
                      )}
                      onClick={() => onUpdatePart(part.key, 'primary', !part.primary)}
                      aria-pressed={part.primary}
                    >
                      <span className="context-pack-modal__toggle-dot" />
                      Primary part
                    </button>

                    <div className="context-pack-modal__wizard-question">
                      <h5>What does this part do?</h5>
                      <RoleSelector
                        busy={busy}
                        selectedRole={part.role}
                        onSelect={(role) => {
                          const previousDerived = resolvePartName(draft.estateName, part.role);
                          const nextName =
                            !part.name.trim()
                            || part.name === draft.estateName
                            || part.name === previousDerived
                              ? resolvePartName(draft.estateName, role)
                              : part.name;

                          onUpdatePart(part.key, 'role', role);

                          if (nextName !== part.name) {
                            onUpdatePart(part.key, 'name', nextName);
                          }

                          if (!part.location.trim()) {
                            onUpdatePart(
                              part.key,
                              'location',
                              resolveSuggestedLocation(draft, part, nextName),
                            );
                          }

                          if (role === 'documents') {
                            onUpdatePart(part.key, 'languageIsOther', false);
                            onUpdatePart(part.key, 'language', 'markdown');
                            onUpdatePart(part.key, 'editing', false);
                            return;
                          }

                          if (part.language === 'markdown') {
                            onUpdatePart(part.key, 'language', '');
                          }
                        }}
                      />
                    </div>

                    {part.role && part.role !== 'documents' ? (
                      <div className="context-pack-modal__wizard-question">
                        <h5>What language will it use?</h5>
                        <LanguageSelector
                          busy={busy}
                          role={part.role}
                          language={part.language}
                          languageIsOther={part.languageIsOther}
                          onSelect={(value, isOther) => {
                            onUpdatePart(part.key, 'languageIsOther', isOther);
                            onUpdatePart(part.key, 'language', value);
                            if (!isOther && value.trim()) {
                              onUpdatePart(part.key, 'editing', false);
                            }
                          }}
                          onOtherLanguageChange={(value) =>
                            onUpdatePart(part.key, 'language', value)
                          }
                        />
                      </div>
                    ) : null}

                    <div className="context-pack-modal__wizard-part-footer">
                      <button
                        type="button"
                        className="context-pack-modal__text-btn context-pack-modal__text-btn--accent"
                        disabled={!isWizardPartConfigured(part)}
                        onClick={() => onUpdatePart(part.key, 'editing', false)}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <button
        type="button"
        className="context-pack-modal__text-btn"
        disabled={busy}
        onClick={onAddPart}
      >
        <PlusIcon />
        Add another part
      </button>
    </section>
  );
}

export default WizardBuildParts;
