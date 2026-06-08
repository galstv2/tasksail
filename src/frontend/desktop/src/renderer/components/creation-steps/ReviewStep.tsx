import type { ContextPackCreationModalProps } from '../../contextPack/contextPackCreationTypes';
import { contextPackModeLabel, isMonolithEstateMode } from '../../contextPack/contextPackModeUtils';
import { classNames } from '../../utils/classNames';
import { toTitleCase } from '../../utils/toTitleCase';

type ReviewStepProps = Pick<ContextPackCreationModalProps, 'draft'>;

type ValidationState = 'pass' | 'warn' | 'fail';

function validationItem(
  label: string,
  state: ValidationState,
): { label: string; state: ValidationState } {
  return { label, state };
}

function ValidationIcon({ state }: { state: ValidationState }): JSX.Element {
  if (state === 'pass') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === 'warn') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function isMonolithMode(mode: ReviewStepProps['draft']['mode']): boolean {
  return isMonolithEstateMode(mode);
}

function ReviewStep({ draft }: ReviewStepProps): JSX.Element {
  const checks = [
    validationItem(
      'Context-pack destination',
      draft.contextPackDir.trim() ? 'pass' : 'fail',
    ),
    validationItem(
      'Discovery root',
      draft.discoveryRoot.trim() ? 'pass' : 'fail',
    ),
    validationItem(
      'Display name',
      draft.estateName.trim() ? 'pass' : 'fail',
    ),
    validationItem(
      'At least one repository',
      draft.repositories.length > 0 ? 'pass' : 'fail',
    ),
    validationItem(
      'All repo roots set',
      draft.repositories.every((r) => r.repoRoot.trim()) ? 'pass' : 'fail',
    ),
    validationItem(
      'All repo names set',
      draft.repositories.every((r) => r.repoName.trim()) ? 'pass' : 'warn',
    ),
    ...(isMonolithMode(draft.mode)
      ? [
          validationItem(
            'At least one focus area',
            draft.focusAreas.length > 0 ? 'pass' : 'fail',
          ),
          validationItem(
            'Focus areas have relative paths',
            draft.focusAreas.every((f) => f.relativePath.trim()) ? 'pass' : 'fail',
          ),
        ]
      : []),
  ];

  return (
    <div className="context-pack-modal__body">
      <div className="context-pack-modal__review-grid">
        <section className="context-pack-modal__editor-card">
          <p className="context-pack-modal__section-label">Pack summary</p>
          <div className="context-pack-modal__summary-list">
            <div className="context-pack-modal__summary-row context-pack-modal__summary-row--stacked">
              <span className="context-pack-modal__summary-label">Destination</span>
              <span
                className={classNames(
                  'context-pack-modal__summary-value',
                  'context-pack-modal__summary-value--mono',
                  !draft.contextPackDir && 'context-pack-modal__summary-value--empty',
                )}
              >
                {draft.contextPackDir || 'Not set'}
              </span>
            </div>
            <div className="context-pack-modal__summary-row">
              <span className="context-pack-modal__summary-label">Mode</span>
              <span className="context-pack-modal__summary-value">
                {contextPackModeLabel(draft.mode)}
              </span>
            </div>
            <div className="context-pack-modal__summary-row">
              <span className="context-pack-modal__summary-label">Display name</span>
              <span
                className={classNames(
                  'context-pack-modal__summary-value',
                  !draft.estateName && 'context-pack-modal__summary-value--empty',
                )}
              >
                {draft.estateName || 'Not set'}
              </span>
            </div>
          </div>

          <div className="context-pack-modal__repo-chips">
            {draft.repositories.map((repo) => (
              <span key={repo.key} className="context-pack-modal__repo-chip">
                {repo.repoName || repo.repoId || 'Unnamed'}
                {repo.repoCategory && (
                  <span className="context-pack-modal__repo-chip__layer">
                    {toTitleCase(repo.repoCategory)}
                  </span>
                )}
              </span>
            ))}
          </div>
          {isMonolithMode(draft.mode) && draft.focusAreas.length > 0 ? (
            <>
              <p className="context-pack-modal__section-label">Focus areas</p>
              <div className="context-pack-modal__repo-chips">
                {draft.focusAreas.map((focusArea) => (
                  <span key={focusArea.key} className="context-pack-modal__repo-chip">
                    {focusArea.focusName || focusArea.focusId || 'Unnamed focus area'}
                    {(focusArea.relativePath || focusArea.focusCategory) ? (
                      <span className="context-pack-modal__repo-chip__layer">
                        {[
                          focusArea.relativePath,
                          focusArea.focusCategory ? toTitleCase(focusArea.focusCategory) : null,
                        ].filter(Boolean).join(' \u2022 ')}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section className="context-pack-modal__editor-card">
          <p className="context-pack-modal__section-label">Readiness</p>
          <div className="context-pack-modal__validation-list">
            {checks.map((check) => (
              <div
                key={check.label}
                className={classNames(
                  'context-pack-modal__validation-item',
                  `context-pack-modal__validation-item--${check.state}`,
                )}
              >
                <ValidationIcon state={check.state} />
                {check.label}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default ReviewStep;
