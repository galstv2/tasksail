// @vitest-environment jsdom

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { createMockClient } from '../../test/factories/clientFactory';
import { useSystemSettingsModal } from './useSystemSettingsModal';
import type {
  DesktopInvokeResult,
  SystemSettingsPlatformConfig,
} from '../../shared/desktopContract';

const BASE_CONFIG: SystemSettingsPlatformConfig = {
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

function readResult(
  overrides: Partial<{
    config: SystemSettingsPlatformConfig;
    defaultFileHash: string;
    runtimeStatus: 'valid' | 'missing' | 'invalid';
    runtimeWarning: string | null;
    tasksActive: boolean;
    envOverrides: Array<{ field: string; envVar: string; value: string; scope: string }>;
  }> = {},
): DesktopInvokeResult {
  return {
    ok: true,
    response: {
      action: 'systemSettings.read',
      mode: 'read-only',
      message: 'Loaded platform settings.',
      defaultConfigPath: '/repo/config/platform.default.json',
      runtimeConfigPath: '/repo/.platform-state/platform.json',
      defaultFileHash: overrides.defaultFileHash ?? 'hash-1',
      runtimeFileHash: 'rt-1',
      config: overrides.config ?? BASE_CONFIG,
      runtimeConfig: overrides.config ?? BASE_CONFIG,
      runtimeStatus: overrides.runtimeStatus ?? 'valid',
      runtimeWarning: overrides.runtimeWarning ?? null,
      tasksActive: overrides.tasksActive ?? false,
      envOverrides: (overrides.envOverrides ?? []) as never,
    },
  } as DesktopInvokeResult;
}

async function openAndLoad(client = createMockClient({ readSystemSettings: vi.fn().mockResolvedValue(readResult()) })) {
  const view = renderHook(() => useSystemSettingsModal(client));
  act(() => {
    view.result.current.openSystemSettingsModal();
  });
  await waitFor(() => expect(view.result.current.systemSettingsModalProps.draft).not.toBeNull());
  return view;
}

describe('useSystemSettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads settings into the draft with hash, runtime warning, and env overrides', async () => {
    const client = createMockClient({
      readSystemSettings: vi.fn().mockResolvedValue(
        readResult({
          defaultFileHash: 'abc',
          runtimeStatus: 'missing',
          runtimeWarning: 'Runtime platform config is missing or invalid.',
          envOverrides: [{ field: 'mcp_port', envVar: 'X', value: '1', scope: 'effective-config' }],
        }),
      ),
    });
    const { result } = await openAndLoad(client);
    const props = result.current.systemSettingsModalProps;

    expect(props.draft?.cli_provider).toBe('copilot');
    expect(props.runtimeWarning).toContain('missing or invalid');
    expect(props.runtimeStatus).toBe('missing');
    expect(props.envOverrides).toHaveLength(1);
    expect(props.dirty).toBe(false);
    expect(props.saveDisabled).toBe(true);
  });

  it('marks the draft dirty when a field changes', async () => {
    const { result } = await openAndLoad();
    expect(result.current.systemSettingsModalProps.dirty).toBe(false);

    act(() => {
      result.current.systemSettingsModalProps.onFieldChange('auto_merge', true);
    });

    expect(result.current.systemSettingsModalProps.draft?.auto_merge).toBe(true);
    expect(result.current.systemSettingsModalProps.dirty).toBe(true);
    expect(result.current.systemSettingsModalProps.saveDisabled).toBe(false);
  });

  it('blocks save on invalid mcp_port, counts, WSL distro, and relative mount roots', async () => {
    const { result } = await openAndLoad();

    act(() => {
      result.current.systemSettingsModalProps.onFieldChange('mcp_port', 70000);
    });
    expect(result.current.systemSettingsModalProps.fieldErrors.mcp_port).toBeDefined();
    expect(result.current.systemSettingsModalProps.saveDisabled).toBe(true);

    act(() => {
      result.current.systemSettingsModalProps.onFieldChange('mcp_port', 8811);
      result.current.systemSettingsModalProps.onFieldChange('max_parallel_tasks', 0);
    });
    expect(result.current.systemSettingsModalProps.fieldErrors.max_parallel_tasks).toBeDefined();

    act(() => {
      result.current.systemSettingsModalProps.onFieldChange('max_parallel_tasks', 10);
      result.current.systemSettingsModalProps.onFieldChange('container_engine_host', 'wsl');
      result.current.systemSettingsModalProps.onFieldChange('container_engine_wsl_distro', 'a/b');
    });
    expect(result.current.systemSettingsModalProps.fieldErrors.container_engine_wsl_distro).toBeDefined();

    act(() => {
      result.current.systemSettingsModalProps.onMountRootsTextChange('relative/path');
    });
    expect(
      result.current.systemSettingsModalProps.fieldErrors.repo_context_mcp_external_mount_roots,
    ).toBeDefined();
    expect(result.current.systemSettingsModalProps.saveDisabled).toBe(true);
  });

  it('maps the mount-roots textarea to an absolute-path array', async () => {
    const { result } = await openAndLoad();

    act(() => {
      result.current.systemSettingsModalProps.onMountRootsTextChange('/abs/one\n  /abs/two  \n\n');
    });

    expect(result.current.systemSettingsModalProps.draft?.repo_context_mcp_external_mount_roots).toEqual([
      '/abs/one',
      '/abs/two',
    ]);
    expect(
      result.current.systemSettingsModalProps.fieldErrors.repo_context_mcp_external_mount_roots,
    ).toBeUndefined();
  });

  it('flags a mount root with parent traversal as invalid (mirrors the IPC validator)', async () => {
    const { result } = await openAndLoad();

    act(() => {
      result.current.systemSettingsModalProps.onMountRootsTextChange('/abs/../escape');
    });

    expect(
      result.current.systemSettingsModalProps.fieldErrors.repo_context_mcp_external_mount_roots,
    ).toBeDefined();
    expect(result.current.systemSettingsModalProps.saveDisabled).toBe(true);
  });

  it('opens the restart confirmation on Save Changes, then saves and restarts on confirm', async () => {
    const saveSystemSettings = vi.fn(async (payload: { baseDefaultFileHash: string; config: SystemSettingsPlatformConfig }) => ({
      ok: true,
      response: {
        action: 'systemSettings.save',
        mode: 'saved',
        message: 'Saved platform settings.',
        defaultConfigPath: '/repo/config/platform.default.json',
        runtimeConfigPath: '/repo/.platform-state/platform.json',
        defaultFileHash: 'hash-2',
        runtimeFileHash: 'rt-2',
        config: payload.config,
        runtimeConfig: payload.config,
        runtimeStatus: 'valid',
        runtimeWarning: null,
        tasksActive: false,
        envOverrides: [],
      },
    } as DesktopInvokeResult));
    const client = createMockClient({
      readSystemSettings: vi.fn().mockResolvedValue(readResult({ defaultFileHash: 'hash-1' })),
      saveSystemSettings,
    });
    const { result } = await openAndLoad(client);

    act(() => {
      result.current.systemSettingsModalProps.onFieldChange('auto_merge', true);
    });
    // Save Changes opens the confirmation; nothing is persisted yet.
    act(() => {
      result.current.systemSettingsModalProps.onSave();
    });
    expect(result.current.systemSettingsModalProps.confirmRestartOpen).toBe(true);
    expect(saveSystemSettings).not.toHaveBeenCalled();

    await act(async () => {
      result.current.systemSettingsModalProps.onConfirmRestart();
    });

    expect(saveSystemSettings).toHaveBeenCalledWith({
      baseDefaultFileHash: 'hash-1',
      config: expect.objectContaining({ auto_merge: true }),
    });
    await waitFor(() => expect(client.restartTaskSail).toHaveBeenCalled());
    expect(result.current.systemSettingsModalProps.confirmRestartOpen).toBe(false);
    expect(result.current.systemSettingsModalProps.dirty).toBe(false);
    expect(result.current.systemSettingsModalProps.draft?.auto_merge).toBe(true);
  });

  it('cancels the restart confirmation without saving', async () => {
    const saveSystemSettings = vi.fn();
    const client = createMockClient({
      readSystemSettings: vi.fn().mockResolvedValue(readResult()),
      saveSystemSettings,
    });
    const { result } = await openAndLoad(client);

    act(() => {
      result.current.systemSettingsModalProps.onFieldChange('auto_merge', true);
      result.current.systemSettingsModalProps.onSave();
    });
    expect(result.current.systemSettingsModalProps.confirmRestartOpen).toBe(true);

    act(() => {
      result.current.systemSettingsModalProps.onCancelRestart();
    });
    expect(result.current.systemSettingsModalProps.confirmRestartOpen).toBe(false);
    expect(saveSystemSettings).not.toHaveBeenCalled();
  });

  it('locks save while a task is active', async () => {
    const client = createMockClient({
      readSystemSettings: vi.fn().mockResolvedValue(readResult({ tasksActive: true })),
    });
    const { result } = await openAndLoad(client);

    expect(result.current.systemSettingsModalProps.tasksActive).toBe(true);
    act(() => {
      result.current.systemSettingsModalProps.onFieldChange('auto_merge', true);
    });
    expect(result.current.systemSettingsModalProps.dirty).toBe(true);
    expect(result.current.systemSettingsModalProps.saveDisabled).toBe(true);
  });

  it('preserves draft edits when the save fails', async () => {
    const client = createMockClient({
      readSystemSettings: vi.fn().mockResolvedValue(readResult()),
      saveSystemSettings: vi.fn().mockResolvedValue({ ok: false, error: 'disk error' } as DesktopInvokeResult),
    });
    const { result } = await openAndLoad(client);

    act(() => {
      result.current.systemSettingsModalProps.onFieldChange('mcp_port', 9000);
      result.current.systemSettingsModalProps.onSave();
    });
    await act(async () => {
      result.current.systemSettingsModalProps.onConfirmRestart();
    });

    await waitFor(() => expect(result.current.systemSettingsModalProps.error).toBe('disk error'));
    expect(result.current.systemSettingsModalProps.draft?.mcp_port).toBe(9000);
    expect(result.current.systemSettingsModalProps.dirty).toBe(true);
    expect(client.restartTaskSail).not.toHaveBeenCalled();
  });

  it('surfaces a stale-hash conflict as an actionable reload message', async () => {
    const client = createMockClient({
      readSystemSettings: vi.fn().mockResolvedValue(readResult()),
      saveSystemSettings: vi.fn().mockResolvedValue({
        ok: false,
        error: 'config/platform.default.json changed since this modal loaded. Reload settings before saving.',
        errorCode: 'version_conflict',
      } as DesktopInvokeResult),
    });
    const { result } = await openAndLoad(client);

    act(() => {
      result.current.systemSettingsModalProps.onFieldChange('auto_merge', true);
      result.current.systemSettingsModalProps.onSave();
    });
    await act(async () => {
      result.current.systemSettingsModalProps.onConfirmRestart();
    });

    await waitFor(() =>
      expect(result.current.systemSettingsModalProps.error).toContain('Reload settings'),
    );
  });

  it('restores the saved config on discard', async () => {
    const { result } = await openAndLoad();

    act(() => {
      result.current.systemSettingsModalProps.onFieldChange('auto_merge', true);
    });
    expect(result.current.systemSettingsModalProps.dirty).toBe(true);

    act(() => {
      result.current.systemSettingsModalProps.onDiscard();
    });
    expect(result.current.systemSettingsModalProps.draft?.auto_merge).toBe(false);
    expect(result.current.systemSettingsModalProps.dirty).toBe(false);
  });
});
