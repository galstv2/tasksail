import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

import McpConfigModal from './McpConfigModal';
import type { McpConfigModalProps, McpServerFormDraft } from '../../hooks/system-settings/useMcpConfigModal';
import type { ExternalMcpServerEntry, ExternalMcpUrlServerEntry } from '../../../shared/desktopContract';

afterEach(cleanup);

function makeServer(overrides: Partial<ExternalMcpUrlServerEntry> = {}): ExternalMcpServerEntry {
  return {
    id: 'test-mcp',
    display_name: 'Test MCP Server',
    purpose: 'Test',
    enabled: true,
    transport: 'sse',
    url: 'https://mcp.example.com/sse',
    ...overrides,
  };
}

function emptyDraft(): McpServerFormDraft {
  return {
    id: '', display_name: '', purpose: '', preferred_for: '',
    fallback_description: '', transport: 'sse', url: '', headers: [],
    command: '', args: '', env: [], cwd: '', tools: '',
    enabled: true,
  };
}

function defaultProps(overrides: Partial<McpConfigModalProps> = {}): McpConfigModalProps {
  return {
    isOpen: true,
    view: 'list',
    servers: [],
    error: null,
    fieldErrors: {},
    editingServerId: null,
    draft: emptyDraft(),
    connectionValidation: { status: 'idle' },
    localEnabled: false,
    localCommandCheck: { status: 'idle' },
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
    onCheckLocalCommand: vi.fn(),
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

  it('renders the operator vetting notice with status role', () => {
    render(<McpConfigModal {...defaultProps()} />);
    expect(screen.getByRole('status').textContent).toContain('You are responsible for vetting every external MCP server');
  });

  it('renders server list with display name and transport badge', () => {
    const servers = [makeServer()];
    render(<McpConfigModal {...defaultProps({ servers })} />);
    expect(screen.getByText('Test MCP Server')).toBeTruthy();
    expect(screen.getByText('sse')).toBeTruthy();
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
    expect(screen.getByText('Validate Connection')).toBeTruthy();
  });

  it('shows edit title when editing', () => {
    render(<McpConfigModal {...defaultProps({ view: 'form', editingServerId: 'test-mcp' })} />);
    expect(screen.getByText('Edit MCP Server')).toBeTruthy();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<McpConfigModal {...defaultProps({ view: 'form', onCancel })} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

});
