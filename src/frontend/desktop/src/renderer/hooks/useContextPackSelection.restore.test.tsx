// @vitest-environment jsdom
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
  vi,
  waitFor,
} from './useContextPackSelection.testSetup';

describe('useContextPackSelection', () => {
  it('prefers last applied selection for restore-ready entries', async () => {
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'contextPack.list',
          mode: 'read-only',
          message: 'Discovered 1 context pack(s) from approved local sources.',
          activeContextPackDir: '/tmp/context-packs/orders-estate',
          configuredPaths: [],
          searchRoots: [],
          recentContextPackDirs: ['/tmp/context-packs/orders-estate'],
          contextPacks: [
            {
              contextPackId: 'orders-estate',
              displayName: 'Orders Estate',
              contextPackDir: '/tmp/context-packs/orders-estate',
              manifestPath: '/tmp/context-packs/orders-estate/qmd/repo-sources.json',
              bootstrapReady: true,
              source: 'recent-state',
              isActive: true,
              estateType: 'distributed-platform',
              defaultScopeMode: 'focused',
              status: 'active-dirty-workspace',
              statusMessage:
                'Managed workspace folders drifted from the last successful sync. Reconcile before continuing.',
              driftDetected: true,
              restoreAvailable: true,
              lastSyncedAt: '2026-03-08T12:00:00Z',
              lastAppliedScopeMode: 'focused',
              lastAppliedSelectedRepoIds: ['orders-web'],
              lastAppliedSelectedFocusIds: [],
              lastAppliedDeepFocusEnabled: true,
              lastAppliedSelectedFocusPath: 'src/orders',
              lastAppliedSelectedFocusTargetKind: 'directory',
              lastAppliedSelectedTestTarget: {
                path: 'tests/orders',
                kind: 'directory',
              },
              lastAppliedSelectedSupportTargets: [
                { path: 'docs/orders.md', kind: 'file' },
              ],
              repoCount: 2,
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
                  adjacentRepoIds: ['orders-web'],
                  adjacentFocusIds: [],
                },
                {
                  focusId: 'orders-web',
                  displayName: 'Orders Web',
                  kind: 'repository',
                  repoId: 'orders-web',
                  serviceName: 'Orders Web',
                  systemLayer: 'frontend',
                  repoRole: 'frontend',
                  repositoryType: null,
                  relativePath: null,
                  focusType: null,
                  group: null,
                  defaultFocusable: false,
                  activationPriority: 5,
                  adjacentRepoIds: ['orders-api'],
                  adjacentFocusIds: [],
                },
              ],
            },
          ],
        },
      }),
    });

    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-repo-ids').textContent).toContain(
        'orders-web',
      );
    });
    expect(screen.getByTestId('deep-focus-enabled').textContent).toContain('true');
    expect(screen.getByTestId('selected-focus-path').textContent).toContain('src/orders');
    expect(screen.getByTestId('selected-focus-target-kind').textContent).toContain('directory');
    expect(screen.getByTestId('selected-test-target').textContent).toContain(
      'tests/orders:directory',
    );
    expect(screen.getByTestId('selected-support-targets').textContent).toContain(
      'docs/orders.md:file',
    );
  });

  it('clears active state and refreshes the catalog after success', async () => {
    const client = createClient({
      listContextPacks: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          response: {
            action: 'contextPack.list',
            mode: 'read-only',
            message: 'Discovered 1 context pack(s) from approved local sources.',
            activeContextPackDir: '/tmp/context-packs/orders-estate',
            configuredPaths: [],
            searchRoots: [],
            recentContextPackDirs: ['/tmp/context-packs/orders-estate'],
            contextPacks: [
              {
                contextPackId: 'orders-estate',
                displayName: 'Orders Estate',
                contextPackDir: '/tmp/context-packs/orders-estate',
                manifestPath:
                  '/tmp/context-packs/orders-estate/qmd/repo-sources.json',
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
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          response: {
            action: 'contextPack.list',
            mode: 'read-only',
            message: 'Discovered 1 context pack(s) from approved local sources.',
            activeContextPackDir: null,
            configuredPaths: [],
            searchRoots: [],
            recentContextPackDirs: [],
            contextPacks: [
              {
                contextPackId: 'orders-estate',
                displayName: 'Orders Estate',
                contextPackDir: '/tmp/context-packs/orders-estate',
                manifestPath:
                  '/tmp/context-packs/orders-estate/qmd/repo-sources.json',
                bootstrapReady: true,
                source: 'recent-state',
                isActive: false,
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
              },
            ],
          },
        }),
    });

    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('active-pack').textContent).toContain(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run clear' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('active-pack').textContent).toContain('none');
    });
    expect(screen.getByTestId('message').textContent).toContain(
      'Active context-pack workspace state cleared through the approved wrapper seam.',
    );
  });
});
