import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider } from '../contexts/ObservabilityContext';
import { ToastProvider } from '../contexts/ToastContext';
import { useAppShell } from './useAppShell';
import { useTaskNotifications } from './useTaskNotifications';
import type { DesktopShellClient } from '../services/desktopShellClient';
import {
  createMockClient,
  createQueueStatus,
  createEnvironmentStatus,
  createObservabilitySnapshot,
  createPlannerSubmitResponse,
  createFollowUpResponse,
  createListContextPacksResponse,
  createActivateContextPackResponse,
} from '../../test';
import type { ContextPackCatalogEntry } from '../../shared/desktopContract';

const { notificationCenterProps, useTaskNotificationsMock } = vi.hoisted(() => {
  const props = {
    notifications: [],
    unseenCount: 7,
    countLabel: '7',
    isOpen: false,
    refresh: vi.fn(),
    openPanel: vi.fn(),
    closePanel: vi.fn(),
    togglePanel: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  };
  return {
    notificationCenterProps: props,
    useTaskNotificationsMock: vi.fn(() => props),
  };
});

vi.mock('./useTaskNotifications', () => ({
  useTaskNotifications: useTaskNotificationsMock,
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useTaskNotificationsMock.mockClear();
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1280,
  });
});

const ordersEstatePack: ContextPackCatalogEntry = {
  contextPackId: 'orders-estate',
  displayName: 'Orders Estate',
  contextPackDir: '/tmp/context-packs/orders-estate',
  manifestPath: '/tmp/context-packs/orders-estate/qmd/repo-sources.json',
  bootstrapReady: true,
  source: 'active-env',
  isActive: true,
  estateType: 'distributed-platform',
  defaultScopeMode: 'focused',
  repoCount: 1,
  primaryWorkingRepoIds: ['orders-api'],
  focusTargets: [
    {
      focusId: 'orders-api',
      displayName: 'Orders API',
      kind: 'repository',
      repoId: 'orders-api',
      serviceName: 'Orders API',
      systemLayer: 'backend',
      repoRole: 'backend-service',
      repositoryType: null,
      relativePath: null,
      focusType: null,
      group: null,
      defaultFocusable: true,
      activationPriority: 10,
      adjacentRepoIds: [],
      adjacentFocusIds: [],
    },
  ],
};

function createClient(overrides?: Partial<DesktopShellClient>): DesktopShellClient {
  return createMockClient({
    getQueueStatus: vi.fn().mockResolvedValue({
      ok: true,
      response: createQueueStatus({
        queueDepth: 1,
        activeTaskId: 'CAP-CUSTOM-TERMINAL-04',
        message: 'Observed repo queue state: 1 queued, workflow currently active.',
      }),
    }),
    getEnvironmentStatus: vi.fn().mockResolvedValue({
      ok: true,
      response: createEnvironmentStatus({
        message: 'Environment.',
        repoRoot: '/repo/root',
        packageOutputDir: 'release',
        packageArtifactName: 'TaskSail.app',
        validationSummary: 'Helpers available.',
        launchPolicy: 'Host native.',
        contextPackCommand: 'tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack',
        contextPackWritePlanHint: 'Use --write-plan.',
        bootstrapFlowHint: 'Use bootstrap flags.',
      }),
    }),
    getObservabilitySnapshot: vi.fn().mockResolvedValue({
      ok: true,
      response: createObservabilitySnapshot({
        message: 'Observability.',
        queueDepth: 1,
        activeTaskId: 'CAP-CUSTOM-TERMINAL-04',
        activeTaskTitle: 'Observe queue artifacts',
        currentState: 'active',
        policyBoundary: 'Repo artifacts remain authoritative.',
      }),
    }),
    submitPlannerDraft: vi.fn().mockResolvedValue({
      ok: true,
      response: createPlannerSubmitResponse({
        message: 'Planner draft accepted for local review only. No dropbox file or helper script was invoked.',
        draftTitle: 'x',
      }),
    }),
    initiateFollowUp: vi.fn().mockResolvedValue({
      ok: true,
      response: createFollowUpResponse({
        message:
          'Follow-up draft staged locally only. No child task has been created and the closed parent task remains unchanged.',
        sourceTaskId: 'CAP-CUSTOM-TERMINAL-08',
        parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
        rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
      }),
    }),
    listContextPacks: vi.fn().mockResolvedValue({
      ok: true,
      response: createListContextPacksResponse([ordersEstatePack], {
        message: 'Discovered 1 context pack(s) from approved local sources.',
        activeContextPackDir: '/tmp/context-packs/orders-estate',
        recentContextPackDirs: ['/tmp/context-packs/orders-estate'],
      }),
    }),
    activateContextPack: vi.fn().mockResolvedValue({
      ok: true,
      response: createActivateContextPackResponse({
        message: 'Context-pack activation remains gated to the stable activation command and has not been executed.',
        commandPreview: 'tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack',
      }),
    }),
    ...overrides,
  });
}

