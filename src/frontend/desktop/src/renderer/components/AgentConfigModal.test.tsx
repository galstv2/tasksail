import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import AgentConfigModal from './AgentConfigModal';
import type { AgentConfigModalProps } from '../hooks/useAgentConfigModal';
import { createProviderFrontendDescriptor } from '../../test/factories/fixtureFactory';
import type { AgentExtensionRendererCatalogEntry } from '../../shared/desktopContractAgentConfig';

afterEach(cleanup);

function makeExtension(overrides: Partial<AgentExtensionRendererCatalogEntry> = {}): AgentExtensionRendererCatalogEntry {
  return {
    id: 'my-skill',
    kind: 'skill',
    provider_id: 'copilot',
    display_name: 'My Skill',
    description: 'A test skill.',
    enabled: true,
    source_type: 'git',
    status: 'available',
    metadata: { skill_names: ['doThing'] },
    ...overrides,
  };
}

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
        selectedExtensionIds: [],
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
        selectedExtensionIds: [],
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
    extensions: [],
    extensionAssignments: {},
    addForm: {
      id: '',
      kind: 'skill',
      provider_id: 'copilot',
      sourceType: 'git',
      gitUrl: '',
      gitRef: '',
      gitSubpath: '',
      localPath: '',
      localSubpath: '',
      skillMarkdown: '',
    },
    extensionSaving: false,
    newModelDisplayName: '',
    newModelId: '',
    removingModelId: null,
    saving: false,
    error: null,
    isDirty: false,
    isAssignmentsDirty: false,
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
    onAddFormChange: vi.fn(),
    onAddExtension: vi.fn().mockResolvedValue(undefined),
    onReseedExtension: vi.fn().mockResolvedValue(undefined),
    onDeleteExtension: vi.fn().mockResolvedValue(undefined),
    onToggleExtensionAssignment: vi.fn(),
    onSaveAssignments: vi.fn().mockResolvedValue(undefined),
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

  // ── Track C new tests ────────────────────────────────────────────────────────

  it('renders the Skills & Plugins tab button', () => {
    render(<AgentConfigModal {...defaultProps()} />);
    const tab = screen.getByRole('tab', { name: 'Skills & Plugins' });
    expect(tab).toBeTruthy();
    expect(tab).toHaveAttribute('aria-selected', 'false');
  });

  it('renders Skills & Plugins tab content when active', () => {
    render(<AgentConfigModal {...defaultProps({ activeTab: 'skills-plugins' })} />);

    // Intro text about plugins
    expect(screen.getByText(/Manage trusted skills and plugins/)).toBeTruthy();
    // Empty state
    expect(screen.getByText(/No extensions added yet/)).toBeTruthy();
    // Add form button
    expect(screen.getByRole('button', { name: 'Add Extension' })).toBeTruthy();
  });

  it('renders extension catalog entries with name, Skill/Plugin badge, provider, and status', () => {
    const ext = makeExtension({ id: 'alpha', display_name: 'Alpha Skill', kind: 'skill', status: 'available' });
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      extensions: [ext],
    })} />);

    expect(screen.getByText('Alpha Skill')).toBeTruthy();
    // Badge spans (not option elements)
    const badges = screen.getAllByText('Skill');
    expect(badges.some((el) => el.tagName === 'SPAN')).toBe(true);
    expect(screen.getByText('available')).toBeTruthy();
    expect(screen.getByText('copilot')).toBeTruthy();
  });

  it('renders plugin trust warning: disables direct-attachment for plugins and shows explanation', () => {
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      addForm: {
        id: 'my-plugin',
        kind: 'plugin',
        provider_id: 'copilot',
        sourceType: 'direct-attachment',
        gitUrl: '',
        gitRef: '',
        gitSubpath: '',
        localPath: '',
        localSubpath: '',
        skillMarkdown: '',
      },
    })} />);

    // Warning message is shown
    expect(screen.getByText(/Plugin direct attachment is not supported in V1/)).toBeTruthy();
    // Add Extension button is disabled
    const addBtn = screen.getByRole('button', { name: 'Add Extension' });
    expect(addBtn).toBeDisabled();
  });

  it('shows direct skill attachment textarea when sourceType is direct-attachment and kind is skill', () => {
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      addForm: {
        id: 'direct-skill',
        kind: 'skill',
        provider_id: 'copilot',
        sourceType: 'direct-attachment',
        gitUrl: '',
        gitRef: '',
        gitSubpath: '',
        localPath: '',
        localSubpath: '',
        skillMarkdown: '# My Skill',
      },
    })} />);

    // Textarea for skill markdown is present
    expect(screen.getByPlaceholderText(/# My Skill/)).toBeTruthy();
    // No plugin warning
    expect(screen.queryByText(/Plugin direct attachment is not supported/)).toBeNull();
    // Button is enabled
    const addBtn = screen.getByRole('button', { name: 'Add Extension' });
    expect(addBtn).not.toBeDisabled();
  });

  it('renders per-agent extension multiselect with entry name on left and Skill/Plugin on right', () => {
    const skill = makeExtension({ id: 'sk-1', display_name: 'Code Helper', kind: 'skill' });
    const plugin = makeExtension({ id: 'pl-1', display_name: 'Lint Plugin', kind: 'plugin' });
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'agents',
      extensions: [skill, plugin],
      extensionAssignments: { 'provider-planner': ['sk-1'] },
      agents: defaultProps().agents.map((agent) => ({
        ...agent,
        selectedExtensionIds: agent.agent_id === 'provider-planner' ? ['sk-1'] : [],
      })),
    })} />);

    // Lily's assignment list
    const lilyList = screen.getByLabelText('Lily extension assignments');
    expect(lilyList).toBeTruthy();

    // Code Helper entry: label contains name + Skill badge
    const codeHelperLabel = within(lilyList).getByLabelText(/Assign Code Helper \(Skill\) to Lily/i);
    expect(codeHelperLabel).toBeTruthy();
    expect(codeHelperLabel).toBeChecked();

    // Lint Plugin is unchecked for Lily
    const lintLabel = within(lilyList).getByLabelText(/Assign Lint Plugin \(Plugin\) to Lily/i);
    expect(lintLabel).not.toBeChecked();
  });

  it('shows selected extension count in the assignment section label', () => {
    const skill = makeExtension({ id: 'sk-1', display_name: 'Code Helper', kind: 'skill' });
    const plugin = makeExtension({ id: 'pl-1', display_name: 'Lint Plugin', kind: 'plugin' });
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'agents',
      extensions: [skill, plugin],
      extensionAssignments: { 'provider-planner': ['sk-1', 'pl-1'] },
      agents: defaultProps().agents.map((agent) => ({
        ...agent,
        selectedExtensionIds: agent.agent_id === 'provider-planner' ? ['sk-1', 'pl-1'] : [],
      })),
    })} />);

    // "Extensions (2 selected)" label text for Lily
    expect(screen.getByText('Extensions (2 selected)')).toBeTruthy();
  });

  it('calls onToggleExtensionAssignment when a checkbox is toggled', () => {
    const skill = makeExtension({ id: 'sk-1', display_name: 'Code Helper', kind: 'skill' });
    const onToggle = vi.fn();
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'agents',
      extensions: [skill],
      extensionAssignments: { 'provider-planner': [] },
      onToggleExtensionAssignment: onToggle,
    })} />);

    const checkbox = screen.getByLabelText(/Assign Code Helper \(Skill\) to Lily/i);
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith('provider-planner', 'sk-1', true);
  });

  it('renders reseed and delete actions for non-direct-attachment entries', () => {
    const ext = makeExtension({ id: 'sk-1', source_type: 'git' });
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      extensions: [ext],
    })} />);

    expect(screen.getByRole('button', { name: 'Reseed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('does not render reseed button for direct-attachment entries', () => {
    const ext = makeExtension({ id: 'sk-direct', source_type: 'direct-attachment' });
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      extensions: [ext],
    })} />);

    expect(screen.queryByRole('button', { name: 'Reseed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('calls onDeleteExtension when Delete is clicked', () => {
    const ext = makeExtension({ id: 'sk-1', display_name: 'My Skill' });
    const onDelete = vi.fn();
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      extensions: [ext],
      onDeleteExtension: onDelete,
    })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('sk-1');
  });

  it('calls onReseedExtension when Reseed is clicked', () => {
    const ext = makeExtension({ id: 'sk-1', source_type: 'git' });
    const onReseed = vi.fn();
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      extensions: [ext],
      onReseedExtension: onReseed,
    })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reseed' }));
    expect(onReseed).toHaveBeenCalledWith('sk-1');
  });

  it('calls onSaveAssignments when Save Assignments is clicked (isAssignmentsDirty=true)', () => {
    const onSaveAssignments = vi.fn().mockResolvedValue(undefined);
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'agents',
      isAssignmentsDirty: true,
      onSaveAssignments,
    })} />);

    fireEvent.click(screen.getByText('Save Assignments'));
    expect(onSaveAssignments).toHaveBeenCalledTimes(1);
  });

  it('disables Save Assignments when assignments are not dirty', () => {
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'agents',
      isAssignmentsDirty: false,
    })} />);

    const btn = screen.getByText('Save Assignments');
    expect(btn).toBeDisabled();
  });

  // ── Track F confirmation tests ───────────────────────────────────────────────

  it('agents tab renders both human_name and role_name badge for each agent row', () => {
    render(<AgentConfigModal {...defaultProps()} />);

    // Human names
    expect(screen.getByText('Lily')).toBeTruthy();
    expect(screen.getByText('Dalton')).toBeTruthy();

    // Role name badges (type)
    expect(screen.getByText('Planning Specialist')).toBeTruthy();
    expect(screen.getByText('Software Engineer')).toBeTruthy();
  });

  it('Skills & Plugins tab lists catalog entries by display_name', () => {
    const skill = makeExtension({ id: 'ferret-skill', display_name: 'Phase 2 Ferret Skill', kind: 'skill' });
    // Plugin display_name is the manifest slug (lowercase)
    const plugin = makeExtension({
      id: 'cobalt-plugin',
      display_name: 'phase2-cobalt-plugin',
      kind: 'plugin',
      metadata: { plugin_component_classes: ['EchoPlugin'], plugin_skill_count: 1 },
    });

    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      extensions: [skill, plugin],
    })} />);

    expect(screen.getByText('Phase 2 Ferret Skill')).toBeTruthy();
    expect(screen.getByText('phase2-cobalt-plugin')).toBeTruthy();
  });

  it('plugin row shows plugin skills count but does NOT render a Bundled skills line', () => {
    const plugin = makeExtension({
      id: 'cobalt-plugin',
      display_name: 'phase2-cobalt-plugin',
      kind: 'plugin',
      metadata: { plugin_component_classes: ['EchoPlugin'], plugin_skill_count: 1 },
    });

    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      extensions: [plugin],
    })} />);

    // Plugin skill count should appear
    expect(screen.getByText(/plugin skills: 1/)).toBeTruthy();
    // skill_names line ("skills: ...") must NOT appear for a plugin
    expect(screen.queryByText(/^skills:/)).toBeNull();
  });

  it('skill row shows skill_names but NOT plugin_skill_count', () => {
    const skill = makeExtension({
      id: 'ferret-skill',
      display_name: 'Ferret Skill',
      kind: 'skill',
      metadata: { skill_names: ['doThing', 'doOther'] },
    });

    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      extensions: [skill],
    })} />);

    expect(screen.getByText(/skills: doThing, doOther/)).toBeTruthy();
    expect(screen.queryByText(/plugin skills:/)).toBeNull();
  });

  it('agents tab multi-select shows Skill/Plugin kind badge alongside entry name', () => {
    const skill = makeExtension({ id: 'sk-a', display_name: 'My Skill', kind: 'skill' });
    const plugin = makeExtension({
      id: 'pl-b',
      display_name: 'phase2-cobalt-plugin',
      kind: 'plugin',
      metadata: { plugin_component_classes: [] as string[], plugin_skill_count: 0 },
    });

    render(<AgentConfigModal {...defaultProps({
      activeTab: 'agents',
      extensions: [skill, plugin],
      extensionAssignments: {},
    })} />);

    // The aria-label includes both name and kind for each extension entry
    expect(screen.getAllByLabelText(/Assign My Skill \(Skill\) to/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Assign phase2-cobalt-plugin \(Plugin\) to/i).length).toBeGreaterThan(0);
  });

  it('Skills & Plugins tab: reseed button appears for non-direct-attachment entries (manual reseed supported)', () => {
    const localSkill = makeExtension({ id: 'sk-local', source_type: 'local', kind: 'skill', display_name: 'Local Skill' });
    const gitPlugin = makeExtension({ id: 'pl-git', source_type: 'git', kind: 'plugin', display_name: 'Git Plugin', metadata: { plugin_skill_count: 0 } });

    render(<AgentConfigModal {...defaultProps({
      activeTab: 'skills-plugins',
      extensions: [localSkill, gitPlugin],
    })} />);

    const reseedButtons = screen.getAllByRole('button', { name: 'Reseed' });
    expect(reseedButtons).toHaveLength(2);
  });

  it('agent extension multiselect is absent when no extensions are in the catalog (negative)', () => {
    render(<AgentConfigModal {...defaultProps({
      activeTab: 'agents',
      extensions: [],
    })} />);

    // No extension assignment labels rendered when catalog is empty
    expect(screen.queryByLabelText(/extension assignments/i)).toBeNull();
  });

  it('Save Assignments button is only shown on the Agents tab, not Skills & Plugins tab', () => {
    const { rerender } = render(<AgentConfigModal {...defaultProps({ activeTab: 'agents', isAssignmentsDirty: true })} />);
    expect(screen.getByText('Save Assignments')).toBeTruthy();

    rerender(<AgentConfigModal {...defaultProps({ activeTab: 'skills-plugins', isAssignmentsDirty: true })} />);
    expect(screen.queryByText('Save Assignments')).toBeNull();
  });
});
