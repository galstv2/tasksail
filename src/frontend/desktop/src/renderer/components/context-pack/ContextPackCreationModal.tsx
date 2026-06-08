import type {
  BuildWizardStep,
  ContextPackCreationModalProps,
  ContextPackCreationModalStep,
  PartDraft,
} from '../../contextPack/contextPackCreationTypes';
import ModalShell, { ModalShellEscHint } from '../shared/ModalShell';
import SetupStep from '../creation-steps/SetupStep';
import ShapeStep from '../creation-steps/ShapeStep';
import ReviewStep from '../creation-steps/ReviewStep';
import {
  WIZARD_STEPS,
  isWizardPartConfigured,
} from '../creation-steps/buildWizardConstants';

const STEPS: { key: ContextPackCreationModalStep; label: string }[] = [
  { key: 'setup', label: 'Setup' },
  { key: 'shape', label: 'Shape' },
  { key: 'review', label: 'Review' },
];

function getPreviousWizardStep(step: BuildWizardStep): BuildWizardStep | null {
  const index = WIZARD_STEPS.findIndex((candidate) => candidate.key === step);
  return index > 0 ? WIZARD_STEPS[index - 1]?.key ?? null : null;
}

function getNextWizardStep(step: BuildWizardStep): BuildWizardStep | null {
  const index = WIZARD_STEPS.findIndex((candidate) => candidate.key === step);
  return index >= 0 && index < WIZARD_STEPS.length - 1
    ? WIZARD_STEPS[index + 1]?.key ?? null
    : null;
}

