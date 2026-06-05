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
    activeTab: 'settings',
    onSelectTab: vi.fn(),
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
    logExplorer: {
      loadingFiles: false,
      loadingFile: false,
      error: null,
      sourceLabel: 'TaskSail platform logs',
      categories: {
        info: [
          {
            category: 'info',
            fileName: 'tasksail.jsonl',
            displayName: 'tasksail.jsonl',
            sizeBytes: 120,
            modifiedAt: '2026-06-03T10:00:00.000Z',
            modifiedAtMs: 10,
          },
        ],
        warn: [
          {
            category: 'warn',
            fileName: 'warnings.jsonl',
            displayName: 'warnings.jsonl',
            sizeBytes: 60,
            modifiedAt: '2026-06-03T09:00:00.000Z',
            modifiedAtMs: 9,
          },
        ],
        error: [],
      },
      selectedCategory: 'info',
      selectedLevelFilter: 'all',
      selectedFileName: 'tasksail.jsonl',
      file: {
        action: 'logExplorer.readFile',
        mode: 'read-only',
        message: 'Loaded log file.',
        category: 'info',
        fileName: 'tasksail.jsonl',
        displayName: 'tasksail.jsonl',
        sizeBytes: 120,
        modifiedAt: '2026-06-03T10:00:00.000Z',
        totalLines: 10,
        totalMatchingLines: 2,
        startLine: 4,
        endLine: 9,
        hasOlder: true,
        hasNewer: false,
        levelFilter: 'all',
        records: [
          {
            lineNumber: 4,
            parsed: true,
            prettyJson: '{\n  "level": "debug",\n  "msg": "debug record"\n}',
            raw: '{"level":"debug","msg":"debug record"}',
            summary: { level: 'debug', ts: '2026-06-03T10:00:00.000Z', msg: 'debug record' },
          },
          {
            lineNumber: 9,
            parsed: false,
            prettyJson: '',
            raw: '<img src=x onerror=alert(1)>\n<script>bad</script>',
            parseError: 'Invalid JSON',
            summary: { level: 'other' },
          },
        ],
      },
      onRefresh: vi.fn(),
      onSelectCategory: vi.fn(),
      onSelectLevelFilter: vi.fn(),
      onSelectFile: vi.fn(),
      onOlder: vi.fn(),
      onNewer: vi.fn(),
    },
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

    for (const group of ['Platform', 'Runtime', 'Task Execution', 'Retention', 'External MCP']) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }

    // schema_version is read-only (rendered as text, not an editable control).
    expect(screen.getByTestId('system-settings-schema-version')).toHaveTextContent('1');
  });

  it('renders Settings and Log Explorer tabs with selected state and click handlers', () => {
    const onSelectTab = vi.fn();
    render(<SystemSettingsModal {...baseProps({ onSelectTab })} />);

    expect(screen.getByRole('tablist', { name: 'System Settings sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Log Explorer' })).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByRole('tab', { name: 'Log Explorer' }));
    expect(onSelectTab).toHaveBeenCalledWith('log-explorer');
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

  it('renders Log Explorer controls, hides save actions, and shows icon-only refresh', () => {
    const onRefresh = vi.fn();
    render(
      <SystemSettingsModal
        {...baseProps({
          activeTab: 'log-explorer',
          logExplorer: { ...baseProps().logExplorer, onRefresh },
        })}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'System Settings' })).toHaveStyle('--modal-shell-max-w: 760px');
    expect(screen.getByRole('tab', { name: 'Log Explorer' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Category')).toHaveValue('info');
    expect(screen.getByLabelText('Level')).toHaveValue('all');
    expect(screen.getByLabelText('Log file')).toHaveValue('tasksail.jsonl');
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();

    const refresh = screen.getByRole('button', { name: 'Refresh log files' });
    expect(refresh).toHaveAttribute('title', 'Refresh log files');
    expect(refresh).toHaveTextContent('');
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders debug and malformed records as literal text with pager controls', () => {
    const onOlder = vi.fn();
    const onNewer = vi.fn();
    render(
      <SystemSettingsModal
        {...baseProps({
          activeTab: 'log-explorer',
          logExplorer: { ...baseProps().logExplorer, onOlder, onNewer },
        })}
      />,
    );

    expect(screen.getAllByText('Debug').find((node) =>
      node.classList.contains('system-settings__log-level--debug'),
    )).toBeDefined();
    expect(screen.getByText('Other')).toHaveClass('system-settings__log-level--other');
    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(screen.getByText(/<script>bad<\/script>/)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Older' }));
    expect(onOlder).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Newer' })).not.toBeInTheDocument();
  });

  it('sorts log rows by timestamp descending and expands a clicked row', () => {
    render(
      <SystemSettingsModal
        {...baseProps({
          activeTab: 'log-explorer',
          logExplorer: {
            ...baseProps().logExplorer,
            file: {
              ...baseProps().logExplorer.file!,
              records: [
                {
                  lineNumber: 1,
                  parsed: true,
                  prettyJson: '{\n  "level": "info",\n  "msg": "oldest"\n}',
                  raw: '{"level":"info","msg":"oldest"}',
                  summary: { level: 'info', ts: '2026-06-03T10:00:00.000Z', msg: 'oldest' },
                },
                {
                  lineNumber: 2,
                  parsed: true,
                  prettyJson: '{\n  "level": "error",\n  "msg": "newest"\n}',
                  raw: '{"level":"error","msg":"newest"}',
                  summary: { level: 'error', ts: '2026-06-03T10:02:00.000Z', msg: 'newest' },
                },
                {
                  lineNumber: 3,
                  parsed: true,
                  prettyJson: '{\n  "level": "warn",\n  "msg": "middle"\n}',
                  raw: '{"level":"warn","msg":"middle"}',
                  summary: { level: 'warn', ts: '2026-06-03T10:01:00.000Z', msg: 'middle' },
                },
              ],
            },
          },
        })}
      />,
    );

    expect(screen.getAllByText(/Line [123]/).map((node) => node.textContent)).toEqual([
      'Line 2',
      'Line 3',
      'Line 1',
    ]);

    const row = screen.getByText('newest').closest('details');
    expect(row).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('newest').closest('summary')!);
    expect(row).toHaveAttribute('open');
  });

  it('renders only available log pager buttons', () => {
    render(
      <SystemSettingsModal
        {...baseProps({
          activeTab: 'log-explorer',
          logExplorer: {
            ...baseProps().logExplorer,
            file: {
              ...baseProps().logExplorer.file!,
              hasOlder: false,
              hasNewer: true,
            },
          },
        })}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Older' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Newer' })).toBeInTheDocument();
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

  it('keeps Log Explorer controls enabled while settings are locked by active tasks', () => {
    render(<SystemSettingsModal {...baseProps({ activeTab: 'log-explorer', tasksActive: true })} />);

    expect(screen.queryByText(/locked while a task is running/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Category')).not.toBeDisabled();
    expect(screen.getByLabelText('Level')).not.toBeDisabled();
    expect(screen.getByLabelText('Log file')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh log files' })).not.toBeDisabled();
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
