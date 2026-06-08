import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusTarget,
  ContextPackFocusFilterRepositoryType,
  ContextPackFocusFilterSelection,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import type { PlannerStagingSidecar } from '../../shared/desktopContractPlanner';

// Renderer-only display model for the Planning Specialist scope affordance.
// Represents either the live current workspace scope or the scope saved on a
// selected standard recent task. Never persisted or sent to planner launch APIs.
export type PlannerWorkspaceScopeSummary = {
  source: 'current-workspace' | 'recent-task';
  title: 'Current workspace selection' | 'Selected recent task scope';
  triggerLabel:
    | 'Current workspace selection details'
    | 'Selected recent task scope details';
  flag: 'Active' | 'Deep Focus' | 'Recent';
  selectedPack?: ContextPackCatalogEntry;
  selection: ContextPackFocusFilterSelection;
};

function deriveRepositoryTypes(
  focusTargets: ContextPackCatalogEntry['focusTargets'],
  selectedRepoIds: string[],
  selectedFocusIds: string[],
): Record<string, ContextPackFocusFilterRepositoryType> {
  const selectedIds = new Set([...selectedRepoIds, ...selectedFocusIds]);
  return Object.fromEntries(
    focusTargets
      .filter((target) => selectedIds.has(target.focusId) && target.repositoryType)
      .map((target) => [
        target.focusId,
        target.repositoryType as ContextPackFocusFilterRepositoryType,
      ]),
  );
}

// Derives a display selection from the active pack's last-applied scope.
// Regular planner transparency must reflect the active pack the planner uses,
// not the sidebar's draft selection (which can diverge). Mirrors the
// repositoryType extraction in useContextPackSelection.buildSelectionSnapshot.
export function deriveActivePackWorkspaceSelection(
  activePack: ContextPackCatalogEntry,
): ContextPackFocusFilterSelection {
  const selectedRepoIds = activePack.lastAppliedSelectedRepoIds ?? [];
  const selectedFocusIds = activePack.lastAppliedSelectedFocusIds ?? [];
  const repositoryTypes = deriveRepositoryTypes(
    activePack.focusTargets,
    selectedRepoIds,
    selectedFocusIds,
  );
  return {
    selectedRepoIds: [...selectedRepoIds],
    selectedFocusIds: [...selectedFocusIds],
    ...(Object.keys(repositoryTypes).length ? { repositoryTypes } : {}),
    deepFocusEnabled: activePack.lastAppliedDeepFocusEnabled ?? false,
    deepFocusPrimaryRepoId: activePack.lastAppliedDeepFocusPrimaryRepoId ?? null,
    deepFocusPrimaryFocusId: activePack.lastAppliedDeepFocusPrimaryFocusId ?? null,
    selectedFocusPath: activePack.lastAppliedSelectedFocusPath ?? null,
    selectedFocusTargetKind: activePack.lastAppliedSelectedFocusTargetKind ?? null,
    selectedFocusTargets: (activePack.lastAppliedSelectedFocusTargets ?? []).map(
      (target) => ({ ...target }),
    ),
    selectedTestTarget: activePack.lastAppliedSelectedTestTarget
      ? { ...activePack.lastAppliedSelectedTestTarget }
      : null,
    selectedSupportTargets: (activePack.lastAppliedSelectedSupportTargets ?? []).map(
      (target) => ({ ...target }),
    ),
  };
}

export function buildCurrentWorkspaceScopeSummary(
  activePack: ContextPackCatalogEntry,
): PlannerWorkspaceScopeSummary {
  const selection = deriveActivePackWorkspaceSelection(activePack);
  return {
    source: 'current-workspace',
    title: 'Current workspace selection',
    triggerLabel: 'Current workspace selection details',
    flag: selection.deepFocusEnabled ? 'Deep Focus' : 'Active',
    selectedPack: activePack,
    selection,
  };
}

type RecentTaskContextPackBinding = PlannerStagingSidecar['contextPackBinding'];

// Maps a hydrated standard recent task's sidecar binding into the frontend
// selection type. The binding is the backend shape: optional anchor ids and
// backend target arrays. Normalize optional anchors with ?? null and clone/cast
// the target arrays to the frontend deep-focus types (structurally compatible).
export function mapRecentTaskBindingToSelection(
  binding: RecentTaskContextPackBinding,
): ContextPackFocusFilterSelection {
  return {
    selectedRepoIds: [...binding.selectedRepoIds],
    selectedFocusIds: [...binding.selectedFocusIds],
    ...(binding.repositoryTypes && Object.keys(binding.repositoryTypes).length
      ? { repositoryTypes: { ...binding.repositoryTypes } }
      : {}),
    deepFocusEnabled: binding.deepFocusEnabled,
    deepFocusPrimaryRepoId: binding.deepFocusPrimaryRepoId ?? null,
    deepFocusPrimaryFocusId: binding.deepFocusPrimaryFocusId ?? null,
    selectedFocusPath: binding.selectedFocusPath,
    selectedFocusTargetKind: binding.selectedFocusTargetKind as ContextPackFocusTargetKind | null,
    selectedFocusTargets: binding.selectedFocusTargets.map(
      (target) => ({ ...target }),
    ) as ContextPackPrimaryFocusTarget[],
    selectedTestTarget: binding.selectedTestTarget
      ? ({ ...binding.selectedTestTarget } as ContextPackDeepFocusTarget)
      : null,
    // Drop NormalizedSupportTarget.effectiveScope; ContextPackDeepFocusTarget
    // does not declare it, so the remaining fields map cleanly without a cast.
    selectedSupportTargets: binding.selectedSupportTargets.map(
      ({ effectiveScope, ...rest }) => ({ ...rest }),
    ),
  };
}

export function buildRecentTaskScopeSummary(
  binding: RecentTaskContextPackBinding,
  selectedPack?: ContextPackCatalogEntry,
): PlannerWorkspaceScopeSummary {
  return {
    source: 'recent-task',
    title: 'Selected recent task scope',
    triggerLabel: 'Selected recent task scope details',
    flag: 'Recent',
    ...(selectedPack ? { selectedPack } : {}),
    selection: mapRecentTaskBindingToSelection(binding),
  };
}
