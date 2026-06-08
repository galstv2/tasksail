import { useCallback, useMemo, useState } from 'react';

import type {
  ArchivedTaskEntry,
  ContextPackCatalogEntry,
  ContextPackListRepoTreeResponse,
  PlannerChildTaskExecutionScope,
} from '../../../shared/desktopContract';
import type { ChildScopeOverridePanelProps } from '../../components/planner/ChildScopeOverridePanel';
import {
  areChildScopesEqual,
  buildChildScopeSummary,
  buildPlannerPlanningReloadScope,
  childScopeFromFocusSnapshot,
  cloneChildScope,
  deriveChildScopeAbsentParentWarning,
  validateChildScopePrimarySelection,
} from '../../planner/plannerChildScope';

export type ChildTaskScopeCatalog = {
  contextPacks: ContextPackCatalogEntry[];
  activeContextPackDir: string | null;
  selectedContextPackDir: string;
  onListRepoTree: (
    repoLocalPath: string,
    relativePath?: string,
  ) => Promise<ContextPackListRepoTreeResponse | null>;
};

export type SaveChildScopeArgs = {
  childScope: PlannerChildTaskExecutionScope;
  reloadScope: ReturnType<typeof buildPlannerPlanningReloadScope>;
};

export function useChildTaskScopeOverride(args: {
  catalog?: ChildTaskScopeCatalog;
  selectedParentTask: ArchivedTaskEntry | null;
  loadingChildTaskParent: boolean;
  parentReady: boolean;
  onSaveChangedScope: (args: SaveChildScopeArgs) => Promise<boolean>;
}) {
  const { catalog, selectedParentTask, loadingChildTaskParent, parentReady, onSaveChangedScope } = args;
  const [parentScope, setParentScope] = useState<PlannerChildTaskExecutionScope | null>(null);
  const [savedScope, setSavedScope] = useState<PlannerChildTaskExecutionScope | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [statusLabel, setStatusLabel] = useState<'Using parent scope' | 'Child scope adjusted'>('Using parent scope');
  const [panelError, setPanelError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedPack = useMemo(() => {
    if (!savedScope || !catalog) return undefined;
    return catalog.contextPacks.find(
      (entry) => entry.contextPackDir === savedScope.contextPackDir
        && entry.contextPackId === savedScope.contextPackId,
    );
  }, [catalog, savedScope]);

  const reset = useCallback(() => {
    setParentScope(null);
    setSavedScope(null);
    setPanelOpen(false);
    setStatusLabel('Using parent scope');
    setPanelError(null);
    setSaving(false);
  }, []);

  const initializeFromParent = useCallback((task: ArchivedTaskEntry): PlannerChildTaskExecutionScope | null => {
    if (!task.plannerFocusSnapshot) return null;
    const nextScope = childScopeFromFocusSnapshot(task.plannerFocusSnapshot);
    setParentScope(cloneChildScope(nextScope));
    setSavedScope(cloneChildScope(nextScope));
    setPanelOpen(false);
    setStatusLabel('Using parent scope');
    setPanelError(null);
    return nextScope;
  }, []);

  const summary = buildChildScopeSummary(selectedPack, savedScope);
  const warning = deriveChildScopeAbsentParentWarning(parentScope, savedScope, selectedPack);
  const canOpen = Boolean(
    selectedParentTask?.plannerFocusSnapshot
    && selectedPack
    && !loadingChildTaskParent
    && parentReady,
  );

  const handleSave = useCallback(async (draftScope: PlannerChildTaskExecutionScope): Promise<void> => {
    if (!parentScope || !savedScope) return;
    setPanelError(null);
    if (draftScope.contextPackDir !== parentScope.contextPackDir || draftScope.contextPackId !== parentScope.contextPackId) {
      setPanelError('Child scope must stay in the selected parent\'s context pack.');
      return;
    }
    if (areChildScopesEqual(draftScope, savedScope)) {
      setPanelOpen(false);
      return;
    }
    if (selectedPack) {
      const primarySelectionError = validateChildScopePrimarySelection(selectedPack, draftScope);
      if (primarySelectionError) {
        setPanelError(primarySelectionError);
        return;
      }
    }
    setSaving(true);
    try {
      const reloadScope = buildPlannerPlanningReloadScope(parentScope, draftScope, selectedPack);
      const didSave = await onSaveChangedScope({
        childScope: cloneChildScope(draftScope),
        reloadScope,
      });
      if (didSave) {
        setSavedScope(cloneChildScope(draftScope));
        setStatusLabel(areChildScopesEqual(draftScope, parentScope) ? 'Using parent scope' : 'Child scope adjusted');
        setPanelOpen(false);
      }
    } catch (error: unknown) {
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [onSaveChangedScope, parentScope, savedScope, selectedPack]);

  const panelProps: ChildScopeOverridePanelProps | undefined =
    selectedPack && parentScope && savedScope && catalog
      ? {
          selectedPack,
          parentScope,
          childScope: savedScope,
          statusLabel,
          summary: summary ?? '',
          warning,
          error: panelError,
          saving,
          onCancel: () => setPanelOpen(false),
          onSave: (scope) => { void handleSave(scope); },
          onListRepoTree: catalog.onListRepoTree,
        }
      : undefined;

  return {
    reset,
    initializeFromParent,
    setPanelError,
    childScopeStatusLabel: savedScope && parentReady ? statusLabel : undefined,
    childScopeSummary: parentReady ? summary : undefined,
    childScopeWarning: parentReady ? warning ?? undefined : undefined,
    childScopePanelOpen: panelOpen,
    onOpenChildScopePanel: canOpen ? () => setPanelOpen(true) : undefined,
    onCloseChildScopePanel: () => setPanelOpen(false),
    childScopePanelProps: panelProps,
  };
}
