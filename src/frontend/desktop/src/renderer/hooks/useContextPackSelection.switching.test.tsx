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
  it('supports monolith focus selection without repo-level workspace switching', async () => {
    const client = createClient({
      listContextPacks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'contextPack.list',
          mode: 'read-only',
          message: 'Discovered 1 context pack(s) from approved local sources.',
          activeContextPackDir: '/tmp/context-packs/mono-pack',
          configuredPaths: [],
          searchRoots: [],
          recentContextPackDirs: ['/tmp/context-packs/mono-pack'],
          contextPacks: [
            {
              contextPackId: 'mono-pack',
              displayName: 'Mono Pack',
              contextPackDir: '/tmp/context-packs/mono-pack',
              manifestPath: '/tmp/context-packs/mono-pack/qmd/repo-sources.json',
              bootstrapReady: true,
              source: 'active-env',
              isActive: true,
              estateType: 'monolith',
              defaultScopeMode: 'focused',
              repoCount: 1,
              primaryWorkingRepoIds: ['services-billing'],
              focusTargets: [
                {
                  focusId: 'services-billing',
                  displayName: 'Billing Service',
                  kind: 'focus-area',
                  repoId: null,
                  serviceName: null,
                  systemLayer: null,
                  repoRole: null,
                  repositoryType: null,
                  relativePath: 'services/billing',
                  focusType: 'service',
                  group: 'services',
                  defaultFocusable: true,
                  activationPriority: 10,
                  adjacentRepoIds: [],
                  adjacentFocusIds: ['services-identity'],
                },
                {
                  focusId: 'services-identity',
                  displayName: 'Identity Service',
                  kind: 'focus-area',
                  repoId: null,
                  serviceName: null,
                  systemLayer: null,
                  repoRole: null,
                  repositoryType: null,
                  relativePath: 'services/identity',
                  focusType: 'service',
                  group: 'services',
                  defaultFocusable: false,
                  activationPriority: 5,
                  adjacentRepoIds: [],
                  adjacentFocusIds: ['services-billing'],
                },
              ],
            },
          ],
        },
      }),
    });

    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/mono-pack',
      );
    });
    expect(screen.getByTestId('selected-repo-ids')).toHaveTextContent('none');
    expect(screen.getByTestId('selected-focus-ids')).toHaveTextContent(
      'services-billing',
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select identity focus' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-focus-ids')).toHaveTextContent(
        'services-billing,services-identity',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(client.previewContextPackSwitch).toHaveBeenCalledWith(
        '/tmp/context-packs/mono-pack',
        'focused',
        [],
        ['services-billing', 'services-identity'],
        {
          deepFocusEnabled: false,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedTestTarget: undefined,
          selectedSupportTargets: [],
        },
      );
    });
  });

  it('supports distributed multi-select focus before previewing', async () => {
    const client = createClient();
    render(<ContextPackSelectionHarness client={client} />);

    await waitFor(() => {
      expect(screen.getByTestId('selected-pack')).toHaveTextContent(
        '/tmp/context-packs/orders-estate',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select orders web focus' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-repo-ids')).toHaveTextContent(
        'orders-api,orders-web',
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    });

    await waitFor(() => {
      expect(client.previewContextPackSwitch).toHaveBeenCalledWith(
        '/tmp/context-packs/orders-estate',
        'focused',
        ['orders-api', 'orders-web'],
        [],
        {
          deepFocusEnabled: false,
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedTestTarget: undefined,
          selectedSupportTargets: [],
        },
      );
    });
  });
});
