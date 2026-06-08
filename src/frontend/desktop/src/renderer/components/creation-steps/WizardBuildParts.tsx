import { slugifyValue } from '../../hooks/context-pack/useContextPackDraft';
import type { ContextPackCreationDraft, PartDraft } from '../../contextPack/contextPackCreationTypes';
import { isMonolithEstateMode } from '../../contextPack/contextPackModeUtils';
import { classNames } from '../../utils/classNames';
import LanguageSelector from './LanguageSelector';
import RoleSelector from './RoleSelector';
import {
  getLanguageEntry,
  getRoleOption,
  isWizardPartConfigured,
} from './buildWizardConstants';
import { CloseIcon, CollapseIcon, EditIcon, PlusIcon } from '../icons';

type WizardBuildPartsProps = {
  busy: boolean;
  draft: ContextPackCreationDraft;
  parts: PartDraft[];
  onAddPart: () => void;
  onUpdatePart: (key: string, field: keyof PartDraft, value: string | boolean) => void;
  onRemovePart: (key: string) => void;
};

function parentOf(absolutePath: string): string {
  const trimmed = absolutePath.replace(/\/+$/, '');
  const lastSep = trimmed.lastIndexOf('/');
  if (lastSep < 0) return trimmed;
  if (lastSep === 0) return '/';
  return trimmed.slice(0, lastSep);
}

/**
 * Suggests a path for a new part. Infrastructure parts in monolith mode are
 * separate git repos at a sibling path (created with their own `git init`),
 * not folders inside the monolith. See `initGitReposForNewProject` in
 * `electron/contextPackActions/create.ts` for the matching git-init contract.
 */
function resolveSuggestedLocation(
  draft: ContextPackCreationDraft,
  candidateName: string,
  role: string,
): string {
  const slug = slugifyValue(candidateName);
  if (isMonolithEstateMode(draft.mode)) {
    if (role === 'infrastructure') {
      return `${parentOf(draft.discoveryRoot)}/${slug}`;
    }
    return slug;
  }
  return `${draft.discoveryRoot.replace(/\/+$/, '')}/${slug}`;
}

function isAutoDerivedLocation(
  draft: ContextPackCreationDraft,
  part: PartDraft,
): boolean {
  if (!part.name.trim() || !part.location.trim()) return false;
  for (const role of ['backend', 'frontend', 'database', 'infrastructure', 'documents', 'shared']) {
    if (part.location === resolveSuggestedLocation(draft, part.name, role)) return true;
  }
  return false;
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
              )}
            >
              <div className="context-pack-modal__part-summary">
                <div className="context-pack-modal__part-summary-info">
                  <span className="context-pack-modal__card-label">{partName}</span>
                  <span className="context-pack-modal__part-summary-meta">
                    {roleLabel}
                    {part.role ? ` · ${resolveLanguageLabel(part)}` : ''}
                  </span>
                  {!part.editing ? (
                    <span className="context-pack-modal__part-summary-loc">{locationLabel}</span>
                  ) : null}
                </div>

                <div className="context-pack-modal__wizard-part-actions">
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

              {part.editing ? (
                <div className="context-pack-modal__part-editor">
                  <div className="context-pack-modal__part-field-row">
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
                              resolveSuggestedLocation(draft, value, part.role),
                            );
                          }
                        }}
                      />
                    </label>

                    <label className="composer-field">
                      <span>{isMonolithEstateMode(draft.mode) ? 'Folder' : 'Path'}</span>
                      <input
                        value={part.location}
                        onChange={(event) =>
                          onUpdatePart(part.key, 'location', event.target.value)
                        }
                        placeholder={isMonolithEstateMode(draft.mode) ? 'src/api' : draft.discoveryRoot}
                      />
                    </label>
                  </div>

                  <div className="context-pack-modal__part-picker">
                    <span className="context-pack-modal__part-picker-label">Role</span>
                    <RoleSelector
                      busy={busy}
                      selectedRole={part.role}
                      excludeRoles={draft.mode === 'monolith' ? ['infrastructure'] : undefined}
                      onSelect={(role) => {
                        onUpdatePart(part.key, 'role', role);

                        if (isAutoDerivedLocation(draft, part) && part.name.trim()) {
                          onUpdatePart(
                            part.key,
                            'location',
                            resolveSuggestedLocation(draft, part.name, role),
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
                  {isMonolithEstateMode(draft.mode) && part.role === 'infrastructure' ? (
                    <p className="context-pack-modal__part-picker-note">
                      Infrastructure parts are created as separate git repos beside the monolith.
                    </p>
                  ) : null}

                  {part.role && part.role !== 'documents' ? (
                    <div className="context-pack-modal__part-picker">
                      <span className="context-pack-modal__part-picker-label">Language</span>
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

                  <div className="context-pack-modal__part-editor-footer">
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
        {isMonolithEstateMode(draft.mode) ? 'Add working folder' : 'Add repository'}
      </button>
    </section>
  );
}

export default WizardBuildParts;
