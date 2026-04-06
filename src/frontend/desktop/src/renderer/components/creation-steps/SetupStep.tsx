import type { ContextPackDiscoveryMode } from '../../../shared/desktopContract';
import type { ContextPackCreationModalProps } from '../../contextPackCreationTypes';
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
      <div className="context-pack-modal__origin-toggle" role="radiogroup" aria-label="Creation origin">
        <label
          className={classNames(
            'stream-toggle',
            draft.creationOrigin === 'existing' && 'context-pack-modal__origin-toggle-option--active',
          )}
        >
          <input
            type="radio"
            name="creation-origin"
            value="existing"
            checked={draft.creationOrigin === 'existing'}
            onChange={() => onDraftFieldChange('creationOrigin', 'existing')}
          />
          Existing project
        </label>
        <label
          className={classNames(
            'stream-toggle',
            draft.creationOrigin === 'new' && 'context-pack-modal__origin-toggle-option--active',
          )}
        >
          <input
            type="radio"
            name="creation-origin"
            value="new"
            checked={draft.creationOrigin === 'new'}
            onChange={() => onDraftFieldChange('creationOrigin', 'new')}
          />
          New project
        </label>
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
              </div>
            </label>
            <label className="composer-field">
              <span>Display name</span>
              <input
                value={draft.estateName}
                onChange={(event) =>
                  onDraftFieldChange('estateName', event.target.value)
                }
              />
            </label>
          </div>

          <div className="context-pack-modal__tier-secondary">
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
                <option value="distributed">Distributed estate</option>
                <option value="monolith">Monolith</option>
              </select>
            </label>
            <label className="composer-field">
              <span>Pack destination</span>
              <div
                className={`context-pack-modal__destination${
                  !draft.contextPackDir.trim() ? ' context-pack-modal__destination--empty' : ''
                }`}
              >
                {draft.contextPackDir.trim() || 'Set a discovery root and display name to generate'}
              </div>
            </label>
          </div>

          <div className="context-pack-modal__discovery-row">
            {hasDiscoveryResult ? (
              <>
                <span className="context-pack-modal__discovery-result">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M5 8.2l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {discoverySummary}
                </span>
                <button
                  type="button"
                  className="action-button action-button--secondary context-pack-modal__rescan-btn"
                  disabled={busy}
                  onClick={() => void onDiscoverPrefill()}
                >
                  Re-scan
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="action-button"
                  disabled={busy}
                  onClick={() => void onDiscoverPrefill()}
                >
                  {discoveryStatus === 'loading'
                    ? 'Scanning\u2026'
                    : draft.mode === 'distributed'
                      ? 'Scan for repositories'
                      : 'Scan for focus areas'}
                </button>
                {discoverySummary && (
                  <span className="panel__meta" data-testid="context-pack-discovery-summary">
                    {discoverySummary}
                  </span>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default SetupStep;