function canContinueWizardStep(
  step: BuildWizardStep,
  discoveryRoot: string,
  estateName: string,
  wizardParts: PartDraft[],
): boolean {
  switch (step) {
    case 'project-type':
      return true;
    case 'location':
      return Boolean(discoveryRoot.trim());
    case 'project-name':
      return Boolean(estateName.trim());
    case 'build-parts':
      return wizardParts.some((part) => isWizardPartConfigured(part));
    default:
      return false;
  }
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
  canGoNextReason,
  gitRepositoryWarnings = [],
  onClose,
  onDiscardDraft,
  onBrowseDiscoveryRoot,
  onChangeMode,
  onDraftFieldChange,
  onDiscoverPrefill,
  onAddRepository,
  onRemoveRepository,
  onRepositoryFieldChange,
  onAddFocusArea,
  onRemoveFocusArea,
  onFocusAreaFieldChange,
  wizardStep,
  wizardParts,
  onWizardStepChange,
  onWizardAddPart,
  onWizardUpdatePart,
  onWizardRemovePart,
  onBack,
  onNext,
  onCreate,
}: ContextPackCreationModalProps): JSX.Element | null {
  const isWizardSetup = step === 'setup' && draft.creationOrigin === 'new' && wizardStep !== undefined;

  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === step));
  const currentStepLabel = STEPS[stepIndex]?.label ?? '';
  const wizardSubIndex = isWizardSetup
    ? Math.max(0, WIZARD_STEPS.findIndex((w) => w.key === wizardStep))
    : -1;
  const wizardSubLabel = isWizardSetup ? WIZARD_STEPS[wizardSubIndex]?.label ?? '' : '';
  const progressPercent = isWizardSetup
    ? ((stepIndex + (wizardSubIndex + 1) / WIZARD_STEPS.length) / STEPS.length) * 100
    : ((stepIndex + 1) / STEPS.length) * 100;
  const subtitle = isWizardSetup && wizardSubLabel
    ? `Step ${stepIndex + 1} of ${STEPS.length} · ${currentStepLabel} · ${wizardSubLabel}`
    : `Step ${stepIndex + 1} of ${STEPS.length} · ${currentStepLabel}`;
  const resolvedWizardParts = wizardParts ?? [];
  const previousWizardStep = isWizardSetup ? getPreviousWizardStep(wizardStep) : null;
  const nextWizardStep = isWizardSetup ? getNextWizardStep(wizardStep) : null;
  const wizardCanContinue = isWizardSetup
    ? canContinueWizardStep(
      wizardStep,
      draft.discoveryRoot,
      draft.estateName,
      resolvedWizardParts,
    )
    : false;
  const showBackButton = isWizardSetup ? previousWizardStep !== null : canGoBack;
  const showCreateButton = !isWizardSetup && step === 'review';
  const nextButtonLabel = isWizardSetup
    ? wizardStep === 'build-parts'
      ? 'Continue to details →'
      : 'Continue'
    : 'Next';
  const nextButtonTitle = isWizardSetup && wizardStep === 'build-parts' && !wizardCanContinue
    ? 'Add at least one part with a role and language'
    : !isWizardSetup && !canGoNext && canGoNextReason
      ? canGoNextReason
      : undefined;

  const footer = (
    <>
      <button
        type="button"
        className="context-pack-modal__text-btn context-pack-modal__text-btn--danger"
        disabled={busy}
        onClick={onDiscardDraft}
      >
        Discard draft
      </button>
      <ModalShellEscHint />
      {showBackButton ? (
        <button
          type="button"
          className="action-button action-button--secondary"
          disabled={busy}
          onClick={() => {
            if (isWizardSetup && previousWizardStep && onWizardStepChange) {
              onWizardStepChange(previousWizardStep);
              return;
            }
            onBack();
          }}
        >
          Back
        </button>
      ) : null}
      {!showCreateButton ? (
        <button
          type="button"
          className="action-button action-button--primary"
          disabled={busy || !canGoNext || (isWizardSetup && !wizardCanContinue)}
          aria-disabled={busy || !canGoNext || (isWizardSetup && !wizardCanContinue) ? 'true' : undefined}
          title={nextButtonTitle}
          onClick={() => {
            if (isWizardSetup && wizardStep !== 'build-parts' && nextWizardStep && onWizardStepChange) {
              onWizardStepChange(nextWizardStep);
              return;
            }
            onNext();
          }}
        >
          {nextButtonLabel}
        </button>
      ) : (
        <button
          type="button"
          className="action-button action-button--primary"
          disabled={busy}
          onClick={() => void onCreate()}
        >
          {busy ? 'Creating\u2026' : 'Create Context Pack'}
        </button>
      )}
    </>
  );

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      closeDisabled={busy}
      title="Create Context Pack"
      subtitle={subtitle}
      ariaLabel="Create Context Pack"
      maxWidth="680px"
      className="context-pack-modal"
      footer={footer}
    >
      <div
        className="creation-progress"
        role="progressbar"
        aria-label="Creation progress"
        aria-valuenow={stepIndex + 1}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
      >
        <div className="creation-progress__fill" style={{ width: `${progressPercent}%` }} />
      </div>

      {message ? <p className="panel__lede">{message}</p> : null}
      {error ? <p className="panel__error">{error}</p> : null}
      {!isWizardSetup && !canGoNext && canGoNextReason ? (
        <p className="panel__error">{canGoNextReason}</p>
      ) : null}

      {gitRepositoryWarnings.length > 0 ? (
        <div className="context-pack-modal__info-callout" role="status" aria-live="polite">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.1" />
            <path d="M8 7.25v3.5M8 5.25v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <div>
            <p className="context-pack-modal__info-callout-title">Some folders were skipped</p>
            <ul className="context-pack-modal__info-callout-list">
              {gitRepositoryWarnings.map((warning) => (
                <li key={warning.path}>{warning.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

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
          wizardStep={wizardStep}
          wizardParts={wizardParts}
          onWizardStepChange={onWizardStepChange}
          onWizardAddPart={onWizardAddPart}
          onWizardUpdatePart={onWizardUpdatePart}
          onWizardRemovePart={onWizardRemovePart}
        />
      ) : null}

      {step === 'shape' ? (
        <ShapeStep
          busy={busy}
          draft={draft}
          onAddRepository={onAddRepository}
          onRemoveRepository={onRemoveRepository}
          onRepositoryFieldChange={onRepositoryFieldChange}
          onAddFocusArea={onAddFocusArea}
          onRemoveFocusArea={onRemoveFocusArea}
          onFocusAreaFieldChange={onFocusAreaFieldChange}
        />
      ) : null}

      {step === 'review' ? <ReviewStep draft={draft} /> : null}
    </ModalShell>
  );
}

export default ContextPackCreationModal;
