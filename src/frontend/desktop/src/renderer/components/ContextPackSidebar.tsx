import type {
  ContextPackCatalogEntry,
  ContextPackReseedExecutionResult,
  ContextPackSwitchExecutionResult,
} from '../../shared/desktopContract';
import ContextPackSidebarCompact from './ContextPackSidebarCompact';
import ContextPackSidebarExpanded from './ContextPackSidebarExpanded';

export type ContextPackSidebarProps = {
  contextPacks: ContextPackCatalogEntry[];
  activeContextPackDir: string | null;
  selectedContextPackDir: string;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
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
  onOpenCreateModal: () => void;
  onReseedContextPack: () => void | Promise<void>;
  onPreviewSwitch: () => void | Promise<void>;
  onApplySwitch: () => void | Promise<void>;
  onClearActive: () => void | Promise<void>;
  showMultiPrimaryWarning: boolean;
  onDismissMultiPrimaryWarning: () => void;
  onToggleRepositoryType?: (repoId: string, currentType: 'primary' | 'support') => void;
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
