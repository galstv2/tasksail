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
  it('keeps a newly created pack selectable when catalog discovery is stale', async () => {
    const staleCatalogResponse = {
      ok: true,
      response: {
        action: 'contextPack.list' as const,
        mode: 'read-only' as const,
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
            source: 'active-env' as const,
            isActive: true,
            estateType: 'distributed-platform',
            defaultScopeMode: 'focused' as const,
            repoCount: 1,
            primaryWorkingRepoIds: ['orders-api'],
            focusTargets: [
              {
                focusId: 'orders-api',
                displayName: 'Orders API',
                kind: 'repository' as const,
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
    };

    const client = createClient({
      listContextPacks: vi
        .fn()
        .mockResolvedValueOnce(staleCatalogResponse)
        .mockResolvedValueOnce(staleCatalogResponse)
        .mockResolvedValue(staleCatalogResponse),
      pickContextPackDirectory: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          response: {
            action: 'contextPack.pickDirectory',
            mode: 'selected',
            message: 'Selected discovery root.',
            purpose: 'discovery-root',
            selectedPath: '/tmp/payments-root',
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          response: {
            action: 'contextPack.pickDirectory',
            mode: 'selected',
            message: 'Selected destination.',
            purpose: 'context-pack-destination',
            selectedPath: '/tmp/context-packs/payments-estate',
          },
        }),
      discoverContextPackPrefill: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'contextPack.discoverPrefill',
          mode: 'discovered',
          message: 'Discovery loaded payments suggestions.',
          rootPath: '/tmp/payments-root',
          discoveryMode: 'distributed',
          estateType: 'distributed',
          suggestedContextPackId: 'payments-estate',
          suggestedDisplayName: 'Payments Estate',
          warnings: [],
          candidateRepos: [
            {
              repoId: 'payments-api',
              repoName: 'payments-api',
              path: '/tmp/payments-root/payments-api',
              highSignalPaths: ['src'],
            },
          ],
          candidateFocusAreas: [],
          highSignalPaths: ['src'],
        },
      }),
      createContextPack: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'contextPack.create',
          mode: 'created',
          message: 'Created payments estate.',
          commandPath: 'scripts/python/bootstrap-context-pack.py',
          result: {
            contextPackId: 'payments-estate',
            displayName: 'Payments Estate',
            contextPackDir: '/tmp/context-packs/payments-estate',
            discoveryRoot: '/tmp/payments-root',
            discoveryMode: 'distributed',
            estateType: 'distributed-platform',
            defaultScopeMode: 'focused',
            bootstrapAnswersPath:
              '/tmp/context-packs/payments-estate/qmd/bootstrap/bootstrap-answers.json',
            discoveryDraftPath:
              '/tmp/context-packs/payments-estate/qmd/bootstrap/discovery-structure.json',
            manifestPath:
              '/tmp/context-packs/payments-estate/qmd/repo-sources.json',
            planPath:
              '/tmp/context-packs/payments-estate/qmd/bootstrap/seed-plan.json',
            repositoryCount: 1,
            focusTargetCount: 1,
            primaryWorkingRepoIds: ['payments-api'],
            primaryFocusAreaIds: [],
            seedStatus: 'success',
            warnings: [],
          },
        },
      }),
      applyContextPackSwitch: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'contextPack.applySwitch',
          mode: 'applied',
          message: 'Applied payments estate.',
          commandPath: 'src/backend/platform/context-pack/switch.ts',
          result: {
            ok: true,
            wrapperAction: 'apply',
            stage: 'complete',
            status: 'success',
            activation: {
              performed: true,
              exitCode: 0,
              output: 'ok',
            },
            envStateCleared: false,
            error: null,
            contextPackId: 'payments-estate',
            contextPackDir: '/tmp/context-packs/payments-estate',
            workspaceFile: '/repo/tasksail.code-workspace',
            stateFile: '/repo/.platform-state/workspace-context-sync.json',
            scopeMode: 'focused',
            selectedRepoIds: [],
            selectedFocusIds: [],
            warnings: [],
            foldersToAdd: ['/tmp/context-packs/payments-estate'],
            foldersToRemove: [],
            managedFolders: ['/tmp/context-packs/payments-estate'],
            targetFolders: ['/tmp/context-packs/payments-estate'],
            lastSyncedAt: null,
          },
        },
      }),
    });

    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open create modal' }));
    });

    expect(screen.getByTestId('create-modal-open')).toHaveTextContent('open');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Browse discovery root' }));
      fireEvent.click(screen.getByRole('button', { name: 'Browse destination' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('create-modal-discovery-root')).toHaveTextContent(
        '/tmp/payments-root',
      );
      expect(screen.getByTestId('create-modal-pack-dir')).toHaveTextContent(
        '/tmp/context-packs/payments-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run discovery prefill' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('create-modal-step')).toHaveTextContent('shape');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create next' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('create-modal-step')).toHaveTextContent('review');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run create pack' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/payments-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run apply' }));
    });

    await waitFor(() => {
      expect(client.applyContextPackSwitch).toHaveBeenCalledWith(
        '/tmp/context-packs/payments-estate',
        'focused',
        [],
        [],
      );
    });
  });
});
