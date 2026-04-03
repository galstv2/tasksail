import { useMemo } from 'react';

import type { ContextPackCreationModalProps } from '../../contextPackCreationTypes';
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

function ReviewStep({ draft }: ReviewStepProps): JSX.Element {
  const checks = useMemo(() => [
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
      'Primary repository selected',
      draft.repositories.some((r) => r.primary) ? 'pass' : 'warn',
    ),
    validationItem(
      'All repo roots set',
      draft.repositories.every((r) => r.repoRoot.trim()) ? 'pass' : 'fail',
    ),
    validationItem(
      'All repo names set',
      draft.repositories.every((r) => r.repoName.trim()) ? 'pass' : 'warn',
    ),
    ...(draft.mode === 'monolith'
      ? [
          validationItem(
            'At least one focus area',
            draft.focusAreas.length > 0 ? 'pass' : 'fail',
          ),
        ]
      : []),
  ], [draft]);

  return (
    <div className="context-pack-modal__body">
      <div className="context-pack-modal__review-grid">
        <section className="context-pack-modal__editor-card">
          <h3>Pack summary</h3>
          <dl className="mapping-list">
            <div>
              <dt>Destination</dt>
              <dd className="context-pack-modal__destination">
                {draft.contextPackDir || 'Not set'}
              </dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{draft.mode === 'distributed' ? 'Distributed estate' : 'Monolith'}</dd>
            </div>
            <div>
              <dt>Display name</dt>
              <dd>{draft.estateName || 'Not set'}</dd>
            </div>
          </dl>

          <div className="context-pack-modal__repo-chips">
            {draft.repositories.map((repo) => (
              <span
                key={repo.key}
                className={classNames(
                  'context-pack-modal__repo-chip',
                  repo.primary && 'context-pack-modal__repo-chip--primary',
                )}
              >
                {repo.primary && 'Primary \u2022 '}
                {repo.repoName || repo.repoId || 'Unnamed'}
                {repo.systemLayer && (
                  <span className="context-pack-modal__repo-chip__layer">
                    {toTitleCase(repo.systemLayer)}
                  </span>
                )}
              </span>
            ))}
          </div>
          {draft.mode === 'monolith' && draft.focusAreas.length > 0 ? (
            <>
              <h4>Focus areas</h4>
              <div className="context-pack-modal__repo-chips">
                {draft.focusAreas.map((focusArea) => (
                  <span
                    key={focusArea.key}
                    className={classNames(
                      'context-pack-modal__repo-chip',
                      focusArea.repositoryType === 'primary' && 'context-pack-modal__repo-chip--primary',
                    )}
                  >
                    {focusArea.repositoryType === 'primary' ? 'Primary \u2022 ' : 'Support \u2022 '}
                    {focusArea.focusName || focusArea.focusId || 'Unnamed focus area'}
                    {focusArea.focusType ? (
                      <span className="context-pack-modal__repo-chip__layer">
                        {toTitleCase(focusArea.focusType)}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section className="context-pack-modal__editor-card">
          <h3>Readiness</h3>
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
