// @vitest-environment jsdom

import { beforeEach, vi } from 'vitest';

const { logEmit } = vi.hoisted(() => {
  const logEmit = vi.fn(() => Promise.resolve({ ok: true }));
  Object.defineProperty(window, 'desktopShell', {
    configurable: true,
    writable: true,
    value: {
      getBootstrapInfo: vi.fn().mockResolvedValue({
        appName: 'TaskSail',
        platform: 'test',
        logLevel: 'info',
        rendererForwardLevel: 'info',
        versions: { chrome: undefined, electron: undefined, node: 'test' },
      }),
      log: { emit: logEmit },
    },
  });
  return { logEmit };
});

import {
  act,
  createClient,
  ContextPackSelectionHarness,
  describe,
  expect,
  fireEvent,
  it,
  render,
  screen,
  waitFor,
  ordersEstatePack,
} from './useContextPackSelection.testSetup';
import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusState,
  ContextPackFocusFilter,
  DesktopInvokeResult,
} from '../../shared/desktopContract';

function createLoadSelectionsResponse(selections: ContextPackDeepFocusState) {
  return {
    ok: true,
    response: {
      action: 'deepFocus.loadSelections',
      mode: 'read-only',
      message: 'Deep focus selections loaded.',
      selections,
    },
  } as const;
}

function createListResponse(
  contextPacks: ContextPackCatalogEntry[],
  activeContextPackDir: string,
) {
  return {
    ok: true,
    response: {
      action: 'contextPack.list',
      mode: 'read-only',
      message: `Discovered ${contextPacks.length} context pack(s) from approved local sources.`,
      activeContextPackDir,
      configuredPaths: [],
      searchRoots: [],
      recentContextPackDirs: [activeContextPackDir],
      contextPacks,
    },
  } as const;
}

function createFocusFilter(name: string, contextPackDir: string): ContextPackFocusFilter {
  return {
    id: `${name.toLocaleLowerCase()}-filter`,
    name,
    contextPackDir,
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    selection: {
      selectedRepoIds: [],
      selectedFocusIds: [],
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: undefined,
      selectedSupportTargets: [],
    },
  };
}

function focusFilter(
  id: string,
  name: string,
  selection: ContextPackFocusFilter['selection'],
  contextPackDir = '/tmp/context-packs/orders-estate',
): ContextPackFocusFilter {
  return {
    id,
    name,
    contextPackDir,
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    selection,
  };
}

