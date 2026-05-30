import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

import McpServerForm from './McpServerForm';
import type { McpConfigModalProps, McpServerFormDraft } from '../hooks/useMcpConfigModal';

afterEach(cleanup);

function emptyDraft(): McpServerFormDraft {
  return {
    id: '', display_name: '', purpose: '', preferred_for: '',
    fallback_description: '', transport: 'sse', url: '', headers: [],
    command: '', args: '', env: [], cwd: '', tools: '',
    agent_ids: [], enabled: true,
  };
}

type FormProps = Pick<
  McpConfigModalProps,
  'draft' | 'editingServerId' | 'connectionValidation' | 'localEnabled' | 'localCommandCheck' | 'fieldErrors' | 'saving' | 'saveEnabled' | 'agentRoster' | 'error' | 'onDraftChange' | 'onValidateConnection' | 'onCheckLocalCommand' | 'onSave' | 'onCancel'
>;

const TEST_AGENT_ROSTER = {
  'provider-builder': { role: 'Software Engineer', humanName: 'Dalton', displayName: 'Dalton (Software Engineer)' },
  'provider-qa': { role: 'QA and Closeout', humanName: 'Ron', displayName: 'Ron (QA and Closeout)' },
  'provider-pm': { role: 'Product Manager', humanName: 'Alice', displayName: 'Alice (Product Manager)' },
};

