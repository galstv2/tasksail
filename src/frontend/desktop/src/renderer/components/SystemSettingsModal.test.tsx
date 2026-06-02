// @vitest-environment jsdom

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SystemSettingsModal from './SystemSettingsModal';
import type { SystemSettingsModalProps } from '../hooks/useSystemSettingsModal';
import type { SystemSettingsPlatformConfig } from '../../shared/desktopContract';

expect.extend(matchers);
afterEach(() => cleanup());

const DRAFT: SystemSettingsPlatformConfig = {
  schema_version: 1,
  cli_provider: 'copilot',
  slice_artifact_format: 'markdown',
  container_runtime: 'direct',
  container_engine_host: 'auto',
  container_engine_wsl_distro: null,
  max_parallel_tasks: 10,
  retain_failed_task_worktrees: true,
  max_retained_failed_task_worktrees: 10,
  max_retry_generations_per_slug: 5,
  completed_task_runtime_retention_ms: 3600000,
  auto_merge: false,
  external_mcp_local_enabled: true,
  mcp_port: 8811,
  repo_context_mcp_external_mount_roots: [],
};

function baseProps(overrides: Partial<SystemSettingsModalProps> = {}): SystemSettingsModalProps {
  return {
    isOpen: true,
    loading: false,
    saving: false,
    error: null,
    success: null,
    draft: DRAFT,
    fieldErrors: {},
    envOverrides: [],
    runtimeWarning: null,
    runtimeStatus: 'valid',
    tasksActive: false,
    dirty: true,
    saveDisabled: false,
    confirmRestartOpen: false,
    mountRootsText: '',
    onClose: vi.fn(),
    onFieldChange: vi.fn(),
    onMountRootsTextChange: vi.fn(),
    onSave: vi.fn(),
    onConfirmRestart: vi.fn(),
    onCancelRestart: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  };
}

describe('SystemSettingsModal', () => {
  it('renders the grouped structured controls with read-only schema version', () => {
    render(<SystemSettingsModal {...baseProps()} />);

    expect(screen.getByRole('dialog', { name: 'System Settings' })).toBeInTheDocument();
    expect(screen.getByText('config/platform.default.json')).toBeInTheDocument();

    for (const group of ['Platform', 'Runtime', 'Task Execution', 'Retention', 'External MCP']) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }

    // schema_version is read-only (rendered as text, not an editable control).
    expect(screen.getByTestId('system-settings-schema-version')).toHaveTextContent('1');
  });

  it('uses the correct control type for each field kind', () => {
    render(<SystemSettingsModal {...baseProps()} />);

    expect(screen.getByLabelText('Slice artifact format').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Container runtime').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Container engine host').tagName).toBe('SELECT');

    expect(screen.getByLabelText('Auto merge')).toHaveAttribute('type', 'checkbox');
    expect(screen.getByLabelText('Retain failed task worktrees')).toHaveAttribute('type', 'checkbox');
    expect(screen.getByLabelText('Enable local external MCP')).toHaveAttribute('type', 'checkbox');

    expect(screen.getByLabelText('Max parallel tasks')).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText('MCP port')).toHaveAttribute('type', 'number');

    expect(screen.getByLabelText('CLI provider')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('WSL distro')).toHaveAttribute('type', 'text');

    expect(screen.getByLabelText('External mount roots').tagName).toBe('TEXTAREA');
  });

  it('renders ModalShell footer buttons with the existing action-button classes', () => {
    render(<SystemSettingsModal {...baseProps()} />);

    const discard = screen.getByRole('button', { name: 'Discard' });
    const save = screen.getByRole('button', { name: 'Save Changes' });

    expect(discard).toHaveClass('action-button');
    expect(discard).not.toHaveClass('action-button--primary');
    expect(save).toHaveClass('action-button');
    expect(save).toHaveClass('action-button--primary');
  });

  it('shows env override and runtime repair warnings without implying env edits', () => {
    render(
      <SystemSettingsModal
        {...baseProps({
          runtimeStatus: 'missing',
          runtimeWarning: 'Runtime platform config is missing or invalid. A valid save will recreate it.',
          envOverrides: [
            { field: 'container_runtime', envVar: 'CONTAINER_RUNTIME', value: 'podman', scope: 'effective-config' },
          ],
        })}
      />,
    );

    expect(screen.getByText(/missing or invalid/)).toBeInTheDocument();
    expect(
      screen.getByText(/Environment override active: CONTAINER_RUNTIME currently affects container_runtime/),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not change this environment variable/)).toBeInTheDocument();
  });

  it('disables Save Changes when saveDisabled and invokes handlers on click', () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const { rerender } = render(
      <SystemSettingsModal {...baseProps({ saveDisabled: true, onSave, onDiscard })} />,
    );
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    rerender(<SystemSettingsModal {...baseProps({ saveDisabled: false, onSave, onDiscard })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('routes mount-root textarea edits through onMountRootsTextChange', () => {
    const onMountRootsTextChange = vi.fn();
    render(<SystemSettingsModal {...baseProps({ onMountRootsTextChange })} />);

    fireEvent.change(screen.getByLabelText('External mount roots'), {
      target: { value: '/abs/mount' },
    });
    expect(onMountRootsTextChange).toHaveBeenCalledWith('/abs/mount');
  });

  it('renders a loading state when the draft is not yet available', () => {
    render(<SystemSettingsModal {...baseProps({ loading: true, draft: null })} />);
    expect(screen.getByText('Loading platform settings…')).toBeInTheDocument();
  });

  it('locks every control and shows a banner while a task is active', () => {
    render(<SystemSettingsModal {...baseProps({ tasksActive: true })} />);

    expect(screen.getByText(/locked while a task is running/i)).toBeInTheDocument();
    // Disabled fieldsets cascade the disabled state to all descendant controls.
    expect(screen.getByLabelText('CLI provider')).toBeDisabled();
    expect(screen.getByLabelText('Container runtime')).toBeDisabled();
    expect(screen.getByLabelText('Auto merge')).toBeDisabled();
    expect(screen.getByLabelText('MCP port')).toBeDisabled();
    expect(screen.getByLabelText('External mount roots')).toBeDisabled();
  });

  it('renders the restart confirmation and wires confirm/cancel handlers', () => {
    const onConfirmRestart = vi.fn();
    const onCancelRestart = vi.fn();
    render(
      <SystemSettingsModal
        {...baseProps({ confirmRestartOpen: true, onConfirmRestart, onCancelRestart })}
      />,
    );

    expect(screen.getByText('Restart TaskSail?')).toBeInTheDocument();
    expect(screen.getByText(/requires TaskSail to restart/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save.*restart/i }));
    expect(onConfirmRestart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancelRestart).toHaveBeenCalledTimes(1);
  });
});
