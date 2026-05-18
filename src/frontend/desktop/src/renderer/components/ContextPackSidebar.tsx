import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
  ContextPackListRepoTreeResponse,
  ContextPackReseedExecutionResult,
  ContextPackSwitchExecutionResult,
  ContextPackFocusFilter,
} from '../../shared/desktopContract';
import type { OpenContextPackCreationModal } from '../contextPackCreationTypes';
import ContextPackSidebarCompact from './ContextPackSidebarCompact';
import ContextPackSidebarExpanded from './ContextPackSidebarExpanded';

export type ContextPackSidebarProps = {
  contextPacks: ContextPackCatalogEntry[];
  activeContextPackDir: string | null;
  selectedContextPackDir: string;
  repoRoot?: string;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  deepFocusEnabled?: boolean;
  deepFocusPrimaryRepoId?: string | null;
  deepFocusPrimaryFocusId?: string | null;
  selectedFocusPath?: string | null;
  selectedFocusTargetKind?: ContextPackFocusTargetKind | null;
  selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
  selectedTestTarget?: ContextPackDeepFocusTarget | null;
  selectedSupportTargets?: ContextPackDeepFocusTarget[];
  focusFilters?: ContextPackFocusFilter[];
  focusFilterPending?: boolean;
  focusFilterError?: string;
  actionPending: 'refresh' | 'preview' | 'apply' | 'clear' | 'reseed' | null;
  message: string;
  error: string;
  lastResult: ContextPackSwitchExecutionResult | null;
  lastReseedResult: ContextPackReseedExecutionResult | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectContextPack: (contextPackDir: string) => void;
  onSelectWorkingFocus: (repoId: string) => void;
  onRefreshCatalog: () => void | Promise<void>;
  onOpenCreateModal: OpenContextPackCreationModal;
  onReseedContextPack: () => void | Promise<void>;
  onPreviewSwitch: () => void | Promise<void>;
  onApplySwitch: () => void | Promise<void>;
  onClearActive: () => void | Promise<void>;
  onDeleteContextPack?: (contextPackDir: string) => boolean | Promise<boolean>;
  deleteBlockedByActiveTask?: boolean;
  onCreateFocusFilter?: (name: string) => Promise<boolean>;
  onApplyFocusFilter?: (filterId: string) => boolean | Promise<boolean>;
  onDeleteFocusFilter?: (filterId: string) => void | Promise<void>;
  showMultiPrimaryWarning: boolean;
  onDismissMultiPrimaryWarning: () => void;
  /** True when an apply was blocked because the selected pack is bootstrap-empty. */
  bootstrapEmptyConfirmPending: boolean;
  /** Continue the apply as if the pack were seeded. */
  onConfirmActivateAnyway: () => void | Promise<void>;
  /** Cancel the apply and trigger a reseed instead. */
  onConfirmPopulateAndSeed: () => void | Promise<void>;
  onToggleRepositoryType?: (repoId: string, currentType: 'primary' | 'support') => void;
  onCommitDeepFocusSelection: (selection: {
    deepFocusEnabled: boolean;
    deepFocusPrimaryRepoId: string | null;
    deepFocusPrimaryFocusId: string | null;
    selectedFocusPath: string | null;
    selectedFocusTargetKind: ContextPackFocusTargetKind | null;
    selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
    selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
    selectedSupportTargets: ContextPackDeepFocusTarget[];
  }) => void;
  onListRepoTree: (
    repoLocalPath: string,
    relativePath?: string,
  ) => Promise<ContextPackListRepoTreeResponse | null>;
  onOpenPlannerModal: () => void;
};

function ContextPackSidebar({
  collapsed,
  ...rest
}: ContextPackSidebarProps): JSX.Element {
  if (collapsed) {
    return (
      <ContextPackSidebarCompact
        contextPacks={rest.contextPacks}
        activeContextPackDir={rest.activeContextPackDir}
        selectedContextPackDir={rest.selectedContextPackDir}
        actionPending={rest.actionPending}
        onToggleCollapse={rest.onToggleCollapse}
        onSelectContextPack={rest.onSelectContextPack}
        onRefreshCatalog={rest.onRefreshCatalog}
        onOpenCreateModal={rest.onOpenCreateModal}
        onReseedContextPack={rest.onReseedContextPack}
        onPreviewSwitch={rest.onPreviewSwitch}
        onApplySwitch={rest.onApplySwitch}
        onClearActive={rest.onClearActive}
        onOpenPlannerModal={rest.onOpenPlannerModal}
      />
    );
  }

  return <ContextPackSidebarExpanded {...rest} />;
}

export default ContextPackSidebar;
