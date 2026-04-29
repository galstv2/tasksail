import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

import McpConfigModal from './McpConfigModal';
import type { McpConfigModalProps, McpServerFormDraft } from '../hooks/useMcpConfigModal';
import type { ExternalMcpServerEntry } from '../../shared/desktopContract';

afterEach(cleanup);

function makeServer(overrides: Partial<ExternalMcpServerEntry> = {}): ExternalMcpServerEntry {
  return {
    id: 'test-mcp',
    display_name: 'Test MCP Server',
    purpose: 'Test',
    enabled: true,
    transport: 'sse',
    url: 'https://mcp.example.com/sse',
    agent_scope: { mode: 'allowlist', agent_ids: ['swe', 'qa'] },
    ...overrides,
  };
}

function emptyDraft(): McpServerFormDraft {
  return {
    id: '', display_name: '', purpose: '', preferred_for: '',
    fallback_description: '', url: '', transport: 'sse',
    headers: [], agent_ids: [], enabled: true,
  };
}

const TEST_AGENT_ROSTER = {
  'software-engineer': { role: 'Software Engineer', humanName: 'Dalton', displayName: 'Dalton (Software Engineer)' },
  qa: { role: 'QA and Closeout', humanName: 'Ron', displayName: 'Ron (QA and Closeout)' },
  'product-manager': { role: 'Product Manager', humanName: 'Alice', displayName: 'Alice (Product Manager)' },
  'planning-agent': { role: 'Planning Specialist', humanName: 'Lily', displayName: 'Lily (Planning Specialist)' },
};

function defaultProps(overrides: Partial<McpConfigModalProps> = {}): McpConfigModalProps {
  return {
    isOpen: true,
    view: 'list',
    servers: [],
    error: null,
    fieldErrors: {},
    editingServerId: null,
    draft: emptyDraft(),
    agentRoster: TEST_AGENT_ROSTER,
    connectionValidation: { status: 'idle' },
    removingServerId: null,
    saving: false,
    saveEnabled: false,
    onClose: vi.fn(),
    onToggleEnabled: vi.fn(),
    onRemove: vi.fn(),
    onConfirmRemove: vi.fn(),
    onCancelRemove: vi.fn(),
    onEdit: vi.fn(),
    onAdd: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    onValidateConnection: vi.fn(),
    onDraftChange: vi.fn(),
    ...overrides,
  };
}

