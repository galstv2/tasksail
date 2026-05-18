import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { useAgentInstructionsModal, type AgentInstructionsBrowserProps, type AgentInstructionsEditorProps } from './useAgentInstructionsModal';
import { useMcpConfigModal, type McpConfigModalProps } from './useMcpConfigModal';
import { usePlannerModal } from './usePlannerModal';
import { useReinforcementModal, type ReinforcementModalProps } from './useReinforcementModal';
import { useTaskBoard } from './useTaskBoard';
import type { TaskBoardProps } from '../components/taskboard/TaskBoard';
import { desktopShellClient, type DesktopShellClient } from '../services/desktopShellClient';
import type { PlannerStartSessionDeepFocusSelection } from '../../shared/desktopContract';

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
  instructionsBrowserProps: AgentInstructionsBrowserProps;
  instructionsEditorProps: AgentInstructionsEditorProps;
  openAgentInstructionsModal: () => void;
  mcpConfigModalProps: McpConfigModalProps;
  openMcpConfigModal: () => void;
  enabledMcpServerCount: number;
  reinforcementModalProps: ReinforcementModalProps;
  openReinforcementModal: () => void;
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

  const {
    events: streamEvents,
    replayedEventIds,
    taskScopes,
    selectedTaskGuid,
    setSelectedTaskGuid,
  } = useStreamEvents();

  const taskBoard = useTaskBoard(client);
  const { agentConfigModalProps, openAgentConfigModal } = useAgentConfigModal(client);
  const { browserProps: instructionsBrowserProps, editorProps: instructionsEditorProps, openAgentInstructionsModal } = useAgentInstructionsModal(client);
  const { mcpConfigModalProps, openMcpConfigModal, enabledServerCount: enabledMcpServerCount } = useMcpConfigModal(client);
  const { reinforcementModalProps, openReinforcementModal } = useReinforcementModal(
    hasActiveContextPack,
    contextPackSidebarProps.activeContextPackDir,
  );
  const plannerDeepFocusSelection: PlannerStartSessionDeepFocusSelection | undefined = useMemo(
    () => contextPackSidebarProps.deepFocusEnabled
      ? {
          deepFocusEnabled: contextPackSidebarProps.deepFocusEnabled,
          deepFocusPrimaryRepoId: contextPackSidebarProps.deepFocusPrimaryRepoId ?? null,
          deepFocusPrimaryFocusId: contextPackSidebarProps.deepFocusPrimaryFocusId ?? null,
          selectedFocusPath: contextPackSidebarProps.selectedFocusPath ?? null,
          selectedFocusTargetKind: contextPackSidebarProps.selectedFocusTargetKind ?? null,
          selectedFocusTargets: contextPackSidebarProps.selectedFocusTargets ?? [],
          selectedTestTarget: contextPackSidebarProps.selectedTestTarget,
          selectedSupportTargets: contextPackSidebarProps.selectedSupportTargets ?? [],
          selectedRepoIds: contextPackSidebarProps.selectedRepoIds,
          selectedFocusIds: contextPackSidebarProps.selectedFocusIds,
        }
      : undefined,
    [
      contextPackSidebarProps.deepFocusEnabled,
      contextPackSidebarProps.deepFocusPrimaryRepoId,
      contextPackSidebarProps.deepFocusPrimaryFocusId,
      contextPackSidebarProps.selectedFocusPath,
      contextPackSidebarProps.selectedFocusTargetKind,
      contextPackSidebarProps.selectedFocusTargets,
      contextPackSidebarProps.selectedTestTarget,
      contextPackSidebarProps.selectedSupportTargets,
      contextPackSidebarProps.selectedRepoIds,
      contextPackSidebarProps.selectedFocusIds,
    ],
  );

  const { plannerModalProps, openPlannerModal } = usePlannerModal(
    client,
    observability?.currentState,
    hasActiveContextPack,
    contractError,
    setContractError,
    contextPackSidebarProps.activeContextPackDir ?? null,
    plannerDeepFocusSelection,
  );

  const deleteBlockedByActiveTask = Boolean(
    observability?.activeTaskId
    || observability?.activeTasks?.length
    || observability?.operatorStatus?.activeTasks.length,
  );

  const mergedSidebarProps = useMemo(
    () => ({
      ...contextPackSidebarProps,
      deleteBlockedByActiveTask,
      collapsed: effectiveSidebarCollapsed,
      onToggleCollapse: toggleSidebar,
      onOpenPlannerModal: openPlannerModal,
    }),
    [
      contextPackSidebarProps,
      deleteBlockedByActiveTask,
      effectiveSidebarCollapsed,
      toggleSidebar,
      openPlannerModal,
    ],
  );

  const terminalFeedProps = useMemo(
    () => ({
      activityStream: streamEvents,
      replayedEventIds,
      taskScopes,
      selectedTaskGuid,
      onSelectTaskScope: setSelectedTaskGuid,
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
    [
      streamEvents,
      replayedEventIds,
      taskScopes,
      selectedTaskGuid,
      setSelectedTaskGuid,
      observability,
      environmentStatus,
      client,
      addToast,
      refreshObservedState,
    ],
  );

  const onRefreshRepoState = useCallback(async () => {
    await Promise.all([refreshObservedState(), taskBoard.refresh()]);
  }, [refreshObservedState, taskBoard.refresh]);

  // Auto-refresh the task board and observability state when the active
  // context pack changes (e.g. user clicks Apply on a different pack).
  const activePackDir = contextPackSidebarProps.activeContextPackDir;
  const activePackDirOnMountRef = useRef(activePackDir);
  useEffect(() => {
    if (activePackDirOnMountRef.current === activePackDir) {
      return;
    }
    activePackDirOnMountRef.current = activePackDir;
    void onRefreshRepoState();
  }, [activePackDir, onRefreshRepoState]);

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
    instructionsBrowserProps,
    instructionsEditorProps,
    openAgentInstructionsModal,
    mcpConfigModalProps,
    openMcpConfigModal,
    enabledMcpServerCount,
    reinforcementModalProps,
    openReinforcementModal,
    taskBoardProps,
  };
}
