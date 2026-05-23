import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackListRepoTreeResponse,
  ContextPackPrimaryFocusTarget,
} from '../../../shared/desktopContract';
import SidebarDeepFocusControls from '../SidebarDeepFocusControls';
import type { DeepFocusCommit } from '../SidebarDeepFocusControls.types';

export type DeepFocusSelectorProps = {
  selectedPack: ContextPackCatalogEntry | undefined;
  selectedWorkingFocusIds: string[];
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
  onCommitDeepFocusSelection: (selection: DeepFocusCommit) => void;
  onListRepoTree: (
    repoLocalPath: string,
    relativePath?: string,
  ) => Promise<ContextPackListRepoTreeResponse | null>;
  onManageFocusFilters?: () => void;
  onDeepFocusEditorToggle?: (expanded: boolean) => void;
  editorOpen?: boolean;
  showFocusFilterButton?: boolean;
};

function DeepFocusSelector({
  selectedPack,
  selectedWorkingFocusIds,
  deepFocusEnabled,
  deepFocusPrimaryRepoId,
  deepFocusPrimaryFocusId,
  selectedFocusPath,
  selectedFocusTargetKind,
  selectedFocusTargets,
  selectedTestTarget,
  selectedSupportTargets,
  onCommitDeepFocusSelection,
  onListRepoTree,
  onManageFocusFilters,
  onDeepFocusEditorToggle,
  editorOpen,
  showFocusFilterButton = true,
}: DeepFocusSelectorProps): JSX.Element | null {
  if (!selectedPack) {
    return null;
  }

  const deepFocusPrimaryId = selectedPack.estateType === 'distributed-platform'
    ? deepFocusPrimaryRepoId
    : deepFocusPrimaryFocusId;
  const fallbackScalarId = deepFocusPrimaryId;
  const hasDeepFocusScope = selectedFocusPath !== null
    || selectedFocusTargetKind !== null
    || (selectedFocusTargets ?? []).length > 0;
  const deepFocusWorkingFocusIds = fallbackScalarId
    ? [fallbackScalarId]
    : hasDeepFocusScope
      ? selectedWorkingFocusIds
      : [];

  return (
    <SidebarDeepFocusControls
      selectedPack={selectedPack}
      selectedWorkingFocusIds={deepFocusWorkingFocusIds}
      deepFocusPrimaryId={deepFocusPrimaryId}
      deepFocusEnabled={deepFocusEnabled}
      selectedFocusPath={selectedFocusPath}
      selectedFocusTargetKind={selectedFocusTargetKind}
      selectedFocusTargets={selectedFocusTargets}
      selectedTestTarget={selectedTestTarget}
      selectedSupportTargets={selectedSupportTargets}
      onCommitDeepFocusSelection={onCommitDeepFocusSelection}
      onListRepoTree={onListRepoTree}
      onManageFocusFilters={showFocusFilterButton ? onManageFocusFilters : undefined}
      onDeepFocusEditorToggle={onDeepFocusEditorToggle}
      editorOpen={editorOpen}
      showFocusFilterButton={showFocusFilterButton}
    />
  );
}

export default DeepFocusSelector;
