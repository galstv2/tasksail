import type { ContextPackDiscoveryMode } from '../../../shared/desktopContract';
import type { ContextPackCreationModalProps } from '../../contextPackCreationTypes';
import { isDistributedEstateMode } from '../../contextPackModeUtils';
import { classNames } from '../../utils/classNames';
import BuildWizard from './BuildWizard';

type SetupStepProps = Pick<
  ContextPackCreationModalProps,
  | 'busy'
  | 'draft'
  | 'discoveryStatus'
  | 'discoverySummary'
  | 'onBrowseDiscoveryRoot'
  | 'onChangeMode'
  | 'onDraftFieldChange'
  | 'onDiscoverPrefill'
  | 'wizardStep'
  | 'wizardParts'
  | 'onWizardStepChange'
  | 'onWizardAddPart'
  | 'onWizardUpdatePart'
  | 'onWizardRemovePart'
>;

function SetupStep({
  busy,
  draft,
  discoveryStatus,
  discoverySummary,
  onBrowseDiscoveryRoot,
  onChangeMode,
  onDraftFieldChange,
  onDiscoverPrefill,
  wizardStep,
  wizardParts,
  onWizardStepChange,
  onWizardAddPart,
  onWizardUpdatePart,
  onWizardRemovePart,
}: SetupStepProps): JSX.Element {
  const hasDiscoveryResult = discoveryStatus === 'ready' && discoverySummary;
  const canRenderWizard =
    draft.creationOrigin === 'new'
    && wizardStep !== undefined
    && wizardParts !== undefined
    && onWizardStepChange !== undefined
    && onWizardAddPart !== undefined
    && onWizardUpdatePart !== undefined
    && onWizardRemovePart !== undefined;

  return (
    <div className="context-pack-modal__body">
      <div className="composer-field">
        <span>Project source</span>
        <div
          className="context-pack-modal__seg-control context-pack-modal__seg-control--full"
          role="radiogroup"
          aria-label="Project source"
        >
          <button
            type="button"
            role="radio"
            aria-checked={draft.creationOrigin === 'existing'}
            className={classNames(
              'context-pack-modal__seg-option',
              draft.creationOrigin === 'existing' && 'context-pack-modal__seg-option--active',
            )}
            onClick={() => onDraftFieldChange('creationOrigin', 'existing')}
          >
            Existing project
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={draft.creationOrigin === 'new'}
            className={classNames(
              'context-pack-modal__seg-option',
              draft.creationOrigin === 'new' && 'context-pack-modal__seg-option--active',
            )}
            onClick={() => onDraftFieldChange('creationOrigin', 'new')}
          >
            New project
          </button>
        </div>
      </div>

      {canRenderWizard ? (
        <BuildWizard
          busy={busy}
          wizardStep={wizardStep}
          draft={draft}
          parts={wizardParts}
          onStepChange={onWizardStepChange}
          onDraftFieldChange={onDraftFieldChange}
          onChangeMode={onChangeMode}
          onBrowseDiscoveryRoot={onBrowseDiscoveryRoot}
          onAddPart={onWizardAddPart}
          onUpdatePart={onWizardUpdatePart}
          onRemovePart={onWizardRemovePart}
        />
      ) : (
        <>
          <div className="context-pack-modal__tier-primary">
            <div className="context-pack-modal__discovery-group">
              <label className="composer-field">
                <span>Discovery root</span>
                <div className="context-pack-modal__path-row">
                  <input
                    value={draft.discoveryRoot}
                    onChange={(event) =>
                      onDraftFieldChange('discoveryRoot', event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="action-button action-button--secondary"
                    disabled={busy}
                    onClick={() => void onBrowseDiscoveryRoot()}
                  >
                    Browse
                  </button>
                  <button
                    type="button"
                    className="action-button action-button--secondary"
                    disabled={busy || discoveryStatus === 'loading'}
                    onClick={() => void onDiscoverPrefill()}
                  >
                    {discoveryStatus === 'loading'
                      ? 'Scanning\u2026'
                      : hasDiscoveryResult
                        ? 'Re-scan'
                        : isDistributedEstateMode(draft.mode)
                          ? 'Scan for repositories'
                          : 'Scan for focus areas'}
                  </button>
                </div>
              </label>
              {hasDiscoveryResult ? (
                <span
                  className="context-pack-modal__discovery-result"
                  data-testid="context-pack-discovery-summary"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M5 8.2l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {discoverySummary}
                </span>
              ) : discoverySummary ? (
                <span
                  className="context-pack-modal__field-meta"
                  data-testid="context-pack-discovery-summary"
                >
                  {discoverySummary}
                </span>
              ) : (
                <span className="context-pack-modal__field-meta">
                  {isDistributedEstateMode(draft.mode)
                    ? 'Scan to discover candidate repositories.'
                    : 'Scan to discover candidate focus areas.'}
                </span>
              )}
            </div>
            <label className="composer-field">
              <span>Display name</span>
              <input
                value={draft.estateName}
                onChange={(event) =>
                  onDraftFieldChange('estateName', event.target.value)
                }
              />
            </label>
            <label className="composer-field">
              <span>Mode</span>
              <select
                aria-label="Creation mode"
                value={draft.mode}
                onChange={(event) =>
                  onChangeMode(
                    event.target.value as Exclude<ContextPackDiscoveryMode, 'auto'>,
                  )
                }
              >
                <option value="distributed">Distributed</option>
                <option value="distributed-platform">Distributed + infrastructure</option>
                <option value="monolith">Monolith</option>
                <option value="monolith-platform">Monolith + infrastructure</option>
              </select>
            </label>
          </div>

          <div className="context-pack-modal__destination-meta">
            <span className="context-pack-modal__destination-label">Saved to</span>
            <span
              className={`context-pack-modal__destination-path${
                !draft.contextPackDir.trim() ? ' context-pack-modal__destination-path--empty' : ''
              }`}
            >
              {draft.contextPackDir.trim() || 'Set a discovery root and display name to generate'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default SetupStep;
