import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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
        workflow_order: 0,
        options: [
          { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
          { display_name: 'GPT 5.4', model_id: 'gpt-5.4' },
        ],
        currentModelMissing: false,
      },
      {
        agent_id: 'provider-builder',
        human_name: 'Dalton',
        role_name: 'Software Engineer',
        current_model: 'claude-opus-legacy',
        selected_model: 'claude-opus-legacy',
        workflow_order: 2,
        options: [
          { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
          {
            display_name: 'claude-opus-legacy (missing from catalog)',
            model_id: 'claude-opus-legacy',
            synthetic: true,
          },
        ],
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
    expect(screen.getByText(/Restart TaskSail/)).toBeTruthy();
  });

  it('calls save from the footer', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AgentConfigModal {...defaultProps({ isDirty: true, onSave })} />);

    fireEvent.click(screen.getByText('Save Changes'));

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
