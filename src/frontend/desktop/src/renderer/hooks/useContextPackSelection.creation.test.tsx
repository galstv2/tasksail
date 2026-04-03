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
  it('creates a context pack, refreshes the catalog, and selects the new pack', async () => {
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
            message: 'Discovered 2 context pack(s) from approved local sources.',
            activeContextPackDir: '/tmp/context-packs/orders-estate',
            configuredPaths: [],
            searchRoots: [],
            recentContextPackDirs: [
              '/tmp/context-packs/orders-estate',
              '/tmp/context-packs/payments-estate',
            ],
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
              {
                contextPackId: 'payments-estate',
                displayName: 'Payments Estate',
                contextPackDir: '/tmp/context-packs/payments-estate',
                manifestPath:
                  '/tmp/context-packs/payments-estate/qmd/repo-sources.json',
                bootstrapReady: true,
                source: 'search-root',
                isActive: false,
                estateType: 'distributed-platform',
                defaultScopeMode: 'focused',
                repoCount: 1,
                primaryWorkingRepoIds: ['payments-api'],
                focusTargets: [
                  {
                    focusId: 'payments-api',
                    displayName: 'Payments API',
                    kind: 'repository',
                    repoId: 'payments-api',
                    serviceName: 'Payments API',
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
    expect(screen.getByTestId('message')).toHaveTextContent('Created payments estate.');
    expect(screen.getByTestId('create-modal-open')).toHaveTextContent('closed');
    expect(client.createContextPack).toHaveBeenCalledWith(
      expect.objectContaining({
        contextPackDir: '/tmp/context-packs/payments-estate',
        discoveryRoot: '/tmp/payments-root',
        mode: 'distributed',
        bootstrapAnswers: expect.objectContaining({
          contextPackId: 'payments-estate',
          estateName: 'Payments Estate',
          primaryWorkingRepoIds: ['payments-api'],
        }),
      }),
    );
  });
});
