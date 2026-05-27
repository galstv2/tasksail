import AgentConfigModal from './components/AgentConfigModal';
import AgentInstructionsBrowser from './components/AgentInstructionsBrowser';
import AgentInstructionsEditor from './components/AgentInstructionsEditor';
import AgentConfigRail from './components/AgentConfigRail';
import InstructionsRail from './components/InstructionsRail';
import ConfigRailStack from './components/ConfigRailStack';
import ContextPackSidebar from './components/ContextPackSidebar';
import { RefreshIcon, StarIcon } from './components/creation-steps/icons';
import { TaskNotificationCenterButton } from './components/task-notifications/TaskNotificationCenterButton';
import { TaskNotificationPanel } from './components/task-notifications/TaskNotificationPanel';
import TaskBoard from './components/taskboard/TaskBoard';
import ContextPackCreationModal from './components/ContextPackCreationModal';
import ErrorBoundary from './components/ErrorBoundary';
import McpConfigModal from './components/McpConfigModal';
import ReinforcementModal from './components/reinforcement/ReinforcementModal';
import McpConfigRail from './components/McpConfigRail';
import TerminalFeed from './components/TerminalFeed';
import PlannerModal from './components/PlannerModal';
import { ObservabilityProvider } from './contexts/ObservabilityContext';
import { ToastProvider } from './contexts/ToastContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppShell } from './hooks/useAppShell';
import { useThemeToggle } from './hooks/useThemeToggle';
import { classNames } from './utils/classNames';

const NOTIFICATION_PANEL_CLOSE_MS = 160;

function AppContent(): JSX.Element {
  const {
    contextPackSidebarProps,
    contextPackCreationModalProps,
    terminalFeedProps,
    plannerModalProps,
    onRefreshRepoState,
    sidebarCollapsed,
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
    notificationCenterProps,
  } = useAppShell();

  const { isDark, toggleTheme } = useThemeToggle();
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const notificationCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isNotificationPanelClosing, setIsNotificationPanelClosing] = useState(false);

  const clearNotificationCloseTimer = useCallback(() => {
    if (notificationCloseTimerRef.current) {
      clearTimeout(notificationCloseTimerRef.current);
      notificationCloseTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearNotificationCloseTimer, [clearNotificationCloseTimer]);

  const openNotificationPanel = useCallback(() => {
    clearNotificationCloseTimer();
    setIsNotificationPanelClosing(false);
    void notificationCenterProps.openPanel();
  }, [clearNotificationCloseTimer, notificationCenterProps]);

  const closeNotificationPanel = useCallback(() => {
    if (!notificationCenterProps.isOpen && !isNotificationPanelClosing) return;
    clearNotificationCloseTimer();
    setIsNotificationPanelClosing(true);
    notificationCenterProps.closePanel();
    notificationButtonRef.current?.focus();
    notificationCloseTimerRef.current = setTimeout(() => {
      notificationCloseTimerRef.current = null;
      setIsNotificationPanelClosing(false);
    }, NOTIFICATION_PANEL_CLOSE_MS);
  }, [
    clearNotificationCloseTimer,
    isNotificationPanelClosing,
    notificationCenterProps,
  ]);

  const toggleNotificationPanel = useCallback(() => {
    if (notificationCenterProps.isOpen || isNotificationPanelClosing) {
      closeNotificationPanel();
      return;
    }
    openNotificationPanel();
  }, [
    closeNotificationPanel,
    isNotificationPanelClosing,
    notificationCenterProps.isOpen,
    openNotificationPanel,
  ]);

  const shouldRenderNotificationPanel = notificationCenterProps.isOpen || isNotificationPanelClosing;

  return (
    <main className="shell">
      <header className="shell__header">
        <div className="shell__brand">
          <svg className="shell__logo" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 4 L20 12 L12 12 Z" fill="var(--ts-brand-burgundy)" stroke="none"/>
            <path d="M12 6 L6 12 L12 12 Z" fill="var(--ts-brand-burgundy)" stroke="none"/>
            <path d="M12 3 L12 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M5 19 C7 17, 10 17, 12 19 C14 17, 17 17, 19 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
          </svg>
          <h1 className="shell__title">TaskSail</h1>
        </div>
        <div className="shell__status-chips">
          <TaskNotificationCenterButton
            ref={notificationButtonRef}
            unseenCount={notificationCenterProps.unseenCount}
            countLabel={notificationCenterProps.countLabel}
            isOpen={notificationCenterProps.isOpen}
            onToggle={toggleNotificationPanel}
          />
        </div>
        <div className="shell__actions">
          <button type="button" className="shell__refresh-btn" onClick={onRefreshRepoState} aria-label="Refresh" title="Refresh state">
            <RefreshIcon />
          </button>
          <button type="button" className="shell__refresh-btn" onClick={openReinforcementModal} aria-label="Reinforcement" title="Reinforcement" data-testid="reinforcement-open-btn">
            <StarIcon />
          </button>
          <button type="button" className="shell__refresh-btn" onClick={toggleTheme} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title={isDark ? 'Light mode' : 'Dark mode'}>
            {isDark ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.06 1.06M11.19 11.19l1.06 1.06M3.75 12.25l1.06-1.06M11.19 4.81l1.06-1.06" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 9.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
            )}
          </button>
        </div>
      </header>
      <div className={classNames('shell__body', sidebarCollapsed && 'sidebar--collapsed')}>
        <ContextPackSidebar {...contextPackSidebarProps} />
        <section className="shell-main" aria-label="Agent workspace">
          <TerminalFeed {...terminalFeedProps} />
          <TaskBoard {...taskBoardProps} />
        </section>
        <ConfigRailStack>
          <McpConfigRail enabledCount={enabledMcpServerCount} onClick={openMcpConfigModal} />
          <AgentConfigRail onClick={openAgentConfigModal} />
          <InstructionsRail onClick={openAgentInstructionsModal} />
        </ConfigRailStack>
      </div>
      <PlannerModal {...plannerModalProps} />
      <ContextPackCreationModal {...contextPackCreationModalProps} />
      <AgentConfigModal {...agentConfigModalProps} />
      <AgentInstructionsBrowser {...instructionsBrowserProps} />
      <AgentInstructionsEditor {...instructionsEditorProps} />
      <McpConfigModal {...mcpConfigModalProps} />
      {reinforcementModalProps.isOpen && <ReinforcementModal {...reinforcementModalProps} />}
      {shouldRenderNotificationPanel && (
        <TaskNotificationPanel
          notifications={notificationCenterProps.notifications}
          onClose={closeNotificationPanel}
          onRefresh={() => void notificationCenterProps.refresh()}
          onDismiss={(notificationId) => void notificationCenterProps.dismiss(notificationId)}
          onDismissAll={() => void notificationCenterProps.dismissAll()}
          returnFocusRef={notificationButtonRef}
          isClosing={isNotificationPanelClosing}
        />
      )}
    </main>
  );
}

function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <ObservabilityProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </ObservabilityProvider>
    </ErrorBoundary>
  );
}

export default App;