function AppShellHarness({ client }: { client: DesktopShellClient }): JSX.Element {
  return (
    <ObservabilityProvider client={client}>
      <ToastProvider>
        <AppShellContent client={client} />
      </ToastProvider>
    </ObservabilityProvider>
  );
}

function AppShellContent({ client }: { client: DesktopShellClient }): JSX.Element {
  const result = useAppShell(client);

  return (
    <section>
      <div data-testid="active-context-pack-dir">{result.contextPackSidebarProps.activeContextPackDir ?? 'none'}</div>
      <div data-testid="context-pack-count">{result.contextPackSidebarProps.contextPacks.length}</div>
      <div data-testid="delete-blocked-by-active-task">
        {String(result.contextPackSidebarProps.deleteBlockedByActiveTask)}
      </div>
      <div data-testid="modal-open">{String(result.contextPackCreationModalProps.isOpen)}</div>
      <div data-testid="sidebar-collapsed">{String(result.sidebarCollapsed)}</div>
      <div data-testid="active-task-label">{result.activeTaskLabel ?? 'none'}</div>
      <div data-testid="active-context-pack-label">{result.activeContextPackLabel ?? 'none'}</div>
      <div data-testid="planner-modal-open">{String(result.plannerModalProps.isOpen)}</div>
      <div data-testid="planner-scope-title">{result.plannerModalProps.workspaceScopeSummary?.title ?? 'none'}</div>
      <div data-testid="planner-scope-flag">{result.plannerModalProps.workspaceScopeSummary?.flag ?? 'none'}</div>
      <div data-testid="planner-scope-repos">{(result.plannerModalProps.workspaceScopeSummary?.selection.selectedRepoIds ?? []).join(',')}</div>
      <div data-testid="sidebar-draft-repos">{result.contextPackSidebarProps.selectedRepoIds.join(',')}</div>
      <div data-testid="agent-config-modal-open">{String(result.agentConfigModalProps.isOpen)}</div>
      <div data-testid="terminal-feed-events">{result.terminalFeedProps.activityStream.length}</div>
      <div data-testid="terminal-feed-replayed-events">{result.terminalFeedProps.replayedEventIds.size}</div>
      <div data-testid="terminal-feed-task-scopes">{result.terminalFeedProps.taskScopes.length}</div>
      <div data-testid="terminal-feed-selected-task">{result.terminalFeedProps.selectedTaskGuid ?? 'all'}</div>
      <div data-testid="terminal-feed-select-handler">{String(typeof result.terminalFeedProps.onSelectTaskScope === 'function')}</div>
      <div data-testid="terminal-clear-disabled-reason">{result.terminalFeedProps.clearTerminalDisabledReason ?? 'none'}</div>
      <div data-testid="reinforcement-modal-open">{String(result.reinforcementModalProps.isOpen)}</div>
      <div data-testid="reinforcement-has-context-pack">{String(result.reinforcementModalProps.hasActiveContextPack)}</div>
      <div data-testid="has-open-reinforcement">{String(typeof result.openReinforcementModal === 'function')}</div>
      <div data-testid="has-open-agent-config">{String(typeof result.openAgentConfigModal === 'function')}</div>
      <div data-testid="notification-unseen-count">{result.notificationCenterProps.unseenCount}</div>
      <div data-testid="notification-has-open">{String(typeof result.notificationCenterProps.openPanel === 'function')}</div>
      <div data-testid="notification-has-close">{String(typeof result.notificationCenterProps.closePanel === 'function')}</div>
      <div data-testid="notification-has-refresh">{String(typeof result.notificationCenterProps.refresh === 'function')}</div>
      <div data-testid="notification-has-dismiss">{String(typeof result.notificationCenterProps.dismiss === 'function')}</div>
      <div data-testid="notification-has-dismiss-all">{String(typeof result.notificationCenterProps.dismissAll === 'function')}</div>
    </section>
  );
}

