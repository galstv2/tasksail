import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import AgentConfigModal from './AgentConfigModal';
import type { AgentConfigModalProps } from '../hooks/useAgentConfigModal';
import { createProviderFrontendDescriptor } from '../../test/factories/fixtureFactory';

afterEach(cleanup);

function defaultProps(overrides: Partial<AgentConfigModalProps> = {}): AgentConfigModalProps {
  return {
    isOpen: true,
    isLoading: false,
    activeTab: 'agents',
    agents: [
      {
        agent_id: 'provider-planner',
        human_name: 'Lily',
        role_name: 'Planning Specialist',
        current_model: 'gpt-4.1',
        selected_model: 'gpt-4.1',
        current_effort: 'none',
        selected_effort: 'none',
        workflow_order: 0,
        options: [
          { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
          { display_name: 'GPT 5.4', model_id: 'gpt-5.4' },
        ],
        effortOptions: ['none', 'low', 'medium', 'high'],
        effortDisabled: false,
        currentModelMissing: false,
      },
      {
        agent_id: 'provider-builder',
        human_name: 'Dalton',
        role_name: 'Software Engineer',
        current_model: 'claude-opus-legacy',
        selected_model: 'claude-opus-legacy',
        current_effort: 'high',
        selected_effort: 'high',
        workflow_order: 2,
        options: [
          { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
          {
            display_name: 'claude-opus-legacy (missing from catalog)',
            model_id: 'claude-opus-legacy',
            synthetic: true,
          },
        ],
        effortOptions: ['none', 'low', 'medium', 'high'],
        effortDisabled: false,
        currentModelMissing: true,
      },
    ],
    models: [
      {
        display_name: 'GPT 4.1',
        model_id: 'gpt-4.1',
        usageCount: 1,
        inUseBy: ['Lily'],
      },
      {
        display_name: 'GPT 5.4',
        model_id: 'gpt-5.4',
        usageCount: 0,
        inUseBy: [],
      },
    ],
    newModelDisplayName: '',
    newModelId: '',
    removingModelId: null,
    saving: false,
    error: null,
    isDirty: false,
    showRestartNotice: false,
    effortWarning: null,
    pendingModelChange: null,
    descriptor: createProviderFrontendDescriptor({
      roster: [
        { agentId: 'provider-planner', roleName: 'Planning Specialist', humanName: 'Lily', workflowOrder: 1, roleKind: 'planner' },
        { agentId: 'provider-builder', roleName: 'Software Engineer', humanName: 'Dalton', workflowOrder: 2, roleKind: 'builder' },
      ],
      plannerAgentId: 'provider-planner',
    }),
    onClose: vi.fn(),
    onSelectTab: vi.fn(),
    onAgentModelChange: vi.fn(),
    onAgentEffortChange: vi.fn(),
    onConfirmModelChange: vi.fn(),
    onCancelModelChange: vi.fn(),
    onNewModelDisplayNameChange: vi.fn(),
    onNewModelIdChange: vi.fn(),
    onAddModel: vi.fn().mockResolvedValue(undefined),
    onRemoveModel: vi.fn(),
    onConfirmRemoveModel: vi.fn().mockResolvedValue(undefined),
    onCancelRemoveModel: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('AgentConfigModal', () => {
  it('returns null when closed', () => {
    const { container } = render(<AgentConfigModal {...defaultProps({ isOpen: false })} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders agent rows and missing-model warning', () => {
    render(<AgentConfigModal {...defaultProps()} />);

    expect(screen.getByText('Lily')).toBeTruthy();
    expect(screen.getByText('Dalton')).toBeTruthy();
    expect(screen.getByText(/missing from the catalog/i)).toBeTruthy();
  });

  it('renders model and reasoning effort selects in each agent row', () => {
    render(<AgentConfigModal {...defaultProps()} />);

    const lilyModel = screen.getByLabelText('Lily model');
    const lilyEffort = screen.getByLabelText('Lily reasoning effort');
    expect(lilyModel).toHaveClass('mcp-form__select');
    expect(lilyEffort).toHaveClass('mcp-form__select');
    expect(lilyModel.closest('label')).toHaveClass('agent-config__field');
    expect(lilyEffort.closest('label')).toHaveClass('agent-config__field');
    expect(within(lilyEffort.closest('label') as HTMLElement).getByText('Lily reasoning effort')).toHaveClass('agent-config__sr-only');
    expect(within(lilyEffort).getByRole('option', { name: 'None' })).toBeTruthy();
    expect(within(lilyEffort).getByRole('option', { name: 'high' })).toBeTruthy();
  });

  it('renders the reasoning effort disclaimer once and no effort controls in Models tab', () => {
    const { rerender } = render(<AgentConfigModal {...defaultProps()} />);

    expect(screen.getAllByText('Model support for reasoning effort varies. Verify the selected model supports this effort before changing it.')).toHaveLength(1);

    rerender(<AgentConfigModal {...defaultProps({ activeTab: 'models' })} />);

    expect(screen.queryByLabelText(/reasoning effort/i)).toBeNull();
    expect(screen.queryByText(/Model support for reasoning effort varies/)).toBeNull();
  });

  it('renders stale capability warning with enabled effort selects', () => {
    render(<AgentConfigModal {...defaultProps({
      effortWarning: 'Cached reasoning effort options may be out of date.',
      agents: defaultProps().agents.map((agent) => ({ ...agent, currentModelMissing: false })),
    })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Cached reasoning effort options may be out of date.');
    expect(screen.getByLabelText('Lily reasoning effort')).toBeEnabled();
    expect(screen.getByLabelText('Dalton reasoning effort')).toBeEnabled();
  });

  it('disables effort selects when capabilities are unavailable and keeps only None plus stored effort', () => {
    render(<AgentConfigModal {...defaultProps({
      effortWarning: 'Reasoning effort options could not be loaded from the installed Copilot CLI.',
      agents: defaultProps().agents.map((agent) => ({
        ...agent,
        effortOptions: agent.current_effort === 'none' ? ['none'] : ['none', agent.current_effort],
        effortDisabled: true,
        currentModelMissing: false,
      })),
    })} />);

    const lilyEffort = screen.getByLabelText('Lily reasoning effort');
    const daltonEffort = screen.getByLabelText('Dalton reasoning effort');
    expect(lilyEffort).toBeDisabled();
    expect(within(lilyEffort).getAllByRole('option').map((option) => option.textContent)).toEqual(['None']);
    expect(daltonEffort).toBeDisabled();
    expect(within(daltonEffort).getAllByRole('option').map((option) => option.textContent)).toEqual(['None', 'high']);
  });

  it('renders save errors through the existing modal alert surface', () => {
    render(<AgentConfigModal {...defaultProps({ error: 'Save rejected.' })} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('mcp-modal__error');
    expect(alert).toHaveTextContent('Save rejected.');
  });

  it('switches tabs through callback', () => {
    const onSelectTab = vi.fn();
    render(<AgentConfigModal {...defaultProps({ onSelectTab })} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Models' }));

    expect(onSelectTab).toHaveBeenCalledWith('models');
  });

  it('renders model removal disabled when in use', () => {
    render(<AgentConfigModal {...defaultProps({ activeTab: 'models' })} />);

    const removeButton = screen.getAllByRole('button', { name: 'Remove' })[0];
    expect(removeButton).toBeDisabled();
    expect(removeButton).toHaveAttribute('title', 'In use by Lily');
  });

  it('renders restart notice only when requested', () => {
    const { rerender } = render(<AgentConfigModal {...defaultProps()} />);
    expect(screen.queryByText(/Restart TaskSail/)).toBeNull();

    rerender(<AgentConfigModal {...defaultProps({ showRestartNotice: true })} />);
    const notice = screen.getByText(/Restart TaskSail/);
    expect(notice).toBeTruthy();
    expect(notice).toHaveClass('agent-config__restart-notice');
  });

  it('calls save from the footer', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AgentConfigModal {...defaultProps({ isDirty: true, onSave })} />);

    fireEvent.click(screen.getByText('Save Changes'));

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
