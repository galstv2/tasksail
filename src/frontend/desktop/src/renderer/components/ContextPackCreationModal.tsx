import { useCallback, useEffect } from 'react';

import type { ContextPackCreationModalProps, ContextPackCreationModalStep } from '../contextPackCreationTypes';
import { classNames } from '../utils/classNames';
import SetupStep from './creation-steps/SetupStep';
import ShapeStep from './creation-steps/ShapeStep';
import ReviewStep from './creation-steps/ReviewStep';

const STEPS: { key: ContextPackCreationModalStep; label: string }[] = [
  { key: 'setup', label: 'Setup' },
  { key: 'shape', label: 'Shape' },
  { key: 'review', label: 'Review' },
];

function stepState(
  candidate: ContextPackCreationModalStep,
  current: ContextPackCreationModalStep,
): 'done' | 'active' | 'pending' {
  const order: ContextPackCreationModalStep[] = ['setup', 'shape', 'review'];
  const ci = order.indexOf(candidate);
  const ai = order.indexOf(current);
  if (ci < ai) return 'done';
  if (ci === ai) return 'active';
  return 'pending';
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ContextPackCreationModal({
  isOpen,
  busy,
  step,
  draft,
  discoveryStatus,
  discoverySummary,
  error,
  message,
  canGoBack,
  canGoNext,
  onClose,
  onBrowseDiscoveryRoot,
  onChangeMode,
  onDraftFieldChange,
  onDiscoverPrefill,
  onAddRepository,
  onRemoveRepository,
  onRepositoryFieldChange,
  onSetPrimaryRepository,
  onAddFocusArea,
  onRemoveFocusArea,
  onFocusAreaFieldChange,
  onSetPrimaryFocusArea,
  onBack,
  onNext,
  onCreate,
}: ContextPackCreationModalProps): JSX.Element | null {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    },
    [onClose, busy],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) {
    return null;
  }

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !busy) onClose();
  };

  return (
    <div className="context-pack-modal__overlay" role="presentation" onClick={handleOverlayClick}>
      <section
        className="panel context-pack-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create context pack"
      >
        <div className="panel__title-row context-pack-modal__header">
          <div>
            <h2>Create context pack</h2>
            <p className="panel__meta">
              Guided creation for distributed estates and monolith roots.
            </p>
          </div>
          <button
            type="button"
            className="action-button action-button--secondary"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <nav className="context-pack-modal__steps" aria-label="Creation steps">
          {STEPS.map((s, i) => {
            const state = stepState(s.key, step);
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <span className="context-pack-modal__step-sep" />}
                <span
                  className={classNames(
                    'context-pack-modal__step',
                    state === 'active' && 'context-pack-modal__step--active',
                    state === 'done' && 'context-pack-modal__step--done',
                  )}
                >
                  {state === 'done' && <CheckIcon />}
                  {s.label}
                </span>
              </div>
            );
          })}
        </nav>

        {message ? <p className="panel__lede">{message}</p> : null}
        {error ? <p className="panel__error">{error}</p> : null}

        {step === 'setup' ? (
          <SetupStep
            busy={busy}
            draft={draft}
            discoveryStatus={discoveryStatus}
            discoverySummary={discoverySummary}
            onBrowseDiscoveryRoot={onBrowseDiscoveryRoot}
            onChangeMode={onChangeMode}
            onDraftFieldChange={onDraftFieldChange}
            onDiscoverPrefill={onDiscoverPrefill}
          />
        ) : null}

        {step === 'shape' ? (
          <ShapeStep
            busy={busy}
            draft={draft}
            onAddRepository={onAddRepository}
            onRemoveRepository={onRemoveRepository}
            onRepositoryFieldChange={onRepositoryFieldChange}
            onSetPrimaryRepository={onSetPrimaryRepository}
            onAddFocusArea={onAddFocusArea}
            onRemoveFocusArea={onRemoveFocusArea}
            onFocusAreaFieldChange={onFocusAreaFieldChange}
            onSetPrimaryFocusArea={onSetPrimaryFocusArea}
          />
        ) : null}

        {step === 'review' ? <ReviewStep draft={draft} /> : null}

        <div className="action-row context-pack-modal__footer">
          <span className="context-pack-modal__footer-esc">ESC to close</span>
          {canGoBack ? (
            <button
              type="button"
              className="action-button action-button--secondary"
              disabled={busy}
              onClick={onBack}
            >
              Back
            </button>
          ) : null}
          {canGoNext ? (
            <button
              type="button"
              className="action-button action-button--primary"
              disabled={busy}
              onClick={onNext}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="action-button action-button--primary"
              disabled={busy}
              onClick={() => void onCreate()}
            >
              {busy ? 'Creating\u2026' : 'Create context pack'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export default ContextPackCreationModal;
