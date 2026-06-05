import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { installAppTestHarness } from './App.test-setup';

installAppTestHarness();

async function renderApp() {
  const { default: App } = await import('./App');
  return render(<App />);
}

describe("App", () => {
  it('opens the context-pack creation modal and completes discovery-backed creation', async () => {
    window.desktopShell.listContextPacks = vi
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
            },
          ],
        },
      })
      .mockResolvedValue({
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
            '/tmp/context-packs/catalog-estate',
          ],
          contextPacks: [
            {
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
            },
            {
              contextPackId: 'catalog-estate',
              displayName: 'Catalog Estate',
              contextPackDir: '/tmp/context-packs/catalog-estate',
              manifestPath: '/tmp/context-packs/catalog-estate/qmd/repo-sources.json',
              bootstrapReady: true,
              source: 'search-root',
              isActive: false,
              estateType: 'distributed-platform',
              defaultScopeMode: 'focused',
              repoCount: 1,
              primaryWorkingRepoIds: ['catalog-api'],
              focusTargets: [
                {
                  focusId: 'catalog-api',
                  displayName: 'Catalog API',
                  kind: 'repository',
                  repoId: 'catalog-api',
                  serviceName: 'Catalog API',
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
      });
    window.desktopShell.pickContextPackDirectory = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'contextPack.pickDirectory',
          mode: 'selected',
          message: 'Selected.',
          purpose: 'context-pack-destination',
          selectedPath: '/tmp/context-packs/catalog-estate',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'contextPack.pickDirectory',
          mode: 'selected',
          message: 'Selected.',
          purpose: 'discovery-root',
          selectedPath: '/tmp/catalog-root',
        },
      });
    window.desktopShell.discoverContextPackPrefill = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'contextPack.discoverPrefill',
        mode: 'discovered',
        message: 'Discovery loaded catalog suggestions.',
        rootPath: '/tmp/catalog-root',
        discoveryMode: 'distributed',
        estateType: 'distributed',
        suggestedContextPackId: 'catalog-estate',
        suggestedDisplayName: 'Catalog Estate',
        warnings: [],
        candidateRepos: [
          {
            repoId: 'catalog-api',
            repoName: 'catalog-api',
            path: '/tmp/catalog-root/catalog-api',
            highSignalPaths: ['src'],
            repositoryType: 'primary',
          },
        ],
        candidateFocusAreas: [],
        highSignalPaths: ['src'],
      },
    });
    window.desktopShell.createContextPack = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'contextPack.create',
        mode: 'created',
        message: 'Created catalog estate.',
        commandPath: 'scripts/python/bootstrap-context-pack.py',
        result: {
          contextPackId: 'catalog-estate',
          displayName: 'Catalog Estate',
          contextPackDir: '/tmp/context-packs/catalog-estate',
          discoveryRoot: '/tmp/catalog-root',
          discoveryMode: 'distributed',
          estateType: 'distributed-platform',
          defaultScopeMode: 'focused',
          bootstrapAnswersPath:
            '/tmp/context-packs/catalog-estate/qmd/bootstrap/bootstrap-answers.json',
          discoveryDraftPath:
            '/tmp/context-packs/catalog-estate/qmd/bootstrap/discovery-structure.json',
          manifestPath: '/tmp/context-packs/catalog-estate/qmd/repo-sources.json',
          planPath: '/tmp/context-packs/catalog-estate/qmd/bootstrap/seed-plan.json',
          repositoryCount: 1,
          focusTargetCount: 1,
          primaryWorkingRepoIds: ['catalog-api'],
          primaryFocusAreaIds: [],
          seedStatus: 'success',
          warnings: [],
        },
      },
    });

    await renderApp();

    await waitFor(() => {
      expect(screen.getByLabelText('Select context pack')).toHaveTextContent('Orders Estate');
    });

    const sidebar = screen.getByLabelText('Context pack sidebar');
    await waitFor(() => {
      expect(
        within(sidebar).getByRole('button', { name: 'Create Context Pack' }),
      ).toBeEnabled();
    });

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Create Context Pack' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Create Context Pack' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Discovery root'), {
      target: { value: '/tmp/catalog-root' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Scan for/ }));

    await waitFor(() => {
      expect(screen.getByText('Repository estate definition')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('Pack summary')).toBeInTheDocument();
    });

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Create Context Pack' })).getByRole(
        'button',
        { name: 'Create Context Pack' },
      ),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Create Context Pack' }),
      ).not.toBeInTheDocument();
    });
    expect(window.desktopShell.createContextPack).toHaveBeenCalledWith(
      expect.objectContaining({
        discoveryRoot: '/tmp/catalog-root',
        mode: 'distributed',
      }),
    );
    expect(window.desktopShell.listContextPacks).toHaveBeenCalledTimes(3);
    const packSelect = screen.getByLabelText('Select context pack') as HTMLSelectElement;
    expect(packSelect).toBeInTheDocument();
    expect(screen.getByText('Created catalog estate.')).toBeInTheDocument();
  });

  it('shows preview results and wrapper warnings as toast notifications', async () => {
    await renderApp();

    await waitFor(() => {
      expect(
        screen.getByLabelText('Select context pack'),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview pack' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Preview pack' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Context-pack workspace preview completed through the approved wrapper seam.',
        ),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/orders-web is missing on disk/)).toBeInTheDocument();
    expect(window.desktopShell.previewContextPackSwitch).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api'],
      [],
      {},
    );
  });

  it('surfaces apply failures and clears active state through the sidebar', async () => {
    const activePackResponse = {
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
    };
    window.desktopShell.listContextPacks = vi
      .fn()
      .mockResolvedValueOnce(activePackResponse)
      .mockResolvedValueOnce(activePackResponse)
      .mockResolvedValueOnce(activePackResponse)
      .mockResolvedValue({
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
      });

    await renderApp();

    await waitFor(() => {
      expect(
        screen.getByLabelText('Select context pack'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply pack' }));
    await waitFor(() => {
      expect(screen.getByTestId('context-pack-message')).toHaveTextContent(
        'Context-pack workspace action failed.',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear pack' }));
    await waitFor(() => {
      expect(screen.getByTestId('context-pack-message')).toHaveTextContent(
        'Active context-pack workspace state cleared through the approved wrapper seam.',
      );
    });
    expect(screen.getByTestId('context-pack-active-state')).toHaveTextContent(
      'No active context pack is currently applied.',
    );
  });

  it('renders 3-column shell layout with sidebar, main, and a stacked config rail', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByLabelText('Open MCP configuration')).toBeTruthy();
      expect(screen.getByLabelText('Open agent configuration')).toBeTruthy();
    });

    const shellBody = document.querySelector('.shell__body');
    expect(shellBody).toBeTruthy();
    expect(shellBody!.children.length).toBe(3);

    const rail = screen.getByLabelText('Configuration rail');
    expect(rail).toBeTruthy();
    expect(rail.classList.contains('config-rail')).toBe(true);
    // System Settings gear + MCP + Agent Configuration + Instructions.
    expect(rail.querySelectorAll('button')).toHaveLength(4);
  });

  it('CSS enforces fixed 40px rail width', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const stylesDir = join(__dirname, 'styles');
    const agentConfigCss = await readFile(join(stylesDir, 'agentConfig.css'), 'utf-8');

    expect(agentConfigCss).toMatch(/\.config-rail\s*\{[^}]*width:\s*40px/);
  });

  it('MCP modal opens from rail and shows empty state', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByLabelText('Open MCP configuration')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Open MCP configuration'));

    await waitFor(() => {
      expect(screen.getByText('External MCP Servers')).toBeTruthy();
    });
    expect(screen.getByText('No external MCP servers configured.')).toBeTruthy();
  });

  it('agent configuration modal opens, saves assignments, and shows Lily restart notice', async () => {
    const desktopShell = window.desktopShell as typeof window.desktopShell & Record<string, ReturnType<typeof vi.fn>>;

    desktopShell.loadAgentConfig = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'agentConfig.loadAgents',
          mode: 'read-only',
          message: '',
          agents: [
            {
              agent_id: 'provider-planner',
              human_name: 'Lily',
              role_name: 'Planning Specialist',
              required_model: 'gpt-4.1',
              workflow_order: 0,
            },
            {
              agent_id: 'provider-pm',
              human_name: 'Alice',
              role_name: 'Product Manager',
              required_model: 'gpt-5.4',
              workflow_order: 1,
            },
            {
              agent_id: 'provider-builder',
              human_name: 'Dalton',
              role_name: 'Software Engineer',
              required_model: 'claude-sonnet-4.6',
              workflow_order: 2,
            },
            {
              agent_id: 'provider-qa',
              human_name: 'Ron',
              role_name: 'QA and Closeout',
              required_model: 'gpt-5.4',
              workflow_order: 3,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'agentConfig.loadAgents',
          mode: 'read-only',
          message: '',
          agents: [
            {
              agent_id: 'provider-planner',
              human_name: 'Lily',
              role_name: 'Planning Specialist',
              required_model: 'gpt-4.1',
              workflow_order: 0,
            },
            {
              agent_id: 'provider-pm',
              human_name: 'Alice',
              role_name: 'Product Manager',
              required_model: 'gpt-5.4',
              workflow_order: 1,
            },
            {
              agent_id: 'provider-builder',
              human_name: 'Dalton',
              role_name: 'Software Engineer',
              required_model: 'claude-sonnet-4.6',
              workflow_order: 2,
            },
            {
              agent_id: 'provider-qa',
              human_name: 'Ron',
              role_name: 'QA and Closeout',
              required_model: 'gpt-5.4',
              workflow_order: 3,
            },
          ],
        },
      });
    desktopShell.loadModelCatalog = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.loadModelCatalog',
          mode: 'read-only',
          message: '',
          models: [
            { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
            { display_name: 'GPT 5.4', model_id: 'gpt-5.4' },
            { display_name: 'Claude Sonnet 4.6', model_id: 'claude-sonnet-4.6' },
          ],
        },
      });
    desktopShell.saveAgentModels = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.saveAgentModels',
          mode: 'mutated',
          message: 'Agent assignments saved.',
          agents: [
            {
              agent_id: 'provider-planner',
              human_name: 'Lily',
              role_name: 'Planning Specialist',
              required_model: 'gpt-5.4',
              workflow_order: 0,
            },
            {
              agent_id: 'provider-pm',
              human_name: 'Alice',
              role_name: 'Product Manager',
              required_model: 'gpt-5.4',
              workflow_order: 1,
            },
            {
              agent_id: 'provider-builder',
              human_name: 'Dalton',
              role_name: 'Software Engineer',
              required_model: 'claude-sonnet-4.6',
              workflow_order: 2,
            },
            {
              agent_id: 'provider-qa',
              human_name: 'Ron',
              role_name: 'QA and Closeout',
              required_model: 'gpt-5.4',
              workflow_order: 3,
            },
          ],
        },
      });

    await renderApp();

    await waitFor(() => {
      expect(screen.getByLabelText('Open agent configuration')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Open agent configuration'));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Agent Configuration' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Lily model'), {
      target: { value: 'gpt-5.4' },
    });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(screen.getByText(/Restart TaskSail for planner model or reasoning effort/)).toBeTruthy();
    });

    expect(desktopShell.saveAgentModels).toHaveBeenCalledWith([
      { agent_id: 'provider-planner', model_id: 'gpt-5.4' },
      { agent_id: 'provider-pm', model_id: 'gpt-5.4' },
      { agent_id: 'provider-builder', model_id: 'claude-sonnet-4.6' },
      { agent_id: 'provider-qa', model_id: 'gpt-5.4' },
    ]);
  });

  it('MCP modal full round-trip: add → validate → save → toggle → remove', async () => {
    const server = {
      id: 'integration-mcp',
      display_name: 'Integration MCP',
      purpose: 'Integration test',
      enabled: true,
      transport: 'sse' as const,
      url: 'https://mcp.test.example/sse',
    };

    // Track list call count to return empty first, then with server after add.
    let listCallCount = 0;
    window.desktopShell.listExternalMcpServers = vi.fn().mockImplementation(async () => {
      listCallCount++;
      return {
        ok: true,
        response: {
          action: 'externalMcp.list',
          mode: 'read-only',
          message: '',
          servers: listCallCount <= 2 ? [] : [server],
          localEnabled: false,
        },
      };
    });

    window.desktopShell.validateExternalMcpConnection = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'externalMcp.validateConnection',
        mode: 'validated',
        success: true,
        message: 'MCP handshake successful with test-server.',
      },
    });

    window.desktopShell.addExternalMcpServer = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'externalMcp.add',
        mode: 'mutated',
        message: 'Server added.',
        servers: [server],
      },
    });

    window.desktopShell.toggleExternalMcpServer = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'externalMcp.toggleEnabled',
        mode: 'mutated',
        message: 'Toggled.',
        servers: [{ ...server, enabled: false }],
      },
    });

    window.desktopShell.removeExternalMcpServer = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'externalMcp.remove',
        mode: 'mutated',
        message: 'Removed.',
        servers: [],
      },
    });

    await renderApp();

    // 1. Open modal — empty state.
    await waitFor(() => {
      expect(screen.getByLabelText('Open MCP configuration')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Open MCP configuration'));
    await waitFor(() => {
      expect(screen.getByText('No external MCP servers configured.')).toBeTruthy();
    });

    // 2. Click Add Server → form view.
    fireEvent.click(screen.getByText('Add Server'));
    await waitFor(() => {
      expect(screen.getByText('Add MCP Server')).toBeTruthy();
    });

    // 3. Fill required fields.
    fireEvent.change(screen.getByPlaceholderText('Vendor Docs MCP'), {
      target: { value: 'Integration MCP' },
    });
    fireEvent.change(screen.getByPlaceholderText(/vendor billing API calls/), {
      target: { value: 'Integration test purpose for the round-trip flow' },
    });
    fireEvent.change(screen.getByPlaceholderText(/auth header requirements/), {
      target: { value: 'integration usage cue' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://mcp.vendor.example/sse'), {
      target: { value: 'https://mcp.test.example/sse' },
    });

    // 4. Save is disabled before validation.
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);

    // 5. Validate connection.
    fireEvent.click(screen.getByText('Validate Connection'));
    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeTruthy();
    });
    expect(window.desktopShell.validateExternalMcpConnection).toHaveBeenCalled();

    // 6. Save is now enabled → click Save.
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('Save'));

    // 7. Back to list view — server should appear.
    await waitFor(() => {
      expect(screen.getByText('Integration MCP')).toBeTruthy();
    });
    expect(window.desktopShell.addExternalMcpServer).toHaveBeenCalled();

    // 8. Toggle enabled → disabled.
    const toggleCheckbox = within(
      screen.getByText('Integration MCP').closest('li')!,
    ).getByRole('checkbox');
    fireEvent.click(toggleCheckbox);
    await waitFor(() => {
      expect(window.desktopShell.toggleExternalMcpServer).toHaveBeenCalledWith('integration-mcp');
    });

    // 9. Remove with confirmation.
    fireEvent.click(screen.getByLabelText('Remove Integration MCP'));
    await waitFor(() => {
      expect(screen.getByText('Remove?')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => {
      expect(screen.getByText('No external MCP servers configured.')).toBeTruthy();
    });
    expect(window.desktopShell.removeExternalMcpServer).toHaveBeenCalledWith('integration-mcp');
  });

  it('opens System Settings from the rail and saves with the loaded hash, leaving other rails intact', async () => {
    await renderApp();

    await waitFor(() => {
      expect(screen.getByLabelText('Open system settings')).toBeTruthy();
    });
    // Existing rails remain present and behavior-equivalent.
    expect(screen.getByLabelText('Open MCP configuration')).toBeTruthy();
    expect(screen.getByLabelText('Open agent configuration')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Open system settings'));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'System Settings' })).toBeTruthy();
    });

    // Dirty the draft so Save Changes enables, then confirm the restart warning.
    fireEvent.change(screen.getByLabelText('MCP port'), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(screen.getByText('Restart TaskSail?')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /save.*restart/i }));

    await waitFor(() => {
      expect(window.desktopShell.saveSystemSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          baseDefaultFileHash: 'system-settings-hash-1',
          config: expect.objectContaining({ mcp_port: 9000 }),
        }),
      );
    });
    await waitFor(() => {
      expect(window.desktopShell.restartTaskSail).toHaveBeenCalled();
    });
  });
});
