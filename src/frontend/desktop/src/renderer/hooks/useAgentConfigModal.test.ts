import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../contexts/ToastContext';
import { createMockClient } from '../../test/factories/clientFactory';
import { createProviderFrontendDescriptor } from '../../test/factories/fixtureFactory';
import { useAgentConfigModal } from './useAgentConfigModal';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return createElement(ToastProvider, null, children);
}

function makeAgents(overrides?: Array<Partial<{
  agent_id: string;
  human_name: string;
  role_name: string;
  required_model: string;
  reasoning_effort?: string;
  workflow_order: number;
}> | undefined>) {
  const agents = [
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
  ];

  if (!overrides) {
    return agents;
  }

  return agents.map((agent, index) => ({
    ...agent,
    ...(overrides[index] ?? {}),
  }));
}

describe('useAgentConfigModal', () => {
  it('loads agents and models on open', async () => {
    const client = createMockClient();

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));
    expect(result.current.agentConfigModalProps.models).toHaveLength(3);
  });

  it('preserves dirty agent selections while switching tabs', async () => {
    const client = createMockClient();

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    act(() => {
      result.current.agentConfigModalProps.onAgentModelChange('provider-builder', 'gpt-5.4');
      result.current.agentConfigModalProps.onSelectTab('models');
      result.current.agentConfigModalProps.onSelectTab('agents');
    });

    const dalton = result.current.agentConfigModalProps.agents.find((agent) => agent.agent_id === 'provider-builder');
    expect(dalton?.selected_model).toBe('gpt-5.4');
    expect(result.current.agentConfigModalProps.isDirty).toBe(true);
  });

  it('loads capability choices into every agent row and preserves effort across model changes', async () => {
    const loadCapabilities = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.loadCapabilities',
        mode: 'read-only',
        message: 'Loaded capabilities.',
        providerId: 'copilot',
        cliVersion: '1.0.54',
        effortChoices: ['low', 'medium', 'high'],
        stale: false,
      },
    });
    const client = Object.assign(createMockClient(), { loadCapabilities });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    const lily = result.current.agentConfigModalProps.agents.find((agent) => agent.agent_id === 'provider-planner');
    expect(loadCapabilities).toHaveBeenCalledTimes(1);
    expect(lily?.effortOptions).toEqual(['none', 'low', 'medium', 'high']);
    expect(lily?.effortDisabled).toBe(false);

    act(() => {
      result.current.agentConfigModalProps.onAgentEffortChange('provider-planner', 'high');
      result.current.agentConfigModalProps.onAgentModelChange('provider-planner', 'gpt-5.4');
    });

    const changedLily = result.current.agentConfigModalProps.agents.find((agent) => agent.agent_id === 'provider-planner');
    expect(changedLily?.selected_model).toBe('gpt-5.4');
    expect(changedLily?.selected_effort).toBe('high');
    expect(result.current.agentConfigModalProps.isDirty).toBe(true);
  });

  it('synthesizes missing catalog options for uncatalogued assignments', async () => {
    const client = createMockClient({
      loadAgentConfig: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.loadAgents',
          mode: 'read-only',
          message: '',
          agents: makeAgents([
            undefined,
            undefined,
            {
              required_model: 'claude-opus-legacy',
            },
          ]),
        },
      }),
      loadModelCatalog: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.loadModelCatalog',
          mode: 'read-only',
          message: '',
          models: [
            { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
            { display_name: 'GPT 5.4', model_id: 'gpt-5.4' },
          ],
        },
      }),
    });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    const dalton = result.current.agentConfigModalProps.agents.find((agent) => agent.agent_id === 'provider-builder');
    expect(dalton?.currentModelMissing).toBe(true);
    expect(dalton?.options.some((option) => option.synthetic && option.model_id === 'claude-opus-legacy')).toBe(true);
  });

  it('saves all assignments atomically and shows Lily restart notice only when Lily changes', async () => {
    const saveAgentModels = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.saveAgentModels',
        mode: 'mutated',
        message: 'Agent assignments saved.',
        agents: makeAgents([
          { required_model: 'gpt-5.4' },
          undefined,
          { required_model: 'gpt-5.4' },
        ]),
      },
    });
    const client = createMockClient({ saveAgentModels });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    act(() => {
      result.current.agentConfigModalProps.onAgentModelChange('provider-planner', 'gpt-5.4');
      result.current.agentConfigModalProps.onAgentModelChange('provider-builder', 'gpt-5.4');
    });

    await act(async () => {
      await result.current.agentConfigModalProps.onSave();
    });

    expect(saveAgentModels).toHaveBeenCalledWith([
      { agent_id: 'provider-planner', model_id: 'gpt-5.4' },
      { agent_id: 'provider-pm', model_id: 'gpt-5.4' },
      { agent_id: 'provider-builder', model_id: 'gpt-5.4' },
      { agent_id: 'provider-qa', model_id: 'gpt-5.4' },
    ]);
    expect(result.current.agentConfigModalProps.isDirty).toBe(false);
    expect(result.current.agentConfigModalProps.showRestartNotice).toBe(true);
  });

  it('marks dirty, sends wall_clock_timeout_s, and refreshes from the save response', async () => {
    const saveAgentModels = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.saveAgentModels',
        mode: 'mutated',
        message: 'Agent assignments saved.',
        agents: makeAgents().map((agent) =>
          (agent.agent_id === 'provider-builder' ? { ...agent, wall_clock_timeout_s: 1200 } : agent)),
      },
    });
    const client = createMockClient({ saveAgentModels });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });
    act(() => { result.current.openAgentConfigModal(); });
    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    act(() => {
      result.current.agentConfigModalProps.onAgentWallClockTimeoutChange('provider-builder', '1200');
    });

    expect(result.current.agentConfigModalProps.isDirty).toBe(true);
    expect(
      result.current.agentConfigModalProps.agents.find((a) => a.agent_id === 'provider-builder')?.selected_wall_clock_timeout_s,
    ).toBe(1200);

    await act(async () => { await result.current.agentConfigModalProps.onSave(); });

    expect(saveAgentModels).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ agent_id: 'provider-builder', model_id: 'claude-sonnet-4.6', wall_clock_timeout_s: 1200 }),
      ]),
    );
    const refreshed = result.current.agentConfigModalProps.agents.find((a) => a.agent_id === 'provider-builder');
    expect(refreshed?.current_wall_clock_timeout_s).toBe(1200);
    expect(refreshed?.selected_wall_clock_timeout_s).toBe(1200);
    expect(result.current.agentConfigModalProps.isDirty).toBe(false);
  });

  it('emits idle_timeout_s only for the descriptor planner agent', async () => {
    const saveAgentModels = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.saveAgentModels',
        mode: 'mutated',
        message: 'Agent assignments saved.',
        agents: makeAgents(),
      },
    });
    const client = createMockClient({ saveAgentModels });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });
    act(() => { result.current.openAgentConfigModal(); });
    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    act(() => {
      // Even if a non-planner row's idle is set in hook state, onSave must gate it out.
      result.current.agentConfigModalProps.onAgentIdleTimeoutChange('provider-planner', '900');
      result.current.agentConfigModalProps.onAgentIdleTimeoutChange('provider-builder', '300');
    });

    await act(async () => { await result.current.agentConfigModalProps.onSave(); });

    const payload = saveAgentModels.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(payload.find((a) => a.agent_id === 'provider-planner')).toMatchObject({ idle_timeout_s: 900 });
    expect(payload.find((a) => a.agent_id === 'provider-builder')).not.toHaveProperty('idle_timeout_s');
  });

  it('errors on non-empty invalid timeouts but allows blanking the field to retype', async () => {
    const client = createMockClient();

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });
    act(() => { result.current.openAgentConfigModal(); });
    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    const builderTimeout = () =>
      result.current.agentConfigModalProps.agents.find((a) => a.agent_id === 'provider-builder')?.selected_wall_clock_timeout_s;

    // Non-empty invalid input sets the error and never advances to a savable value.
    for (const bad of ['0', '-5', '1.5', 'abc', '86401']) {
      act(() => {
        result.current.agentConfigModalProps.onAgentWallClockTimeoutChange('provider-builder', bad);
      });
      expect(result.current.agentConfigModalProps.error).not.toBeNull();
      expect(builderTimeout()).toBeUndefined();
    }

    // A valid value advances; blanking it then clears the value (renders blank) without an error,
    // so the controlled input never snaps back when the operator clears it to retype.
    act(() => {
      result.current.agentConfigModalProps.onAgentWallClockTimeoutChange('provider-builder', '1200');
    });
    expect(builderTimeout()).toBe(1200);

    act(() => {
      result.current.agentConfigModalProps.onAgentWallClockTimeoutChange('provider-builder', '');
    });
    expect(result.current.agentConfigModalProps.error).toBeNull();
    expect(builderTimeout()).toBeUndefined();
  });

  it('sends effort assignments, preserves unsaved state on save error, and shows restart notice for Lily effort changes', async () => {
    const loadCapabilities = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.loadCapabilities',
        mode: 'read-only',
        message: 'Loaded capabilities.',
        providerId: 'copilot',
        cliVersion: '1.0.54',
        effortChoices: ['low', 'medium', 'high'],
        stale: false,
      },
    });
    const saveAgentModels = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'Unsupported reasoning effort.' })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'agentConfig.saveAgentModels',
          mode: 'mutated',
          message: 'Agent assignments saved.',
          agents: makeAgents([{ reasoning_effort: 'high' }]),
        },
      });
    const client = Object.assign(createMockClient({ saveAgentModels }), { loadCapabilities });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    act(() => {
      result.current.agentConfigModalProps.onAgentEffortChange('provider-planner', 'high');
    });

    await act(async () => {
      await result.current.agentConfigModalProps.onSave();
    });

    expect(saveAgentModels).toHaveBeenLastCalledWith([
      { agent_id: 'provider-planner', model_id: 'gpt-4.1', reasoning_effort: 'high' },
      { agent_id: 'provider-pm', model_id: 'gpt-5.4' },
      { agent_id: 'provider-builder', model_id: 'claude-sonnet-4.6' },
      { agent_id: 'provider-qa', model_id: 'gpt-5.4' },
    ]);
    expect(result.current.agentConfigModalProps.error).toBe('Unsupported reasoning effort.');
    expect(result.current.agentConfigModalProps.agents.find((agent) => agent.agent_id === 'provider-planner')?.selected_effort).toBe('high');

    await act(async () => {
      await result.current.agentConfigModalProps.onSave();
    });

    expect(result.current.agentConfigModalProps.showRestartNotice).toBe(true);
    expect(result.current.agentConfigModalProps.isDirty).toBe(false);
  });

  it('disables effort changes when capabilities are unavailable and keeps saved effort as the only extra option', async () => {
    const client = createMockClient({
      loadAgentConfig: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.loadAgents',
          mode: 'read-only',
          message: '',
          agents: makeAgents([{ reasoning_effort: 'xhigh' }]),
        },
      }),
    });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    const lily = result.current.agentConfigModalProps.agents.find((agent) => agent.agent_id === 'provider-planner');
    expect(result.current.agentConfigModalProps.effortWarning).toBe('Reasoning effort options could not be loaded from the installed Test CLI. Effort changes are blocked until capabilities can be discovered.');
    expect(lily?.effortDisabled).toBe(true);
    expect(lily?.effortOptions).toEqual(['none', 'xhigh']);
  });

  it('clears the Lily restart notice on modal close and resets baseline on reopen', async () => {
    const loadAgentConfig = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'agentConfig.loadAgents',
          mode: 'read-only',
          message: '',
          agents: makeAgents(),
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'agentConfig.loadAgents',
          mode: 'read-only',
          message: '',
          agents: makeAgents([
            { required_model: 'gpt-5.4' },
          ]),
        },
      });
    const saveAgentModels = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'agentConfig.saveAgentModels',
          mode: 'mutated',
          message: 'Agent assignments saved.',
          agents: makeAgents([
            { required_model: 'gpt-5.4' },
          ]),
        },
      });
    const client = createMockClient({ loadAgentConfig, saveAgentModels });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    act(() => {
      result.current.agentConfigModalProps.onAgentModelChange('provider-planner', 'gpt-5.4');
    });

    await act(async () => {
      await result.current.agentConfigModalProps.onSave();
    });

    expect(result.current.agentConfigModalProps.showRestartNotice).toBe(true);

    // Close clears notice and resets baseline
    act(() => {
      result.current.agentConfigModalProps.onClose();
    });

    expect(result.current.agentConfigModalProps.showRestartNotice).toBe(false);

    // Reopen — loads the post-save state as new baseline, no notice
    act(() => {
      result.current.openAgentConfigModal();
    });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));
    expect(result.current.agentConfigModalProps.showRestartNotice).toBe(false);
  });

  it('adds and removes models through the catalog actions', async () => {
    const addModel = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.addModel',
        mode: 'mutated',
        message: 'Model added.',
        models: [
          { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
          { display_name: 'GPT 5.4', model_id: 'gpt-5.4' },
          { display_name: 'Claude Sonnet 4.6', model_id: 'claude-sonnet-4.6' },
          { display_name: 'GPT 5.5', model_id: 'gpt-5.5' },
        ],
      },
    });
    const removeModel = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.removeModel',
        mode: 'mutated',
        message: 'Model removed.',
        models: [
          { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
          { display_name: 'GPT 5.4', model_id: 'gpt-5.4' },
          { display_name: 'Claude Sonnet 4.6', model_id: 'claude-sonnet-4.6' },
        ],
      },
    });
    const client = createMockClient({ addModel, removeModel });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.models).toHaveLength(3));

    act(() => {
      result.current.agentConfigModalProps.onNewModelDisplayNameChange('GPT 5.5');
      result.current.agentConfigModalProps.onNewModelIdChange('gpt-5.5');
    });

    await act(async () => {
      await result.current.agentConfigModalProps.onAddModel();
    });

    expect(addModel).toHaveBeenCalledWith('GPT 5.5', 'gpt-5.5');
    expect(result.current.agentConfigModalProps.models).toHaveLength(4);

    await act(async () => {
      await result.current.agentConfigModalProps.onConfirmRemoveModel('gpt-5.5');
    });

    expect(removeModel).toHaveBeenCalledWith('gpt-5.5');
    expect(result.current.agentConfigModalProps.models).toHaveLength(3);
  });

  // ── Track C new tests ────────────────────────────────────────────────────────

  it('loads extension catalog and assignments on modal open alongside agents and models', async () => {
    const listAgentExtensions = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.listExtensions',
        mode: 'read-only',
        message: '1 extension(s) loaded.',
        extensions: [
          {
            id: 'my-skill',
            kind: 'skill',
            provider_id: 'copilot',
            display_name: 'My Skill',
            description: 'A test skill.',
            enabled: true,
            source_type: 'git',
            status: 'available',
            metadata: { skill_names: ['doThing'] },
          },
        ],
      },
    });
    const loadAgentExtensionAssignments = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.loadExtensionAssignments',
        mode: 'read-only',
        message: '1 agent assignment(s) loaded.',
        assignments: [
          { agent_id: 'provider-planner', extension_ids: ['my-skill'] },
        ],
      },
    });
    const client = createMockClient({ listAgentExtensions, loadAgentExtensionAssignments });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.extensions).toHaveLength(1));

    expect(listAgentExtensions).toHaveBeenCalledTimes(1);
    expect(loadAgentExtensionAssignments).toHaveBeenCalledTimes(1);
    expect(result.current.agentConfigModalProps.extensions[0].id).toBe('my-skill');
    expect(result.current.agentConfigModalProps.extensionAssignments['provider-planner']).toEqual(['my-skill']);
  });

  it('uses the active provider descriptor as the default add-extension provider_id', async () => {
    const addAgentExtension = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.addExtension',
        mode: 'mutated',
        message: 'Added.',
        extension: {
          id: 'descriptor-skill',
          kind: 'skill',
          provider_id: 'descriptor-provider',
          display_name: 'Descriptor Skill',
          description: '',
          enabled: true,
          source_type: 'git',
          status: 'available',
          metadata: {},
        },
      },
    });
    const client = createMockClient({
      describeActiveProvider: vi.fn().mockResolvedValue(createProviderFrontendDescriptor({
        providerId: 'descriptor-provider',
      })),
      addAgentExtension,
    });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.addForm.provider_id).toBe('descriptor-provider'));

    act(() => {
      result.current.agentConfigModalProps.onAddFormChange({
        id: 'descriptor-skill',
        gitUrl: 'https://github.com/org/repo',
        gitRef: 'main',
      });
    });

    await act(async () => {
      await result.current.agentConfigModalProps.onAddExtension();
    });

    expect(addAgentExtension).toHaveBeenCalledWith({
      id: 'descriptor-skill',
      kind: 'skill',
      provider_id: 'descriptor-provider',
      source: { type: 'git', url: 'https://github.com/org/repo', ref: 'main' },
    });
    expect(result.current.agentConfigModalProps.addForm.provider_id).toBe('descriptor-provider');
  });

  it('does NOT trigger a rescan (no reseed/rescan call) on modal open', async () => {
    // The client has listAgentExtensions (pure read) but no reseed should be called
    const reseedAgentExtension = vi.fn();
    const client = createMockClient({ reseedAgentExtension });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    // reseed must NOT have been called automatically
    expect(reseedAgentExtension).not.toHaveBeenCalled();
  });

  it('save assignments sends IDs only (no paths, no source URLs, no bodies)', async () => {
    const saveAgentExtensionAssignments = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.saveExtensionAssignments',
        mode: 'mutated',
        message: 'Saved.',
        assignments: [
          { agent_id: 'planning-agent', extension_ids: ['my-skill'] },
        ],
      },
    });
    const loadAgentExtensionAssignments = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.loadExtensionAssignments',
        mode: 'read-only',
        message: '0 agent assignment(s) loaded.',
        assignments: [],
      },
    });
    const client = createMockClient({ saveAgentExtensionAssignments, loadAgentExtensionAssignments });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    // Toggle an assignment
    act(() => {
      result.current.agentConfigModalProps.onToggleExtensionAssignment('planning-agent', 'my-skill', true);
    });

    expect(result.current.agentConfigModalProps.isAssignmentsDirty).toBe(true);

    await act(async () => {
      await result.current.agentConfigModalProps.onSaveAssignments();
    });

    // Verify call contains only agent_id and extension_ids (IDs only)
    expect(saveAgentExtensionAssignments).toHaveBeenCalledTimes(1);
    const callPayload = saveAgentExtensionAssignments.mock.calls[0][0] as {
      assignments: Array<{ agent_id: string; extension_ids: string[] }>;
    };
    const plannerEntry = callPayload.assignments.find((a) => a.agent_id === 'planning-agent');
    expect(plannerEntry).toBeDefined();
    expect(plannerEntry?.extension_ids).toEqual(['my-skill']);
    // No raw paths or bodies in payload
    expect(JSON.stringify(callPayload)).not.toMatch(/source_url|runtime_path|skill_markdown|plugin_manifest/);
  });

  it('onToggleExtensionAssignment updates isAssignmentsDirty correctly', async () => {
    const loadAgentExtensionAssignments = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.loadExtensionAssignments',
        mode: 'read-only',
        message: '1 agent assignment(s) loaded.',
        assignments: [{ agent_id: 'provider-planner', extension_ids: ['sk-1'] }],
      },
    });
    const client = createMockClient({ loadAgentExtensionAssignments });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    // Initially not dirty
    expect(result.current.agentConfigModalProps.isAssignmentsDirty).toBe(false);

    // Remove sk-1 → dirty
    act(() => {
      result.current.agentConfigModalProps.onToggleExtensionAssignment('provider-planner', 'sk-1', false);
    });
    expect(result.current.agentConfigModalProps.isAssignmentsDirty).toBe(true);

    // Re-add sk-1 → back to clean
    act(() => {
      result.current.agentConfigModalProps.onToggleExtensionAssignment('provider-planner', 'sk-1', true);
    });
    expect(result.current.agentConfigModalProps.isAssignmentsDirty).toBe(false);
  });

  it('loads external MCP servers and assignments into the modal', async () => {
    const listExternalMcpServers = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'externalMcp.list',
        mode: 'read-only',
        message: '',
        servers: [{ id: 'vendor-docs', display_name: 'Vendor Docs', purpose: 'Docs for billing flows.', enabled: true, transport: 'sse', url: 'https://mcp.example.com/sse' }],
        localEnabled: false,
      },
    });
    const loadExternalMcpAssignments = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.loadExternalMcpAssignments',
        mode: 'read-only',
        message: '',
        assignments: [{ agent_id: 'software-engineer', external_mcp_server_ids: ['vendor-docs'] }],
      },
    });
    const client = createMockClient({ listExternalMcpServers, loadExternalMcpAssignments });
    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });
    act(() => { result.current.openAgentConfigModal(); });
    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    expect(listExternalMcpServers).toHaveBeenCalledTimes(1);
    expect(result.current.agentConfigModalProps.externalMcpServers).toHaveLength(1);
    expect(result.current.agentConfigModalProps.externalMcpAssignments['software-engineer']).toEqual(['vendor-docs']);
  });

  it('toggling an external MCP assignment marks dirty without changing skills assignments', async () => {
    const client = createMockClient({});
    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });
    act(() => { result.current.openAgentConfigModal(); });
    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    expect(result.current.agentConfigModalProps.isAssignmentsDirty).toBe(false);
    const skillsBefore = JSON.stringify(result.current.agentConfigModalProps.extensionAssignments);

    act(() => { result.current.agentConfigModalProps.onToggleExternalMcpAssignment('software-engineer', 'vendor-docs', true); });

    expect(result.current.agentConfigModalProps.isAssignmentsDirty).toBe(true);
    expect(JSON.stringify(result.current.agentConfigModalProps.extensionAssignments)).toEqual(skillsBefore);
    expect(result.current.agentConfigModalProps.externalMcpAssignments['software-engineer']).toEqual(['vendor-docs']);
  });

  it('onSaveAssignments saves external MCP only when only MCP assignments are dirty', async () => {
    const saveExternalMcpAssignments = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'agentConfig.saveExternalMcpAssignments', mode: 'mutated', message: 'Saved.', assignments: [{ agent_id: 'software-engineer', external_mcp_server_ids: ['vendor-docs'] }] },
    });
    const saveAgentExtensionAssignments = vi.fn();
    const client = createMockClient({ saveExternalMcpAssignments, saveAgentExtensionAssignments });
    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });
    act(() => { result.current.openAgentConfigModal(); });
    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    act(() => { result.current.agentConfigModalProps.onToggleExternalMcpAssignment('software-engineer', 'vendor-docs', true); });
    await act(async () => { await result.current.agentConfigModalProps.onSaveAssignments(); });

    expect(saveExternalMcpAssignments).toHaveBeenCalledTimes(1);
    expect(saveAgentExtensionAssignments).not.toHaveBeenCalled();
    expect(result.current.agentConfigModalProps.isAssignmentsDirty).toBe(false);
  });

  it('onSaveAssignments saves both categories when both are dirty', async () => {
    const saveExternalMcpAssignments = vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentConfig.saveExternalMcpAssignments', mode: 'mutated', message: '', assignments: [{ agent_id: 'software-engineer', external_mcp_server_ids: ['vendor-docs'] }] } });
    const saveAgentExtensionAssignments = vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentConfig.saveExtensionAssignments', mode: 'mutated', message: '', assignments: [{ agent_id: 'software-engineer', extension_ids: ['my-skill'] }] } });
    const client = createMockClient({ saveExternalMcpAssignments, saveAgentExtensionAssignments });
    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });
    act(() => { result.current.openAgentConfigModal(); });
    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    act(() => {
      result.current.agentConfigModalProps.onToggleExtensionAssignment('software-engineer', 'my-skill', true);
      result.current.agentConfigModalProps.onToggleExternalMcpAssignment('software-engineer', 'vendor-docs', true);
    });
    await act(async () => { await result.current.agentConfigModalProps.onSaveAssignments(); });

    expect(saveAgentExtensionAssignments).toHaveBeenCalledTimes(1);
    expect(saveExternalMcpAssignments).toHaveBeenCalledTimes(1);
  });

  it('persists the succeeding category even when the other category save fails', async () => {
    const saveExternalMcpAssignments = vi.fn().mockResolvedValue({ ok: false, error: 'MCP save failed.' });
    const saveAgentExtensionAssignments = vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentConfig.saveExtensionAssignments', mode: 'mutated', message: '', assignments: [{ agent_id: 'software-engineer', extension_ids: ['my-skill'] }] } });
    const client = createMockClient({ saveExternalMcpAssignments, saveAgentExtensionAssignments });
    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });
    act(() => { result.current.openAgentConfigModal(); });
    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    act(() => {
      result.current.agentConfigModalProps.onToggleExtensionAssignment('software-engineer', 'my-skill', true);
      result.current.agentConfigModalProps.onToggleExternalMcpAssignment('software-engineer', 'vendor-docs', true);
    });
    await act(async () => { await result.current.agentConfigModalProps.onSaveAssignments(); });

    expect(saveAgentExtensionAssignments).toHaveBeenCalledTimes(1);
    expect(saveExternalMcpAssignments).toHaveBeenCalledTimes(1);
    expect(result.current.agentConfigModalProps.error).toContain('MCP save failed.');

    // Skills snapshot persisted (no longer dirty); only the failed MCP edit remains.
    act(() => { result.current.agentConfigModalProps.onToggleExternalMcpAssignment('software-engineer', 'vendor-docs', false); });
    expect(result.current.agentConfigModalProps.isAssignmentsDirty).toBe(false);
  });

  it('existing model/effort behavior remains intact when extensions are present', async () => {
    const listAgentExtensions = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.listExtensions',
        mode: 'read-only',
        message: '1 extension(s) loaded.',
        extensions: [
          {
            id: 'sk-1',
            kind: 'skill',
            provider_id: 'copilot',
            display_name: 'Skill One',
            description: '',
            enabled: true,
            source_type: 'git',
            status: 'available',
            metadata: {},
          },
        ],
      },
    });
    const client = createMockClient({ listAgentExtensions });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    // Existing model change still works
    act(() => {
      result.current.agentConfigModalProps.onAgentModelChange('provider-builder', 'gpt-5.4');
    });
    const dalton = result.current.agentConfigModalProps.agents.find((a) => a.agent_id === 'provider-builder');
    expect(dalton?.selected_model).toBe('gpt-5.4');
    expect(result.current.agentConfigModalProps.isDirty).toBe(true);
    // Extensions loaded correctly alongside
    expect(result.current.agentConfigModalProps.extensions).toHaveLength(1);
  });

  it('extension selectedExtensionIds per agent row reflects working assignments', async () => {
    const loadAgentExtensionAssignments = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.loadExtensionAssignments',
        mode: 'read-only',
        message: '',
        assignments: [{ agent_id: 'provider-planner', extension_ids: ['sk-1', 'sk-2'] }],
      },
    });
    const client = createMockClient({ loadAgentExtensionAssignments });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    const lily = result.current.agentConfigModalProps.agents.find((a) => a.agent_id === 'provider-planner');
    expect(lily?.selectedExtensionIds).toEqual(['sk-1', 'sk-2']);
  });

  it('delete opts into remove_assignments for an assigned entry and not for an unassigned one', async () => {
    const listAgentExtensions = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.listExtensions',
        mode: 'read-only',
        message: '',
        extensions: [
          { id: 'assigned-skill', kind: 'skill', provider_id: 'copilot', display_name: 'Assigned', description: '', enabled: true, source_type: 'git', status: 'available', metadata: {} },
          { id: 'free-skill', kind: 'skill', provider_id: 'copilot', display_name: 'Free', description: '', enabled: true, source_type: 'git', status: 'available', metadata: {} },
        ],
      },
    });
    const loadAgentExtensionAssignments = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.loadExtensionAssignments',
        mode: 'read-only',
        message: '',
        assignments: [{ agent_id: 'provider-planner', extension_ids: ['assigned-skill'] }],
      },
    });
    const deleteAgentExtension = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'agentConfig.deleteExtension', mode: 'deleted', message: 'Deleted.', id: 'x' },
    });
    const client = createMockClient({ listAgentExtensions, loadAgentExtensionAssignments, deleteAgentExtension });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });
    await waitFor(() => expect(result.current.agentConfigModalProps.extensions).toHaveLength(2));

    // Assigned (per persisted state) → opt into the combined delete-plus-unassign.
    await act(async () => {
      await result.current.agentConfigModalProps.onDeleteExtension('assigned-skill');
    });
    expect(deleteAgentExtension).toHaveBeenLastCalledWith({ id: 'assigned-skill', remove_assignments: true });

    // Unassigned → fail-closed delete (no assignment write requested).
    await act(async () => {
      await result.current.agentConfigModalProps.onDeleteExtension('free-skill');
    });
    expect(deleteAgentExtension).toHaveBeenLastCalledWith({ id: 'free-skill', remove_assignments: false });
  });

  // ── Track F confirmation tests ───────────────────────────────────────────────

  it('agent rows expose human_name and role_name (type) for multi-select display', async () => {
    const client = createMockClient();

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    for (const agent of result.current.agentConfigModalProps.agents) {
      // Each agent row must carry both a display name and a type/role name for the multi-select
      expect(typeof agent.human_name).toBe('string');
      expect(agent.human_name.length).toBeGreaterThan(0);
      expect(typeof agent.role_name).toBe('string');
      expect(agent.role_name.length).toBeGreaterThan(0);
    }
  });

  it('save assignments does NOT call any session-mutation API (no start/end/send session calls)', async () => {
    const saveAgentExtensionAssignments = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.saveExtensionAssignments',
        mode: 'mutated',
        message: 'Saved.',
        assignments: [{ agent_id: 'planning-agent', extension_ids: ['sk-1'] }],
      },
    });
    const startPlannerSession = vi.fn();
    const sendPlannerMessage = vi.fn();
    const endPlannerSession = vi.fn();
    const client = createMockClient({
      saveAgentExtensionAssignments,
      startPlannerSession,
      sendPlannerMessage,
      endPlannerSession,
    });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.agents).toHaveLength(4));

    act(() => {
      result.current.agentConfigModalProps.onToggleExtensionAssignment('planning-agent', 'sk-1', true);
    });

    await act(async () => {
      await result.current.agentConfigModalProps.onSaveAssignments();
    });

    expect(saveAgentExtensionAssignments).toHaveBeenCalledTimes(1);
    // Session APIs must NOT be called by a save-assignments action
    expect(startPlannerSession).not.toHaveBeenCalled();
    expect(sendPlannerMessage).not.toHaveBeenCalled();
    expect(endPlannerSession).not.toHaveBeenCalled();
  });

  it('plugin extension in catalog has no skill_names in its metadata', async () => {
    const listAgentExtensions = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.listExtensions',
        mode: 'read-only',
        message: '2 extension(s) loaded.',
        extensions: [
          {
            id: 'phase2-ferret-skill',
            kind: 'skill',
            provider_id: 'copilot',
            display_name: 'Phase 2 Ferret Skill',
            description: 'A skill.',
            enabled: true,
            source_type: 'local',
            status: 'available',
            metadata: { skill_names: ['phase2-ferret-skill'] },
          },
          {
            id: 'phase2-cobalt-plugin',
            kind: 'plugin',
            provider_id: 'copilot',
            // Plugin display_name is the manifest slug (lowercase), not a human label
            display_name: 'phase2-cobalt-plugin',
            description: 'A plugin.',
            enabled: true,
            source_type: 'local',
            status: 'available',
            metadata: { plugin_component_classes: ['EchoPlugin'], plugin_skill_count: 1 },
          },
        ],
      },
    });
    const client = createMockClient({ listAgentExtensions });

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.extensions).toHaveLength(2));

    const skill = result.current.agentConfigModalProps.extensions.find((e) => e.kind === 'skill');
    const plugin = result.current.agentConfigModalProps.extensions.find((e) => e.kind === 'plugin');

    // Skill has skill_names
    expect(skill?.metadata.skill_names).toBeDefined();
    // Plugin must NOT have skill_names (availability notes must not render a bundled-skills line)
    expect(plugin?.metadata.skill_names).toBeUndefined();
    // Plugin display_name is the catalog id slug
    expect(plugin?.display_name).toBe('phase2-cobalt-plugin');
    // Plugin has plugin_skill_count
    expect(plugin?.metadata.plugin_skill_count).toBe(1);
  });

  it('catalog shows extensions when present (negative: empty catalog returns no extensions)', async () => {
    const client = createMockClient(); // default returns 0 extensions

    const { result } = renderHook(() => useAgentConfigModal(client), { wrapper });

    act(() => { result.current.openAgentConfigModal(); });

    await waitFor(() => expect(result.current.agentConfigModalProps.isLoading).toBe(false));

    expect(result.current.agentConfigModalProps.extensions).toHaveLength(0);
    expect(result.current.agentConfigModalProps.extensionAssignments).toEqual({});
  });
});