describe('useContextPackSelection', () => {
  beforeEach(() => {
    logEmit.mockImplementation(() => Promise.resolve({ ok: true }));
    window.desktopShell.log.emit = logEmit;
    logEmit.mockClear();
  });

  it('loads catalog state and prefers the active context pack', async () => {
    render(<ContextPackSelectionHarness client={createClient()} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });
    expect(screen.getByTestId('active-pack')).toHaveTextContent(
      '/tmp/context-packs/orders-estate',
    );
    expect(screen.getByTestId('selected-repo-ids')).toHaveTextContent(
      'orders-api',
    );
    expect(screen.getByTestId('message')).toHaveTextContent(
      'Discovered 2 context pack(s) from approved local sources.',
    );
  });

  it('clears focus-filter pending after the initial pack selection loads filters', async () => {
    render(<ContextPackSelectionHarness client={createClient()} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('focus-filter-pending')).toHaveTextContent('false');
    });
  });

  it('renders preview success state and warnings', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('result-stage')).toHaveTextContent('complete');
    });
    expect(screen.getByTestId('warning-count')).toHaveTextContent('1');
    expect(client.previewContextPackSwitch).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api'],
      [],
      {},
    );
  });

  it('runs reseed through the bounded client seam and stores the latest reseed result', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run reseed' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('reseed-status')).toHaveTextContent('seeded');
    });
    expect(screen.getByTestId('reseed-report-path')).toHaveTextContent(
      '/tmp/context-packs/orders-estate/qmd/context-pack-seed-report.json',
    );
    expect(screen.getByTestId('message')).toHaveTextContent(
      'Context-pack reseed completed through the approved repo-context seed seam. Conventions memo generation remains only-if-missing.',
    );
    expect(client.reseedContextPack).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
    );
  });

  it('refreshes catalog and keeps last reseed result empty when reseed is already in progress', async () => {
    const client = createClient({
      reseedContextPack: vi.fn().mockResolvedValue({
        ok: false,
        action: 'contextPack.reseed',
        error: 'reseed_in_progress',
        details: ['pid=1234'],
      }),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run reseed' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('message')).toHaveTextContent(
        'Context-pack reseed is already in progress.',
      );
    });
    expect(screen.getByTestId('reseed-status')).toHaveTextContent('no-reseed');
    expect(client.listContextPacks).toHaveBeenCalledTimes(2);
  });

  it('surfaces apply failures without hiding structured result state', async () => {
    render(<ContextPackSelectionHarness client={createClient()} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run apply' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('result-stage')).toHaveTextContent('activation');
    });
    expect(screen.getByTestId('result-status')).toHaveTextContent('error');
  });

  it('supports scope and selection changes before previewing', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select billing' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/billing-estate',
      );
    });
    expect(screen.getByTestId('selected-repo-ids')).toHaveTextContent(
      'billing-api',
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(client.previewContextPackSwitch).toHaveBeenCalledWith(
        '/tmp/context-packs/billing-estate',
        'focused',
        ['billing-api'],
        [],
        {},
      );
    });
  });

  it('deleting the selected inactive pack clears selection and persists no selected pack', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select billing' }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/billing-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete selected pack' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent('none');
    });
    expect(client.deleteContextPack).toHaveBeenCalledWith('/tmp/context-packs/billing-estate');
    expect(client.saveContextPackSidebarState).toHaveBeenCalledWith(null, null);
  });

  it('failed context-pack delete keeps the selected pack unchanged', async () => {
    const client = createClient({
      deleteContextPack: vi.fn().mockResolvedValue({
        ok: false,
        action: 'contextPack.delete',
        error: 'Delete refused.',
      }),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select billing' }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/billing-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete selected pack' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Delete refused.');
    });
    expect(screen.getByTestId('selected-pack')).toHaveTextContent('/tmp/context-packs/billing-estate');
  });

  it('ignores stale focus-filter list responses after switching context packs', async () => {
    let resolveOrdersFilters: ((value: DesktopInvokeResult) => void) | undefined;
    let resolveBillingFilters: ((value: DesktopInvokeResult) => void) | undefined;
    const client = createClient({
      listFocusFilters: vi.fn((contextPackDir: string) => new Promise<DesktopInvokeResult>((resolve) => {
        if (contextPackDir.endsWith('orders-estate')) {
          resolveOrdersFilters = resolve;
          return;
        }
        resolveBillingFilters = resolve;
      })),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select billing' }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/billing-estate',
      );
    });

    await act(async () => {
      resolveBillingFilters?.({
        ok: true,
        response: {
          action: 'focusFilters.list',
          mode: 'read-only',
          filters: [createFocusFilter('Billing', '/tmp/context-packs/billing-estate')],
          message: '1 focus filter.',
        },
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('focus-filter-names')).toHaveTextContent('Billing');
    });

    await act(async () => {
      resolveOrdersFilters?.({
        ok: true,
        response: {
          action: 'focusFilters.list',
          mode: 'read-only',
          filters: [createFocusFilter('Orders', '/tmp/context-packs/orders-estate')],
          message: '1 focus filter.',
        },
      });
    });

    expect(screen.getByTestId('focus-filter-names')).toHaveTextContent('Billing');
  });

  it('applies saved regular focus filters with different repository primary/support roles', async () => {
    const bothPrimary = focusFilter('both-primary-filter', 'Both Primary', {
      selectedRepoIds: ['tools', 'platform'],
      selectedFocusIds: [],
      repositoryTypes: { tools: 'primary', platform: 'primary' },
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: undefined,
      selectedSupportTargets: [],
    });
    const toolsSupport = focusFilter('tools-support-filter', 'Tools Support', {
      selectedRepoIds: ['tools', 'platform'],
      selectedFocusIds: [],
      repositoryTypes: { tools: 'support', platform: 'primary' },
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: undefined,
      selectedSupportTargets: [],
    });
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue(createListResponse([
        {
          ...ordersEstatePack,
          primaryWorkingRepoIds: ['tools', 'platform'],
          focusTargets: [
            {
              ...ordersEstatePack.focusTargets[0]!,
              focusId: 'tools',
              displayName: 'Tools',
              repoId: 'tools',
              repositoryType: 'primary',
            },
            {
              ...ordersEstatePack.focusTargets[1]!,
              focusId: 'platform',
              displayName: 'Platform',
              repoId: 'platform',
              repositoryType: 'primary',
            },
          ],
        },
      ], '/tmp/context-packs/orders-estate')),
      listFocusFilters: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'focusFilters.list',
          mode: 'read-only',
          filters: [bothPrimary, toolsSupport],
          message: '2 focus filters.',
        },
      }),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('focus-filter-names')).toHaveTextContent('Both Primary,Tools Support');
    });
    expect(screen.getByTestId('repository-types')).toHaveTextContent('tools:primary,platform:primary');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply tools support filter' }));
    });

    expect(screen.getByTestId('selected-repo-ids')).toHaveTextContent('tools,platform');
    expect(screen.getByTestId('repository-types')).toHaveTextContent('tools:support,platform:primary');
    expect(client.setRepositoryType).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      'tools',
      'support',
    );
    expect(client.setRepositoryType).toHaveBeenCalledTimes(1);
  });

  it('rejects saved regular focus filters with malformed repository roles', async () => {
    const malformed = focusFilter('tools-support-filter', 'Malformed', {
      selectedRepoIds: ['tools', 'platform'],
      selectedFocusIds: [],
      repositoryTypes: { tools: 'owner', platform: 'primary' },
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: undefined,
      selectedSupportTargets: [],
    } as unknown as ContextPackFocusFilter['selection']);
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue(createListResponse([
        {
          ...ordersEstatePack,
          primaryWorkingRepoIds: ['tools', 'platform'],
          focusTargets: [
            {
              ...ordersEstatePack.focusTargets[0]!,
              focusId: 'tools',
              displayName: 'Tools',
              repoId: 'tools',
              repositoryType: 'primary',
            },
            {
              ...ordersEstatePack.focusTargets[1]!,
              focusId: 'platform',
              displayName: 'Platform',
              repoId: 'platform',
              repositoryType: 'primary',
            },
          ],
        },
      ], '/tmp/context-packs/orders-estate')),
      listFocusFilters: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'focusFilters.list',
          mode: 'read-only',
          filters: [malformed],
          message: '1 focus filter.',
        },
      }),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('focus-filter-names')).toHaveTextContent('Malformed');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply tools support filter' }));
    });

    expect(screen.getByTestId('error')).toHaveTextContent(
      'This focus filter contains an invalid repository role.',
    );
    expect(screen.getByTestId('repository-types')).toHaveTextContent('tools:primary,platform:primary');
    expect(client.setRepositoryType).not.toHaveBeenCalled();
  });

  it('captures selected repository primary/support roles when creating a focus filter', async () => {
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue(createListResponse([
        {
          ...ordersEstatePack,
          primaryWorkingRepoIds: ['tools', 'platform'],
          focusTargets: [
            {
              ...ordersEstatePack.focusTargets[0]!,
              focusId: 'tools',
              displayName: 'Tools',
              repoId: 'tools',
              repositoryType: 'support',
            },
            {
              ...ordersEstatePack.focusTargets[1]!,
              focusId: 'platform',
              displayName: 'Platform',
              repoId: 'platform',
              repositoryType: 'primary',
            },
          ],
        },
      ], '/tmp/context-packs/orders-estate')),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-repo-ids')).toHaveTextContent('tools');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select platform focus' }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('selected-repo-ids')).toHaveTextContent('tools,platform');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create focus filter' }));
    });

    expect(client.createFocusFilter).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      'Saved filter',
      expect.objectContaining({
        selectedRepoIds: ['tools', 'platform'],
        repositoryTypes: { tools: 'support', platform: 'primary' },
      }),
    );
  });

  it('applies saved Deep Focus filters with primary, test, and support slots', async () => {
    const deepFocus = focusFilter('deep-focus-filter', 'Deep Focus', {
      selectedRepoIds: [],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'tools',
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: 'services/tools',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{
        path: 'services/tools',
        kind: 'directory',
        repoLocalPath: '/repos/tools',
        repoId: 'tools',
        role: 'anchor',
        testTarget: { path: 'tests/tools', kind: 'directory' },
        supportTargets: [{ path: 'docs/tools', kind: 'directory' }],
      }],
      selectedTestTarget: { path: 'tests/shared', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/shared', kind: 'directory' }],
    });
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue(createListResponse([
        {
          ...ordersEstatePack,
          primaryWorkingRepoIds: ['tools'],
          focusTargets: [{
            ...ordersEstatePack.focusTargets[0]!,
            focusId: 'tools',
            displayName: 'Tools',
            repoId: 'tools',
            repoLocalPath: '/repos/tools',
          }],
        },
      ], '/tmp/context-packs/orders-estate')),
      listFocusFilters: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'focusFilters.list',
          mode: 'read-only',
          filters: [deepFocus],
          message: '1 focus filter.',
        },
      }),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('focus-filter-names')).toHaveTextContent('Deep Focus');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply deep focus filter' }));
    });

    expect(screen.getByTestId('deep-focus-enabled')).toHaveTextContent('true');
    expect(screen.getByTestId('selected-focus-path')).toHaveTextContent('services/tools');
    expect(screen.getByTestId('selected-focus-targets')).toHaveTextContent(
      'tools:anchor:services/tools:docs/tools',
    );
    expect(screen.getByTestId('selected-test-target')).toHaveTextContent('tests/shared:directory');
    expect(screen.getByTestId('selected-support-targets')).toHaveTextContent('docs/shared:directory');
    expect(client.saveDeepFocusSelections).toHaveBeenLastCalledWith(
      '/tmp/context-packs/orders-estate',
      expect.objectContaining({
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'tools',
        selectedFocusPath: 'services/tools',
        selectedTestTarget: { path: 'tests/shared', kind: 'directory' },
        selectedSupportTargets: [{ path: 'docs/shared', kind: 'directory' }],
        selectedFocusTargets: [expect.objectContaining({
          repoId: 'tools',
          testTarget: { path: 'tests/tools', kind: 'directory' },
          supportTargets: [{ path: 'docs/tools', kind: 'directory' }],
        })],
      }),
    );
  });

  it('captures Deep Focus primary, test, and support slots when creating a focus filter', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit deep focus' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create focus filter' }));
    });

    expect(client.createFocusFilter).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      'Saved filter',
      expect.objectContaining({
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'orders-api',
        selectedFocusPath: 'src/features/orders',
        selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
        selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }),
    );
  });

  it('applies monolith standard filters using selected focus ids and focus-area roles', async () => {
    const contextPackDir = '/tmp/context-packs/platform-estate';
    const monolithPack: ContextPackCatalogEntry = {
      ...ordersEstatePack,
      contextPackId: 'platform-estate',
      displayName: 'Platform Estate',
      contextPackDir,
      manifestPath: `${contextPackDir}/qmd/repo-sources.json`,
      estateType: 'monolith',
      primaryWorkingRepoIds: ['services-identity'],
      focusTargets: [
        {
          ...ordersEstatePack.focusTargets[0]!,
          focusId: 'services-identity',
          displayName: 'Identity',
          kind: 'focus-area',
          repoId: null,
          relativePath: 'services/identity',
          repositoryType: 'primary',
        },
        {
          ...ordersEstatePack.focusTargets[1]!,
          focusId: 'docs-platform',
          displayName: 'Docs',
          kind: 'focus-area',
          repoId: null,
          relativePath: 'docs/platform',
          repositoryType: 'primary',
        },
      ],
    };
    const docsSupport = focusFilter('tools-support-filter', 'Docs Support', {
      selectedRepoIds: [],
      selectedFocusIds: ['services-identity', 'docs-platform'],
      repositoryTypes: { 'services-identity': 'primary', 'docs-platform': 'support' },
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: undefined,
      selectedSupportTargets: [],
    }, contextPackDir);
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue(createListResponse([monolithPack], contextPackDir)),
      listFocusFilters: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'focusFilters.list',
          mode: 'read-only',
          filters: [docsSupport],
          message: '1 focus filter.',
        },
      }),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('focus-filter-names')).toHaveTextContent('Docs Support');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply tools support filter' }));
    });

    expect(screen.getByTestId('selected-repo-ids')).toHaveTextContent('none');
    expect(screen.getByTestId('selected-focus-ids')).toHaveTextContent('services-identity,docs-platform');
    expect(screen.getByTestId('repository-types')).toHaveTextContent('services-identity:primary,docs-platform:support');
    expect(client.setRepositoryType).toHaveBeenCalledWith(contextPackDir, 'docs-platform', 'support');
  });

  it('applies monolith Deep Focus filters using primary focus id plus test and support slots', async () => {
    const contextPackDir = '/tmp/context-packs/platform-estate';
    const monolithPack: ContextPackCatalogEntry = {
      ...ordersEstatePack,
      contextPackId: 'platform-estate',
      displayName: 'Platform Estate',
      contextPackDir,
      manifestPath: `${contextPackDir}/qmd/repo-sources.json`,
      estateType: 'monolith',
      primaryWorkingRepoIds: ['services-identity'],
      focusTargets: [{
        ...ordersEstatePack.focusTargets[0]!,
        focusId: 'services-identity',
        displayName: 'Identity',
        kind: 'focus-area',
        repoId: null,
        repoLocalPath: '/repos/platform',
        relativePath: 'services/identity',
      }],
    };
    const deepFocus = focusFilter('deep-focus-filter', 'Monolith Deep Focus', {
      selectedRepoIds: [],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: 'services-identity',
      selectedFocusPath: 'services/identity',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{
        path: 'services/identity',
        kind: 'directory',
        repoLocalPath: '/repos/platform',
        focusId: 'services-identity',
        role: 'anchor',
      }],
      selectedTestTarget: { path: 'tests/identity', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/identity', kind: 'directory' }],
    }, contextPackDir);
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue(createListResponse([monolithPack], contextPackDir)),
      listFocusFilters: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'focusFilters.list',
          mode: 'read-only',
          filters: [deepFocus],
          message: '1 focus filter.',
        },
      }),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('focus-filter-names')).toHaveTextContent('Monolith Deep Focus');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply deep focus filter' }));
    });

    expect(screen.getByTestId('deep-focus-enabled')).toHaveTextContent('true');
    expect(screen.getByTestId('selected-focus-ids')).toHaveTextContent('services-identity');
    expect(screen.getByTestId('selected-focus-targets')).toHaveTextContent(
      'services-identity:anchor:services/identity:',
    );
    expect(screen.getByTestId('selected-test-target')).toHaveTextContent('tests/identity:directory');
    expect(screen.getByTestId('selected-support-targets')).toHaveTextContent('docs/identity:directory');
    expect(client.saveDeepFocusSelections).toHaveBeenLastCalledWith(
      contextPackDir,
      expect.objectContaining({
        deepFocusPrimaryRepoId: null,
        deepFocusPrimaryFocusId: 'services-identity',
        selectedFocusTargets: [expect.objectContaining({ focusId: 'services-identity' })],
        selectedTestTarget: { path: 'tests/identity', kind: 'directory' },
        selectedSupportTargets: [{ path: 'docs/identity', kind: 'directory' }],
      }),
    );
  });

  it('commits and clears deep focus selections locally', async () => {
    render(<ContextPackSelectionHarness client={createClient()} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit deep focus' }));
    });

    expect(screen.getByTestId('deep-focus-enabled')).toHaveTextContent('true');
    expect(screen.getByTestId('selected-focus-path')).toHaveTextContent('src/features/orders');
    expect(screen.getByTestId('selected-test-target')).toHaveTextContent('tests/orders:directory');
    expect(screen.getByTestId('selected-support-targets')).toHaveTextContent('docs/orders.md:file');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear deep focus' }));
    });

    expect(screen.getByTestId('deep-focus-enabled')).toHaveTextContent('false');
    expect(screen.getByTestId('selected-focus-path')).toHaveTextContent('none');
    expect(screen.getByTestId('selected-test-target')).toHaveTextContent('unset');
    expect(screen.getByTestId('selected-support-targets')).toHaveTextContent('none');
  });

  it('surfaces and logs deep focus save failures', async () => {
    const client = createClient({
      saveDeepFocusSelections: vi.fn().mockResolvedValue({
        ok: false,
        action: 'deepFocus.saveSelections',
        error: 'Unable to save deep focus selections.',
      }),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit deep focus' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent(
        'Unable to save deep focus selections.',
      );
      expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'deep-focus.selections.save.failed',
        extra: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          reason: 'Unable to save deep focus selections.',
        },
      }));
    });
  });

  it('logs deep focus load failures and falls back to catalog defaults', async () => {
    const client = createClient({
      loadDeepFocusSelections: vi.fn().mockRejectedValue(new Error('Selections file unreadable.')),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
      expect(screen.getByTestId('deep-focus-enabled')).toHaveTextContent('false');
      expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'deep-focus.selections.load.failed',
        extra: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          reason: 'Selections file unreadable.',
        },
      }));
    });
  });

  it('surfaces and logs repository type save rejections', async () => {
    const client = createClient({
      setRepositoryType: vi.fn().mockRejectedValue(new Error('Repository metadata save failed.')),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Toggle repository type' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent(
        'Repository metadata save failed.',
      );
      expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'context-pack.repository-type.save.failed',
        extra: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          repoId: 'orders-api',
          repositoryType: 'support',
          reason: 'Repository metadata save failed.',
        },
      }));
    });
  });

  it('persists explicit no-tests separately from an unset test target', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    expect(screen.getByTestId('selected-test-target')).toHaveTextContent('unset');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit deep focus no tests' }));
    });

    expect(screen.getByTestId('selected-test-target')).toHaveTextContent('none');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(client.previewContextPackSwitch).toHaveBeenLastCalledWith(
        '/tmp/context-packs/orders-estate',
        'focused',
        ['orders-api'],
        [],
        {
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'orders-api',
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: 'src/features/orders',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets: [],
          selectedTestTarget: null,
          selectedSupportTargets: [],
        },
      );
    });
  });

  it('hydrates distributed legacy load with repoLocalPath and repoId', async () => {
    const client = createClient({
      loadDeepFocusSelections: vi.fn().mockResolvedValue(createLoadSelectionsResponse({
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'orders-api',
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: 'src/features/orders',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [
          { path: 'src/features/orders', kind: 'directory', role: 'anchor' },
        ],
        selectedTestTarget: undefined,
        selectedSupportTargets: [],
      })),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('deep-focus-enabled')).toHaveTextContent('true');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(client.previewContextPackSwitch).toHaveBeenLastCalledWith(
        '/tmp/context-packs/orders-estate',
        'focused',
        ['orders-api'],
        [],
        {
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'orders-api',
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: 'src/features/orders',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets: [
            {
              path: 'src/features/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/tmp/context-packs/orders-estate/orders-api',
              repoId: 'orders-api',
              supportTargets: [],
            },
          ],
          selectedTestTarget: undefined,
          selectedSupportTargets: [],
        },
      );
    });
  });

  it('hydrates monolith legacy load with repoLocalPath and focusId', async () => {
    const monolithPack: ContextPackCatalogEntry = {
      contextPackId: 'platform-estate',
      displayName: 'Platform Estate',
      contextPackDir: '/tmp/context-packs/platform-estate',
      manifestPath: '/tmp/context-packs/platform-estate/qmd/repo-sources.json',
      bootstrapReady: true,
      source: 'active-env',
      isActive: true,
      estateType: 'monolith',
      defaultScopeMode: 'focused',
      repoCount: 1,
      primaryWorkingRepoIds: ['services-identity'],
      focusTargets: [
        {
          focusId: 'services-identity',
          displayName: 'Identity',
          kind: 'focus-area',
          repoId: null,
          repoLocalPath: '/tmp/context-packs/platform-estate/platform',
          serviceName: 'Identity',
          systemLayer: 'backend',
          repoRole: null,
          repositoryType: null,
          relativePath: 'services/identity',
          focusType: 'service',
          group: null,
          defaultFocusable: true,
          activationPriority: 10,
          adjacentRepoIds: [],
          adjacentFocusIds: [],
        },
      ],
    };
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue(
        createListResponse([monolithPack], monolithPack.contextPackDir),
      ),
      loadDeepFocusSelections: vi.fn().mockResolvedValue(createLoadSelectionsResponse({
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: null,
        deepFocusPrimaryFocusId: 'services-identity',
        selectedFocusPath: 'services/identity',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [
          { path: 'services/identity', kind: 'directory', role: 'anchor' },
        ],
        selectedTestTarget: undefined,
        selectedSupportTargets: [],
      })),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('deep-focus-enabled')).toHaveTextContent('true');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(client.previewContextPackSwitch).toHaveBeenLastCalledWith(
        monolithPack.contextPackDir,
        'focused',
        [],
        ['services-identity'],
        {
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: null,
          deepFocusPrimaryFocusId: 'services-identity',
          selectedFocusPath: 'services/identity',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets: [
            {
              path: 'services/identity',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/tmp/context-packs/platform-estate/platform',
              focusId: 'services-identity',
              supportTargets: [],
            },
          ],
          selectedTestTarget: undefined,
          selectedSupportTargets: [],
        },
      );
    });
  });

  it('drops malformed legacy load and warns', async () => {
    const client = createClient({
      loadDeepFocusSelections: vi.fn().mockResolvedValue(createLoadSelectionsResponse({
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'missing-repo',
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: 'src/features/orders',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [
          { path: 'src/features/orders', kind: 'directory', role: 'anchor' },
        ],
        selectedTestTarget: undefined,
        selectedSupportTargets: [],
      })),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'deep-focus.legacy-primaries.discarded',
        extra: {
          reason: 'repo id missing-repo did not resolve to a catalog focus target',
        },
      }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(client.previewContextPackSwitch).toHaveBeenLastCalledWith(
        '/tmp/context-packs/orders-estate',
        'focused',
        ['orders-api'],
        [],
        {
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: null,
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: 'src/features/orders',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets: [],
          selectedTestTarget: undefined,
          selectedSupportTargets: [],
        },
      );
    });
  });

  it('drops malformed catalog events and warns', async () => {
    let catalogHandler: ((event: unknown) => void) | undefined;
    const client = createClient({
      subscribeContextPackCatalogChanged: vi.fn((handler) => {
        catalogHandler = handler;
        return vi.fn();
      }),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(catalogHandler).toBeDefined();
    });

    const event = { malformed: true };
    act(() => {
      catalogHandler?.(event);
    });

    await waitFor(() => {
      expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'context-pack.catalog-event.malformed',
        extra: { event },
      }));
    });
  });

  it('preserves already-new loaded deep focus state', async () => {
    const client = createClient({
      loadDeepFocusSelections: vi.fn().mockResolvedValue(createLoadSelectionsResponse({
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'orders-api',
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: 'src/features/orders',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [
          {
            path: 'src/features/orders',
            kind: 'directory',
            role: 'anchor',
            repoLocalPath: '/tmp/context-packs/orders-estate/orders-api',
            repoId: 'orders-api',
            testTarget: { path: 'tests/orders', kind: 'directory' },
            supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
          },
        ],
        selectedTestTarget: { path: 'tests/orders-global', kind: 'directory' },
        selectedSupportTargets: [{ path: 'docs/global.md', kind: 'file' }],
      })),
    });
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('deep-focus-enabled')).toHaveTextContent('true');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(client.previewContextPackSwitch).toHaveBeenLastCalledWith(
        '/tmp/context-packs/orders-estate',
        'focused',
        ['orders-api'],
        [],
        {
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'orders-api',
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: 'src/features/orders',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets: [
            {
              path: 'src/features/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/tmp/context-packs/orders-estate/orders-api',
              repoId: 'orders-api',
              testTarget: { path: 'tests/orders', kind: 'directory' },
              supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
            },
          ],
          selectedTestTarget: { path: 'tests/orders-global', kind: 'directory' },
          selectedSupportTargets: [{ path: 'docs/global.md', kind: 'file' }],
        },
      );
    });
  });
});
