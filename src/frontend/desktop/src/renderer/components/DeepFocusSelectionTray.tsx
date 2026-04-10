import type { ContextPackDeepFocusTarget } from '../../shared/desktopContract';
import { classNames } from '../utils/classNames';
import { basename, getPrimaryDisplayLabel, getPrimaryDisplayPath, normalizeRelativePath } from './SidebarDeepFocusUtils';

function ChevronIcon({ direction }: { direction: 'down' | 'up' }): JSX.Element {
  const rotation = direction === 'down' ? 90 : -90;
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type SelectionTrayTopLevel = {
  label: string;
  rootPath: string;
};

type SelectionTrayDraftState = {
  selectedFocusPath: string | null;
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
};

type DeepFocusSelectionTrayProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  summaryLine: string;
  draftTopLevel: SelectionTrayTopLevel | null;
  draftState: SelectionTrayDraftState;
  draftHasColocatedPrimaryAndTest: boolean;
  draftHasExplicitNoTests: boolean;
  onDismissNoTests: () => void;
};

export function DeepFocusSelectionTray({
  collapsed,
  onToggleCollapsed,
  summaryLine,
  draftTopLevel,
  draftState,
  draftHasColocatedPrimaryAndTest,
  draftHasExplicitNoTests,
  onDismissNoTests,
}: DeepFocusSelectionTrayProps): JSX.Element {
  return (
    <div
      className={classNames(
        'deep-focus-selection-tray',
        collapsed && 'deep-focus-selection-tray--collapsed',
      )}
    >
      <button
        type="button"
        className="deep-focus-selection-tray__toggle"
        aria-label="Toggle selection tray"
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        <span className="deep-focus-selection-tray__summary-line" data-testid="deep-focus-selection-tray-summary">
          {summaryLine}
        </span>
        <span className="deep-focus-selection-tray__toggle-icon" aria-hidden="true">
          <ChevronIcon direction={collapsed ? 'down' : 'up'} />
        </span>
      </button>

      {!collapsed ? (
        <>
          <div className="deep-focus-selection-tray__section">
            <span className="deep-focus-selection-tray__label">
              {draftHasColocatedPrimaryAndTest ? 'Primary + Test' : 'Primary'}
            </span>
            {draftTopLevel ? (
              <div
                className={classNames(
                  'deep-focus-selection-tray__value',
                  draftHasColocatedPrimaryAndTest
                    && 'deep-focus-selection-tray__value--colocated',
                )}
              >
                <span>{getPrimaryDisplayLabel(draftTopLevel, normalizeRelativePath(draftState.selectedFocusPath))}</span>
                <span className="deep-focus-selection-tray__path">
                  {getPrimaryDisplayPath(draftTopLevel, normalizeRelativePath(draftState.selectedFocusPath))}
                </span>
              </div>
            ) : (
              <div className="deep-focus-selection-tray__empty">None selected</div>
            )}
          </div>

          {!draftHasColocatedPrimaryAndTest ? (
            <div className="deep-focus-selection-tray__section">
              <span className="deep-focus-selection-tray__label">Test</span>
              {draftState.selectedTestTarget ? (
                <div className="deep-focus-selection-tray__value deep-focus-selection-tray__value--test">
                  <span>{basename(draftState.selectedTestTarget.path)}</span>
                  <span className="deep-focus-selection-tray__path">
                    {draftState.selectedTestTarget.path}
                  </span>
                </div>
              ) : draftHasExplicitNoTests ? (
                <div className="deep-focus-selection-tray__value deep-focus-selection-tray__value--dismissed">
                  <span>No tests</span>
                  <span className="deep-focus-selection-tray__path">
                    Explicitly continue without a dedicated test target
                  </span>
                </div>
              ) : draftTopLevel ? (
                <div className="deep-focus-selection-tray__test-nudge">
                  <span>No test target selected — select a test directory or dismiss</span>
                  <button type="button" onClick={onDismissNoTests}>
                    Dismiss — no tests
                  </button>
                </div>
              ) : (
                <div className="deep-focus-selection-tray__empty">None</div>
              )}
            </div>
          ) : null}

          <div className="deep-focus-selection-tray__section">
            <span className="deep-focus-selection-tray__label">
              Support
              <span className="status-chip status-chip--xs">
                {draftState.selectedSupportTargets.length}
              </span>
            </span>
            {draftState.selectedSupportTargets.length > 0 ? (
              <div className="deep-focus-selection-tray__support-list">
                {draftState.selectedSupportTargets.slice(0, 2).map((target) => (
                  <div key={`${target.kind}:${target.path}`} className="deep-focus-selection-tray__support-item">
                    {basename(target.path)}
                  </div>
                ))}
                {draftState.selectedSupportTargets.length > 2 ? (
                  <span className="deep-focus-selection-tray__overflow">
                    +{draftState.selectedSupportTargets.length - 2} more
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="deep-focus-selection-tray__empty">None</div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
