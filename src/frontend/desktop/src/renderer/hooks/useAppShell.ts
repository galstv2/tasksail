import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  LifecycleState,
} from '../../shared/desktopContract';
import type { ContextPackCreationModalProps } from '../contextPackCreationTypes';
import type { ContextPackSidebarProps } from '../components/ContextPackSidebar';
import type { TerminalFeedProps } from '../components/TerminalFeed';
import type { PlannerModalProps } from '../components/PlannerModal';
import { useObservabilityContext } from '../contexts/ObservabilityContext';
import { useToastContext } from '../contexts/ToastContext';
import { useContextPackSelection } from './useContextPackSelection';
import { useStreamEvents } from './useStreamEvents';
import { useAgentConfigModal, type AgentConfigModalProps } from './useAgentConfigModal';
import { useMcpConfigModal, type McpConfigModalProps } from './useMcpConfigModal';
import { usePlannerModal } from './usePlannerModal';
import { useReinforcementModal, type ReinforcementModalProps } from './useReinforcementModal';
import { useTaskBoard } from './useTaskBoard';
import type { TaskBoardProps } from '../components/taskboard/TaskBoard';
import { desktopShellClient, type DesktopShellClient } from '../services/desktopShellClient';

const AUTO_COLLAPSE_SIDEBAR_BREAKPOINT_PX = 1080;

export type UseAppShellResult = {
  contextPackSidebarProps: ContextPackSidebarProps;
  contextPackCreationModalProps: ContextPackCreationModalProps;
  terminalFeedProps: TerminalFeedProps;
  plannerModalProps: PlannerModalProps;
  activeTaskLabel: string | null;
  activeContextPackLabel: string | null;
  currentLifecycleState: LifecycleState | undefined;
  onRefreshRepoState: () => Promise<void>;
  sidebarCollapsed: boolean;
  openPlannerModal: () => void;
  hasActiveContextPack: boolean;
  agentConfigModalProps: AgentConfigModalProps;
  openAgentConfigModal: () => void;
  mcpConfigModalProps: McpConfigModalProps;
  openMcpConfigModal: () => void;
  enabledMcpServerCount: number;
  reinforcementModalProps: ReinforcementModalProps;
  taskBoardProps: TaskBoardProps;
};

export function useAppShell(
  client: DesktopShellClient = desktopShellClient,
): UseAppShellResult {
  const {
    observability,
    environmentStatus,
    contractError,
    setContractError,
    refreshObservedState,
  } = useObservabilityContext();
  const { addToast } = useToastContext();

  const { contextPackSidebarProps, contextPackCreationModalProps } = useContextPackSelection(
    client,
    environmentStatus?.repoRoot,
  );
  const hasActiveContextPack = Boolean(contextPackSidebarProps.activeContextPackDir);
  const activeContextPackName = contextPackSidebarProps.contextPacks.find(
    (entry) => entry.contextPackDir === contextPackSidebarProps.activeContextPackDir,
  )?.displayName;
  const activeContextPackLabel = activeContextPackName
    ? `${activeContextPackName} Context Pack`
    : undefined;

  const [autoSidebarCollapsed, setAutoSidebarCollapsed] = useState(
    () => window.innerWidth <= AUTO_COLLAPSE_SIDEBAR_BREAKPOINT_PX,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  useEffect(() => {
    const onResize = () => {
      setAutoSidebarCollapsed(
        window.innerWidth <= AUTO_COLLAPSE_SIDEBAR_BREAKPOINT_PX,
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const effectiveSidebarCollapsed = autoSidebarCollapsed || sidebarCollapsed;

  const { events: streamEvents } = useStreamEvents();

  const taskBoard = useTaskBoard(client);
  const { agentConfigModalProps, openAgentConfigModal } = useAgentConfigModal(client);
  const { mcpConfigModalProps, openMcpConfigModal, enabledServerCount: enabledMcpServerCount } = useMcpConfigModal(client);
  const { reinforcementModalProps, openReinforcementModal } = useReinforcementModal(
    hasActiveContextPack,
    contextPackSidebarProps.activeContextPackDir,
  );

  const { plannerModalProps, openPlannerModal } = usePlannerModal(
    client,
    observability?.currentState,
    hasActiveContextPack,
    contractError,
    setContractError,
    contextPackSidebarProps.activeContextPackDir ?? null,
  );

  const mergedSidebarProps = useMemo(
    () => ({
      ...contextPackSidebarProps,
      collapsed: effectiveSidebarCollapsed,
      onToggleCollapse: toggleSidebar,
      onOpenReinforcement: openReinforcementModal,
      onOpenPlannerModal: openPlannerModal,
    }),
    [contextPackSidebarProps, effectiveSidebarCollapsed, toggleSidebar, openReinforcementModal, openPlannerModal],
  );

  const terminalFeedProps = useMemo(
    () => ({
      activityStream: streamEvents,
      observabilitySnapshot: observability ?? null,
      environmentStatus: environmentStatus ?? null,
      onDeletePendingItem: async (queueName: string) => {
        const result = await client.deletePendingItem(queueName);
        if (!result.ok) {
          addToast({ severity: 'error', message: result.error, duration: 6000 });
          return;
        }
        addToast({ severity: 'success', message: result.response.message, duration: 4000 });
        await refreshObservedState();
      },
    }),
    [streamEvents, observability, environmentStatus, client, addToast, refreshObservedState],
  );

  const onRefreshRepoState = useCallback(async () => {
    await Promise.all([refreshObservedState(), taskBoard.refresh()]);
  }, [refreshObservedState, taskBoard.refresh]);

  const taskBoardProps: TaskBoardProps = useMemo(
    () => ({
      board: taskBoard.board,
      onReorderPending: taskBoard.reorderPending,
      onRequeueErrorItem: taskBoard.requeueErrorItem,
      onDeleteTask: taskBoard.deleteTask,
      onMoveToPending: taskBoard.moveToPending,
      onMoveToOpen: taskBoard.moveToOpen,
      readTaskContent: taskBoard.readTaskContent,
    }),
    [taskBoard.board, taskBoard.reorderPending, taskBoard.requeueErrorItem, taskBoard.deleteTask, taskBoard.moveToPending, taskBoard.moveToOpen, taskBoard.readTaskContent],
  );

  return {
    contextPackSidebarProps: mergedSidebarProps,
    contextPackCreationModalProps,
    terminalFeedProps,
    plannerModalProps,
    activeTaskLabel: observability?.activeTaskTitle ?? observability?.activeTaskId ?? null,
    activeContextPackLabel: activeContextPackLabel ?? null,
    currentLifecycleState: observability?.currentState,
    onRefreshRepoState,
    openPlannerModal,
    sidebarCollapsed: effectiveSidebarCollapsed,
    hasActiveContextPack,
    agentConfigModalProps,
    openAgentConfigModal,
    mcpConfigModalProps,
    openMcpConfigModal,
    enabledMcpServerCount,
    reinforcementModalProps,
    taskBoardProps,
  };
}
