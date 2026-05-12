import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../contexts/ToastContext';
import { createMockClient } from '../../test/factories/clientFactory';
import { useAgentConfigModal } from './useAgentConfigModal';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return createElement(ToastProvider, null, children);
}

function makeAgents(overrides?: Array<Partial<{
  agent_id: string;
  human_name: string;
  role_name: string;
  required_model: string;
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
});
