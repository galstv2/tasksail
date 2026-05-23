import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackListRepoTreeResponse,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import type { CompactSidebarModel } from '../selectors/contextPackSidebarModel';
import DeepFocusSelector from './focus-selection/DeepFocusSelector';
import StandardFocusSelector from './focus-selection/StandardFocusSelector';
import type { DeepFocusCommit } from './SidebarDeepFocusControls.types';
import { supportsDeepFocus } from './SidebarDeepFocusUtils';

type SidebarScopeControlsProps = {
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
  focusHint: string | null;
  onSelectWorkingFocus: (focusId: string) => void;
  onToggleRepositoryType?: (repoId: string, currentType: 'primary' | 'support') => void;
  onCommitDeepFocusSelection: (selection: DeepFocusCommit) => void;
  onListRepoTree: (
    repoLocalPath: string,
    relativePath?: string,
  ) => Promise<ContextPackListRepoTreeResponse | null>;
  onManageFocusFilters?: () => void;
  onDeepFocusEditorToggle?: (expanded: boolean) => void;
  editorOpen?: boolean;
  sidebarModel: CompactSidebarModel;
};

function SidebarScopeControls({
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
  focusHint,
  onSelectWorkingFocus,
  onToggleRepositoryType,
  onCommitDeepFocusSelection,
  onListRepoTree,
  onManageFocusFilters,
  onDeepFocusEditorToggle,
  editorOpen,
  sidebarModel,
}: SidebarScopeControlsProps): JSX.Element | null {
  if (!selectedPack) {
    return null;
  }

  const showDeepFocus = supportsDeepFocus(selectedPack.estateType);

  if (showDeepFocus && deepFocusEnabled) {
    return (
      <DeepFocusSelector
        selectedPack={selectedPack}
        selectedWorkingFocusIds={selectedWorkingFocusIds}
        deepFocusEnabled={deepFocusEnabled}
        deepFocusPrimaryRepoId={deepFocusPrimaryRepoId}
        deepFocusPrimaryFocusId={deepFocusPrimaryFocusId}
        selectedFocusPath={selectedFocusPath}
        selectedFocusTargetKind={selectedFocusTargetKind}
        selectedFocusTargets={selectedFocusTargets}
        selectedTestTarget={selectedTestTarget}
        selectedSupportTargets={selectedSupportTargets}
        onCommitDeepFocusSelection={onCommitDeepFocusSelection}
        onListRepoTree={onListRepoTree}
        onManageFocusFilters={onManageFocusFilters}
        onDeepFocusEditorToggle={onDeepFocusEditorToggle}
        editorOpen={editorOpen}
      />
    );
  }

  return (
    <StandardFocusSelector
      selectedPack={selectedPack}
      selectedWorkingFocusIds={selectedWorkingFocusIds}
      deepFocusEnabled={deepFocusEnabled}
      deepFocusPrimaryRepoId={deepFocusPrimaryRepoId}
      deepFocusPrimaryFocusId={deepFocusPrimaryFocusId}
      selectedFocusPath={selectedFocusPath}
      selectedFocusTargetKind={selectedFocusTargetKind}
      selectedFocusTargets={selectedFocusTargets}
      selectedTestTarget={selectedTestTarget}
      selectedSupportTargets={selectedSupportTargets}
      focusHint={focusHint}
      sidebarModel={sidebarModel}
      supportsDeepFocus={showDeepFocus}
      onSelectWorkingFocus={onSelectWorkingFocus}
      onToggleRepositoryType={onToggleRepositoryType}
      onCommitDeepFocusSelection={onCommitDeepFocusSelection}
      onManageFocusFilters={onManageFocusFilters}
    />
  );
}

export default SidebarScopeControls;
