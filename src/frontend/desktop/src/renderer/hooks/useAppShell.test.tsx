import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider } from '../contexts/ObservabilityContext';
import { ToastProvider } from '../contexts/ToastContext';
import { useAppShell } from './useAppShell';
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

afterEach(() => {
  cleanup();
});

beforeEach(() => {
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
      <div data-testid="modal-open">{String(result.contextPackCreationModalProps.isOpen)}</div>
      <div data-testid="sidebar-collapsed">{String(result.sidebarCollapsed)}</div>
      <div data-testid="active-task-label">{result.activeTaskLabel ?? 'none'}</div>
      <div data-testid="active-context-pack-label">{result.activeContextPackLabel ?? 'none'}</div>
      <div data-testid="planner-modal-open">{String(result.plannerModalProps.isOpen)}</div>
      <div data-testid="agent-config-modal-open">{String(result.agentConfigModalProps.isOpen)}</div>
      <div data-testid="terminal-feed-events">{result.terminalFeedProps.activityStream.length}</div>
      <div data-testid="reinforcement-modal-open">{String(result.reinforcementModalProps.isOpen)}</div>
      <div data-testid="reinforcement-has-context-pack">{String(result.reinforcementModalProps.hasActiveContextPack)}</div>
      <div data-testid="sidebar-has-open-reinforcement">{String(typeof result.contextPackSidebarProps.onOpenReinforcement === 'function')}</div>
      <div data-testid="has-open-agent-config">{String(typeof result.openAgentConfigModal === 'function')}</div>
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
    expect(screen.getByTestId('active-task-label')).toHaveTextContent('Observe queue artifacts');
    expect(screen.getByTestId('active-context-pack-label')).toHaveTextContent('Orders Estate Context Pack');
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
    expect(screen.getByTestId('sidebar-has-open-reinforcement')).toHaveTextContent('true');
    expect(screen.getByTestId('has-open-agent-config')).toHaveTextContent('true');
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
  });
});