describe('McpConfigModal — list view', () => {
  it('returns null when closed', () => {
    const { container } = render(<McpConfigModal {...defaultProps({ isOpen: false })} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows empty state with add button when no servers', () => {
    render(<McpConfigModal {...defaultProps()} />);
    expect(screen.getByText('No external MCP servers configured.')).toBeTruthy();
    expect(screen.getByText('Add Server')).toBeTruthy();
  });

  it('renders server list with display name and badges', () => {
    const servers = [makeServer()];
    render(<McpConfigModal {...defaultProps({ servers })} />);
    expect(screen.getByText('Test MCP Server')).toBeTruthy();
    expect(screen.getByText('sse')).toBeTruthy();
    expect(screen.getByText('2 agents')).toBeTruthy();
  });

  it('shows "all agents" badge when all workflow agents are selected', () => {
    const allAgentIds = [
      'planning-agent', 'product-manager', 'software-engineer', 'qa',
    ];
    const servers = [makeServer({ agent_scope: { mode: 'allowlist', agent_ids: allAgentIds } })];
    render(<McpConfigModal {...defaultProps({ servers })} />);
    expect(screen.getByText('all agents')).toBeTruthy();
  });

  it('renders edit and remove buttons per server row', () => {
    const servers = [makeServer()];
    render(<McpConfigModal {...defaultProps({ servers })} />);
    expect(screen.getByLabelText('Edit Test MCP Server')).toBeTruthy();
    expect(screen.getByLabelText('Remove Test MCP Server')).toBeTruthy();
  });

  it('calls onToggleEnabled when checkbox changes', () => {
    const onToggleEnabled = vi.fn();
    const servers = [makeServer()];
    render(<McpConfigModal {...defaultProps({ servers, onToggleEnabled })} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleEnabled).toHaveBeenCalledWith('test-mcp');
  });

  it('calls onEdit when edit button clicked', () => {
    const onEdit = vi.fn();
    const servers = [makeServer()];
    render(<McpConfigModal {...defaultProps({ servers, onEdit })} />);
    fireEvent.click(screen.getByLabelText('Edit Test MCP Server'));
    expect(onEdit).toHaveBeenCalledWith('test-mcp');
  });

  it('shows inline remove confirmation', () => {
    const servers = [makeServer()];
    render(<McpConfigModal {...defaultProps({ servers, removingServerId: 'test-mcp' })} />);
    expect(screen.getByText('Remove?')).toBeTruthy();
    expect(screen.getByText('Confirm')).toBeTruthy();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<McpConfigModal {...defaultProps({ onClose })} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error message', () => {
    render(<McpConfigModal {...defaultProps({ error: 'Something went wrong' })} />);
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong');
  });
});

describe('McpConfigModal — form view', () => {
  it('renders form with required fields when adding', () => {
    render(<McpConfigModal {...defaultProps({ view: 'form' })} />);
    expect(screen.getByText('Add MCP Server')).toBeTruthy();
    expect(screen.getByText('Display Name *')).toBeTruthy();
    expect(screen.getByText('Purpose *')).toBeTruthy();
    expect(screen.getByText('URL *')).toBeTruthy();
    expect(screen.getByText('Transport')).toBeTruthy();
    expect(screen.getByText('Agent Scope')).toBeTruthy();
    expect(screen.getByText('Validate Connection')).toBeTruthy();
  });

  it('renders preferred_for and fallback_description fields', () => {
    render(<McpConfigModal {...defaultProps({ view: 'form' })} />);
    expect(screen.getByText('Preferred For (optional)')).toBeTruthy();
    expect(screen.getByText('Fallback Description (optional)')).toBeTruthy();
  });

  it('shows helper text for guidance fields', () => {
    render(<McpConfigModal {...defaultProps({ view: 'form' })} />);
    expect(screen.getByText(/injected into agent context/)).toBeTruthy();
  });

  it('Save is disabled before connection validation', () => {
    render(<McpConfigModal {...defaultProps({ view: 'form' })} />);
    const saveBtn = screen.getByText('Save');
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows edit title when editing', () => {
    render(<McpConfigModal {...defaultProps({ view: 'form', editingServerId: 'test-mcp' })} />);
    expect(screen.getByText('Edit MCP Server')).toBeTruthy();
  });

  it('calls onValidateConnection when validate button clicked', () => {
    const onValidateConnection = vi.fn();
    const draft = { ...emptyDraft(), url: 'https://example.com/sse' };
    render(<McpConfigModal {...defaultProps({ view: 'form', draft, onValidateConnection })} />);
    fireEvent.click(screen.getByText('Validate Connection'));
    expect(onValidateConnection).toHaveBeenCalled();
  });

  it('shows validation success message', () => {
    render(<McpConfigModal {...defaultProps({
      view: 'form',
      connectionValidation: { status: 'success', message: 'Connected to server.' },
    })} />);
    expect(screen.getByText(/Connected/)).toBeTruthy();
  });

  it('shows validation failure message', () => {
    render(<McpConfigModal {...defaultProps({
      view: 'form',
      connectionValidation: { status: 'failed', message: 'Connection refused' },
    })} />);
    expect(screen.getByText('Connection refused')).toBeTruthy();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<McpConfigModal {...defaultProps({ view: 'form', onCancel })} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows field errors inline', () => {
    render(<McpConfigModal {...defaultProps({
      view: 'form',
      fieldErrors: { purpose: 'Purpose is too long.' },
    })} />);
    expect(screen.getByText('Purpose is too long.')).toBeTruthy();
  });

  it('renders agent scope checkboxes with human names', () => {
    render(<McpConfigModal {...defaultProps({ view: 'form' })} />);
    expect(screen.getByText(/Dalton \(Software Engineer\)/)).toBeTruthy();
    expect(screen.getByText(/Ron \(QA and Closeout\)/)).toBeTruthy();
  });

  it('shows URL validation error on blur for invalid URL', () => {
    const draft = { ...emptyDraft(), url: 'not-a-url' };
    render(<McpConfigModal {...defaultProps({ view: 'form', draft })} />);
    const urlInput = screen.getByPlaceholderText('https://mcp.vendor.example/sse');
    fireEvent.blur(urlInput);
    expect(screen.getByText(/valid absolute URL/)).toBeTruthy();
  });

  it('does not show URL blur error for valid URL', () => {
    const draft = { ...emptyDraft(), url: 'https://mcp.example.com/sse' };
    render(<McpConfigModal {...defaultProps({ view: 'form', draft })} />);
    const urlInput = screen.getByPlaceholderText('https://mcp.vendor.example/sse');
    fireEvent.blur(urlInput);
    expect(screen.queryByText(/valid absolute URL/)).toBeNull();
  });
});
