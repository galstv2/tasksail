import { useEffect, useMemo, useState } from 'react';

import type {
  ContextPackCatalogEntry,
  ContextPackListRepoTreeResponse,
  PlannerChildTaskExecutionScope,
} from '../../../shared/desktopContract';
import {
  buildChildScopeStandardRolePack,
  buildChildScopeSidebarModel,
  childScopeFocusHint,
  cloneChildScope,
  selectedWorkingFocusIdsForScope,
  updateChildScopeDeepFocus,
  updateStandardChildScope,
  updateStandardChildScopeRole,
} from '../../planner/plannerChildScope';
import { supportsDeepFocus } from '../deep-focus/SidebarDeepFocusUtils';
import DeepFocusSelector from '../deep-focus/DeepFocusSelector';
import StandardFocusSelector from '../deep-focus/StandardFocusSelector';

export type ChildScopeOverridePanelProps = {
  selectedPack: ContextPackCatalogEntry;
  parentScope: PlannerChildTaskExecutionScope;
  childScope: PlannerChildTaskExecutionScope;
  statusLabel: 'Using parent scope' | 'Child scope adjusted';
  summary: string;
  warning?: string | null;
  error?: string | null;
  saving?: boolean;
  onCancel: () => void;
  onSave: (scope: PlannerChildTaskExecutionScope) => void;
  onListRepoTree: (
    repoLocalPath: string,
    relativePath?: string,
  ) => Promise<ContextPackListRepoTreeResponse | null>;
};

function ChildScopeOverridePanel({
  selectedPack,
  childScope,
  statusLabel,
  summary,
  warning,
  error,
  saving,
  onCancel,
  onSave,
  onListRepoTree,
}: ChildScopeOverridePanelProps): JSX.Element {
  const [draftScope, setDraftScope] = useState(() => cloneChildScope(childScope));
  const [deepFocusEditorOpen, setDeepFocusEditorOpen] = useState(false);

  useEffect(() => {
    setDraftScope(cloneChildScope(childScope));
    setDeepFocusEditorOpen(false);
  }, [childScope]);

  const draftSelectedPack = useMemo<ContextPackCatalogEntry>(() => {
    if (draftScope.deepFocusEnabled) return selectedPack;
    return buildChildScopeStandardRolePack(selectedPack, draftScope);
  }, [draftScope, selectedPack]);

  const sidebarModel = useMemo(
    () => buildChildScopeSidebarModel(draftSelectedPack, draftScope),
    [draftSelectedPack, draftScope],
  );
  const showDeepFocus = supportsDeepFocus(draftSelectedPack.estateType);
  const selectedWorkingFocusIds = selectedWorkingFocusIdsForScope(draftSelectedPack, draftScope);
  const isDeepFocusMode = showDeepFocus && draftScope.deepFocusEnabled;

  return (
    <div className="planner-modal__child-scope-panel" role="dialog" aria-label="Adjust child scope">
      <div className="planner-modal__child-scope-panel-header">
        <div>
          <div className="planner-modal__child-scope-panel-title">Child Execution Scope</div>
          <div className="planner-modal__child-scope-panel-meta">{statusLabel} · {summary}</div>
        </div>
        <button type="button" className="planner-modal__secondary-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {warning ? (
        <div className="planner-modal__child-scope-warning" role="status">{warning}</div>
      ) : null}
      {error ? (
        <div className="planner-modal__child-scope-error" role="alert">{error}</div>
      ) : null}
      <div
        className="planner-modal__child-scope-selector"
        data-scope-mode={isDeepFocusMode ? 'deep-focus' : 'standard'}
      >
        {isDeepFocusMode ? (
          <DeepFocusSelector
            selectedPack={draftSelectedPack}
            selectedWorkingFocusIds={selectedWorkingFocusIds}
            deepFocusEnabled={draftScope.deepFocusEnabled}
            deepFocusPrimaryRepoId={draftScope.deepFocusPrimaryRepoId}
            deepFocusPrimaryFocusId={draftScope.deepFocusPrimaryFocusId}
            selectedFocusPath={draftScope.selectedFocusPath}
            selectedFocusTargetKind={draftScope.selectedFocusTargetKind}
            selectedFocusTargets={draftScope.selectedFocusTargets}
            selectedTestTarget={draftScope.selectedTestTarget}
            selectedSupportTargets={draftScope.selectedSupportTargets}
            onCommitDeepFocusSelection={(selection) => {
              setDraftScope((current) => updateChildScopeDeepFocus(draftSelectedPack, current, selection));
            }}
            onListRepoTree={onListRepoTree}
            onDeepFocusEditorToggle={setDeepFocusEditorOpen}
            editorOpen={deepFocusEditorOpen}
            showFocusFilterButton={false}
          />
        ) : (
          <StandardFocusSelector
            selectedPack={draftSelectedPack}
            selectedWorkingFocusIds={selectedWorkingFocusIds}
            deepFocusEnabled={draftScope.deepFocusEnabled}
            deepFocusPrimaryRepoId={draftScope.deepFocusPrimaryRepoId}
            deepFocusPrimaryFocusId={draftScope.deepFocusPrimaryFocusId}
            selectedFocusPath={draftScope.selectedFocusPath}
            selectedFocusTargetKind={draftScope.selectedFocusTargetKind}
            selectedFocusTargets={draftScope.selectedFocusTargets}
            selectedTestTarget={draftScope.selectedTestTarget}
            selectedSupportTargets={draftScope.selectedSupportTargets}
            focusHint={childScopeFocusHint(selectedPack)}
            sidebarModel={sidebarModel}
            supportsDeepFocus={showDeepFocus}
            onSelectWorkingFocus={(focusId) => {
              setDraftScope((current) => updateStandardChildScope(draftSelectedPack, current, focusId));
            }}
            onToggleRepositoryType={(focusId, currentType) => {
              const nextType = currentType === 'primary' ? 'support' : 'primary';
              setDraftScope((current) => updateStandardChildScopeRole(draftSelectedPack, current, focusId, nextType));
            }}
            onCommitDeepFocusSelection={(selection) => {
              setDraftScope((current) => updateChildScopeDeepFocus(draftSelectedPack, current, selection));
            }}
            showFocusFilterButton={false}
          />
        )}
      </div>
      <div className="planner-modal__child-scope-actions">
        <button type="button" className="planner-modal__secondary-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="action-button action-button--primary"
          onClick={() => onSave(cloneChildScope(draftScope))}
          disabled={saving}
        >
          Save child scope
        </button>
      </div>
    </div>
  );
}

export default ChildScopeOverridePanel;