describe('useAppShell', () => {
  it('returns context pack sidebar props from the composed hook', async () => {
    const client = createClient();

    render(<AppShellHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('active-context-pack-dir')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });
    expect(screen.getByTestId('context-pack-count')).toHaveTextContent('1');
  });

  it('derives the planner workspace scope summary from active-pack last-applied scope, not the sidebar draft', async () => {
    const activePack: ContextPackCatalogEntry = {
      ...ordersEstatePack,
      lastAppliedSelectedRepoIds: ['applied-only-marker'],
      lastAppliedDeepFocusEnabled: false,
    };
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue({
        ok: true,
        response: createListContextPacksResponse([activePack], {
          message: 'Discovered 1 context pack(s) from approved local sources.',
          activeContextPackDir: '/tmp/context-packs/orders-estate',
          recentContextPackDirs: ['/tmp/context-packs/orders-estate'],
        }),
      }),
    });

    render(<AppShellHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('planner-scope-repos')).toHaveTextContent('applied-only-marker');
    });
    expect(screen.getByTestId('planner-scope-title')).toHaveTextContent('Current workspace selection');
    expect(screen.getByTestId('planner-scope-flag')).toHaveTextContent('Active');
    // The marker id is not a focus target, so it can never appear in the sidebar
    // draft selection. Its presence in the planner summary proves the summary is
    // built from active-pack applied scope, not the draft.
    expect(screen.getByTestId('sidebar-draft-repos')).not.toHaveTextContent('applied-only-marker');
  });

  it('returns context pack creation modal props in closed state', async () => {
    const client = createClient();

    render(<AppShellHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('modal-open')).toHaveTextContent('false');
    });
  });

  it('exposes terminal feed, planner modal, and sidebar state', async () => {
    const client = createClient();

    render(<AppShellHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('active-context-pack-dir')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    expect(screen.getByTestId('sidebar-collapsed')).toHaveTextContent('false');
    expect(screen.getByTestId('planner-modal-open')).toHaveTextContent('false');
    expect(screen.getByTestId('agent-config-modal-open')).toHaveTextContent('false');
    expect(screen.getByTestId('terminal-feed-events')).toHaveTextContent('0');
    expect(screen.getByTestId('terminal-feed-replayed-events')).toHaveTextContent('0');
    expect(screen.getByTestId('terminal-feed-task-scopes')).toHaveTextContent('0');
    expect(screen.getByTestId('terminal-feed-selected-task')).toHaveTextContent('all');
    expect(screen.getByTestId('terminal-feed-select-handler')).toHaveTextContent('true');
    expect(screen.getByTestId('terminal-clear-disabled-reason')).toHaveTextContent(
      'Clear disabled while active context-pack tasks are running.',
    );
    expect(screen.getByTestId('delete-blocked-by-active-task')).toHaveTextContent('true');
    expect(screen.getByTestId('active-task-label')).toHaveTextContent('Observe queue artifacts');
    expect(screen.getByTestId('active-context-pack-label')).toHaveTextContent('Orders Estate Context Pack');
  });

  it('blocks terminal clear from active-context-pack scoped operator tasks', async () => {
    const client = createClient({
      getObservabilitySnapshot: vi.fn().mockResolvedValue({
        ok: true,
        response: createObservabilitySnapshot({
          operatorStatus: {
            activeTaskId: 'TASK-ACTIVE',
            activeTasks: [{ taskId: 'TASK-ACTIVE', phase: 'active', startedAt: '2026-05-31T00:00:00Z' }],
          },
        }),
      }),
    });

    render(<AppShellHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-clear-disabled-reason')).toHaveTextContent(
        'Clear disabled while active context-pack tasks are running.',
      );
    });
  });

  it('wires reinforcement modal props and sidebar callback', async () => {
    const client = createClient();

    render(<AppShellHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('active-context-pack-dir')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    expect(screen.getByTestId('reinforcement-modal-open')).toHaveTextContent('false');
    expect(screen.getByTestId('reinforcement-has-context-pack')).toHaveTextContent('true');
    expect(screen.getByTestId('has-open-reinforcement')).toHaveTextContent('true');
    expect(screen.getByTestId('has-open-agent-config')).toHaveTextContent('true');
  });

  it('composes task notifications while preserving active labels', async () => {
    const client = createClient();

    render(<AppShellHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('notification-unseen-count')).toHaveTextContent('7');
    });

    expect(useTaskNotifications).toHaveBeenCalledWith(client);
    expect(screen.getByTestId('notification-has-open')).toHaveTextContent('true');
    expect(screen.getByTestId('notification-has-close')).toHaveTextContent('true');
    expect(screen.getByTestId('notification-has-refresh')).toHaveTextContent('true');
    expect(screen.getByTestId('notification-has-dismiss')).toHaveTextContent('true');
    expect(screen.getByTestId('notification-has-dismiss-all')).toHaveTextContent('true');
    expect(screen.getByTestId('active-task-label')).toHaveTextContent('Observe queue artifacts');
    expect(screen.getByTestId('active-context-pack-label')).toHaveTextContent('Orders Estate Context Pack');
    expect(client.readTaskBoard).toHaveBeenCalled();
    expect(notificationCenterProps.openPanel).not.toHaveBeenCalled();
  });

  it('locks the planner when no active context pack is applied', async () => {
    const inactivePack: ContextPackCatalogEntry = {
      ...ordersEstatePack,
      source: 'recent-state',
      isActive: false,
    };
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue({
        ok: true,
        response: createListContextPacksResponse([inactivePack], {
          message: 'Discovered 1 context pack(s) from approved local sources.',
          activeContextPackDir: null,
        }),
      }),
      getObservabilitySnapshot: vi.fn().mockResolvedValue({
        ok: true,
        response: createObservabilitySnapshot({
          message: 'Observability.',
          currentState: 'idle',
          policyBoundary: 'Repo artifacts remain authoritative.',
        }),
      }),
      getQueueStatus: vi.fn().mockResolvedValue({
        ok: true,
        response: createQueueStatus({
          message: 'Observed repo queue state: idle.',
        }),
      }),
    });

    render(<AppShellHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('active-context-pack-dir')).toHaveTextContent('none');
    });
    expect(screen.getByTestId('delete-blocked-by-active-task')).toHaveTextContent('false');
  });
});
