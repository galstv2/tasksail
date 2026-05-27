import type { ContextPackDiscoveryMode } from '../../../shared/desktopContract';
import type {
  BuildWizardStep,
  ContextPackCreationDraft,
  PartDraft,
} from '../../contextPackCreationTypes';
import { classNames } from '../../utils/classNames';
import WizardBuildParts from './WizardBuildParts';
import WizardLocation from './WizardLocation';
import WizardProjectName from './WizardProjectName';
import WizardProjectType from './WizardProjectType';
import { WIZARD_STEPS } from './buildWizardConstants';

type BuildWizardProps = {
  wizardStep: BuildWizardStep;
  draft: ContextPackCreationDraft;
  parts: PartDraft[];
  busy: boolean;
  onStepChange: (step: BuildWizardStep) => void;
  onDraftFieldChange: <K extends keyof ContextPackCreationDraft>(
    field: K,
    value: ContextPackCreationDraft[K],
  ) => void;
  onChangeMode: (mode: Exclude<ContextPackDiscoveryMode, 'auto'>) => void;
  onBrowseDiscoveryRoot: () => Promise<void> | void;
  onAddPart: () => void;
  onUpdatePart: (key: string, field: keyof PartDraft, value: string | boolean) => void;
  onRemovePart: (key: string) => void;
};

function BuildWizard({
  wizardStep,
  draft,
  parts,
  busy,
  onStepChange,
  onDraftFieldChange,
  onChangeMode,
  onBrowseDiscoveryRoot,
  onAddPart,
  onUpdatePart,
  onRemovePart,
}: BuildWizardProps): JSX.Element {
  const currentIndex = WIZARD_STEPS.findIndex((step) => step.key === wizardStep);

  return (
    <div className="context-pack-modal__wizard">
      <nav className="context-pack-modal__wizard-progress" aria-label="Build wizard progress">
        {WIZARD_STEPS.map((step, index) => {
          const state =
            index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending';

          return (
            <span
              key={step.key}
              className={classNames(
                'context-pack-modal__step',
                'context-pack-modal__wizard-progress-step',
                state === 'active' && 'context-pack-modal__step--active',
                state === 'done' && 'context-pack-modal__step--done',
              )}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              {step.label}
            </span>
          );
        })}
      </nav>

      <div className="context-pack-modal__wizard-content">
        {wizardStep === 'project-type' ? (
          <WizardProjectType
            mode={draft.mode}
            onModeChange={onChangeMode}
          />
        ) : null}

        {wizardStep === 'location' ? (
          <WizardLocation
            busy={busy}
            discoveryRoot={draft.discoveryRoot}
            onDiscoveryRootChange={(value) => onDraftFieldChange('discoveryRoot', value)}
            onBrowseDiscoveryRoot={onBrowseDiscoveryRoot}
            onContinue={() => onStepChange('project-name')}
          />
        ) : null}

        {wizardStep === 'project-name' ? (
          <WizardProjectName
            estateName={draft.estateName}
            contextPackId={draft.contextPackId}
            contextPackDir={draft.contextPackDir}
            onEstateNameChange={(value) => onDraftFieldChange('estateName', value)}
          />
        ) : null}

        {wizardStep === 'build-parts' ? (
          <WizardBuildParts
            busy={busy}
            draft={draft}
            parts={parts}
            onAddPart={onAddPart}
            onUpdatePart={onUpdatePart}
            onRemovePart={onRemovePart}
          />
        ) : null}
      </div>
    </div>
  );
}

export default BuildWizard;