function defaultProps(overrides: Partial<FormProps> = {}): FormProps {
  return {
    draft: emptyDraft(),
    editingServerId: null,
    connectionValidation: { status: 'idle' },
    localEnabled: false,
    localCommandCheck: { status: 'idle' },
    fieldErrors: {},
    saving: false,
    saveEnabled: false,
    agentRoster: TEST_AGENT_ROSTER,
    error: null,
    onDraftChange: vi.fn(),
    onValidateConnection: vi.fn(),
    onCheckLocalCommand: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe('McpServerForm', () => {
  it('renders all required fields', () => {
    render(<McpServerForm {...defaultProps()} />);
    expect(screen.getByText('Display Name *')).toBeTruthy();
    expect(screen.getByText('Purpose *')).toBeTruthy();
    expect(screen.getByText('URL *')).toBeTruthy();
    expect(screen.getByText('Transport')).toBeTruthy();
    expect(screen.getByText('Agent Scope')).toBeTruthy();
  });

  it('renders Preferred For guidance field', () => {
    render(<McpServerForm {...defaultProps()} />);
    expect(screen.getByText('Preferred For *')).toBeTruthy();
  });

  it('renders Fallback Description field', () => {
    render(<McpServerForm {...defaultProps()} />);
    expect(screen.getByText('Fallback Description (optional)')).toBeTruthy();
  });

  it('renders concise-guidance helper text', () => {
    render(<McpServerForm {...defaultProps()} />);
    expect(screen.getByText(/Describe what this server provides and when an agent should reach for it/)).toBeTruthy();
    expect(screen.getByText('0 / 200, min 20')).toBeTruthy();
    expect(screen.getByText(/one short cue per line/i)).toBeTruthy();
  });

  it('renders the Preferred For required error inline', () => {
    render(<McpServerForm {...defaultProps({
      fieldErrors: { preferred_for: 'Preferred For requires at least one usage cue.' },
    })} />);
    expect(screen.getByText('Preferred For requires at least one usage cue.')).toBeTruthy();
  });

  it('renders Validate Connection button', () => {
    render(<McpServerForm {...defaultProps()} />);
    expect(screen.getByText('Validate Connection')).toBeTruthy();
  });

  it('Save is disabled before validation', () => {
    render(<McpServerForm {...defaultProps()} />);
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save is enabled when saveEnabled is true', () => {
    render(<McpServerForm {...defaultProps({ saveEnabled: true })} />);
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows validation success message', () => {
    render(<McpServerForm {...defaultProps({
      connectionValidation: { status: 'success', message: 'OK', toolCount: 5 },
    })} />);
    expect(screen.getByText(/Connected.*5 tools/)).toBeTruthy();
  });

  it('shows validation failure message', () => {
    render(<McpServerForm {...defaultProps({
      connectionValidation: { status: 'failed', message: 'Timeout' },
    })} />);
    expect(screen.getByText('Timeout')).toBeTruthy();
  });

  it('shows field errors inline', () => {
    render(<McpServerForm {...defaultProps({
      fieldErrors: { purpose: 'Too long.' },
    })} />);
    expect(screen.getByText('Too long.')).toBeTruthy();
  });

  it('shows URL blur error for invalid URL', () => {
    const draft = { ...emptyDraft(), url: 'not-valid' };
    render(<McpServerForm {...defaultProps({ draft })} />);
    fireEvent.blur(screen.getByPlaceholderText('https://mcp.vendor.example/sse'));
    expect(screen.getByText(/valid absolute URL/)).toBeTruthy();
  });

  it('does not show URL blur error for valid URL', () => {
    const draft = { ...emptyDraft(), url: 'https://valid.example.com' };
    render(<McpServerForm {...defaultProps({ draft })} />);
    fireEvent.blur(screen.getByPlaceholderText('https://mcp.vendor.example/sse'));
    expect(screen.queryByText(/valid absolute URL/)).toBeNull();
  });

  it('has read-only ID field in edit mode', () => {
    const draft = { ...emptyDraft(), id: 'existing-id' };
    render(<McpServerForm {...defaultProps({ draft, editingServerId: 'existing-id' })} />);
    const idInput = screen.getByDisplayValue('existing-id');
    expect((idInput as HTMLInputElement).readOnly).toBe(true);
  });

  it('ID field is editable in add mode', () => {
    const draft = { ...emptyDraft(), id: 'auto-generated' };
    render(<McpServerForm {...defaultProps({ draft })} />);
    const idInput = screen.getByDisplayValue('auto-generated') as HTMLInputElement;
    expect(idInput.readOnly).toBe(false);
  });

  it('explains that ID is optional in add mode', () => {
    render(<McpServerForm {...defaultProps()} />);
    expect(screen.getByText('ID (optional)')).toBeTruthy();
    expect(screen.getByText(/auto-generate it from the display name/i)).toBeTruthy();
  });

  it('explains that ID is fixed in edit mode', () => {
    const draft = { ...emptyDraft(), id: 'existing-id' };
    render(<McpServerForm {...defaultProps({ draft, editingServerId: 'existing-id' })} />);
    expect(screen.getByText('ID')).toBeTruthy();
    expect(screen.getByText(/cannot be changed after creation/i)).toBeTruthy();
  });

  it('renders agent scope checkboxes with human names', () => {
    render(<McpServerForm {...defaultProps()} />);
    expect(screen.getByText(/Dalton \(Software Engineer\)/)).toBeTruthy();
    expect(screen.getByText(/Ron \(QA and Closeout\)/)).toBeTruthy();
    expect(screen.getByText(/Alice \(Product Manager\)/)).toBeTruthy();
  });

  it('renders header add button', () => {
    render(<McpServerForm {...defaultProps()} />);
    expect(screen.getByText('+ Add header')).toBeTruthy();
  });

  it('renders header rows and remove buttons', () => {
    const draft = { ...emptyDraft(), headers: [{ key: 'Auth', value: '${TOKEN}' }] };
    render(<McpServerForm {...defaultProps({ draft })} />);
    expect(screen.getByDisplayValue('Auth')).toBeTruthy();
    expect(screen.getByDisplayValue('${TOKEN}')).toBeTruthy();
    expect(screen.getByLabelText('Remove header')).toBeTruthy();
  });

  it('header ${ENV_VAR} values are displayed literally', () => {
    const draft = { ...emptyDraft(), headers: [{ key: 'X-Key', value: '${SECRET}' }] };
    render(<McpServerForm {...defaultProps({ draft })} />);
    expect(screen.getByDisplayValue('${SECRET}')).toBeTruthy();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<McpServerForm {...defaultProps({ onCancel })} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onValidateConnection when validate button clicked', () => {
    const onValidateConnection = vi.fn();
    const draft = { ...emptyDraft(), url: 'https://x.com/sse' };
    render(<McpServerForm {...defaultProps({ draft, onValidateConnection })} />);
    fireEvent.click(screen.getByText('Validate Connection'));
    expect(onValidateConnection).toHaveBeenCalledOnce();
  });

  it('shows submit disabled during mutation', () => {
    render(<McpServerForm {...defaultProps({ saving: true, saveEnabled: false })} />);
    expect(screen.getByText('Saving...')).toBeTruthy();
    expect((screen.getByText('Saving...') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables the Local (stdio) option when localEnabled is false', () => {
    render(<McpServerForm {...defaultProps({ localEnabled: false })} />);
    const localOption = screen.getByText('Local (stdio) — disabled') as HTMLOptionElement;
    expect(localOption.disabled).toBe(true);
  });

  it('enables the Local (stdio) option when localEnabled is true', () => {
    render(<McpServerForm {...defaultProps({ localEnabled: true })} />);
    const localOption = screen.getByText('Local (stdio)') as HTMLOptionElement;
    expect(localOption.disabled).toBe(false);
  });

  it('renders local fields and hides the URL field when transport is local', () => {
    const draft = { ...emptyDraft(), transport: 'local' as const };
    render(<McpServerForm {...defaultProps({ draft, localEnabled: true })} />);
    expect(screen.getByText("Local servers launch as a child process with the agent's OS permissions at each run.")).toBeTruthy();
    expect(screen.getByText('Command *')).toBeTruthy();
    expect(screen.getByText('Tools *')).toBeTruthy();
    expect(screen.queryByText('URL *')).toBeNull();
    // The local affordance is the advisory command check, not the network probe.
    expect(screen.getByText('Check command')).toBeTruthy();
    expect(screen.queryByText('Validate Connection')).toBeNull();
  });

  it('does not render the local child-process note for remote transports', () => {
    render(<McpServerForm {...defaultProps()} />);
    expect(screen.queryByText(/Local servers launch as a child process/)).toBeNull();
  });

  it('calls onCheckLocalCommand when the Check command button is clicked', () => {
    const onCheckLocalCommand = vi.fn();
    const draft = { ...emptyDraft(), transport: 'local' as const, command: 'npx' };
    render(<McpServerForm {...defaultProps({ draft, localEnabled: true, onCheckLocalCommand })} />);
    fireEvent.click(screen.getByText('Check command'));
    expect(onCheckLocalCommand).toHaveBeenCalledOnce();
  });

  it('Save is gated to enabled only when saveEnabled is true for a local draft', () => {
    const draft = { ...emptyDraft(), transport: 'local' as const, command: 'npx', tools: 'read_file' };
    const { rerender } = render(<McpServerForm {...defaultProps({ draft, localEnabled: true, saveEnabled: false })} />);
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
    rerender(<McpServerForm {...defaultProps({ draft, localEnabled: true, saveEnabled: true })} />);
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(false);
  });
});
