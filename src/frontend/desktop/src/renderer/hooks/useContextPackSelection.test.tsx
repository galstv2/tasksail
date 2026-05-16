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
} from './useContextPackSelection.testSetup';
import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusState,
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
