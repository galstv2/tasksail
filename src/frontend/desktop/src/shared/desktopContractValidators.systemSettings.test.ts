import { describe, expect, it } from 'vitest';

import {
  validateDesktopActionRequest,
  isValidDesktopActionRequest,
} from './desktopContractValidators';

const validConfig = {
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
  repo_context_mcp_external_mount_roots: ['/abs/mount'],
};

describe('systemSettings request validation', () => {
  it('accepts systemSettings.read with no payload', () => {
    expect(validateDesktopActionRequest({ action: 'systemSettings.read' })).toEqual([]);
    expect(isValidDesktopActionRequest({ action: 'systemSettings.read' })).toBe(true);
  });

  it('rejects systemSettings.read with a payload', () => {
    expect(validateDesktopActionRequest({ action: 'systemSettings.read', payload: {} })).toEqual([
      'payload must be omitted.',
    ]);
  });

  it('accepts a valid systemSettings.save payload', () => {
    expect(
      validateDesktopActionRequest({
        action: 'systemSettings.save',
        payload: { baseDefaultFileHash: 'abc123', config: validConfig },
      }),
    ).toEqual([]);
  });

  it('rejects a save payload missing baseDefaultFileHash', () => {
    expect(
      validateDesktopActionRequest({
        action: 'systemSettings.save',
        payload: { config: validConfig },
      }),
    ).toContain('payload.baseDefaultFileHash must be a non-empty string.');
  });

  it('rejects invalid enum, port, wsl distro, and relative mount roots', () => {
    const errors = validateDesktopActionRequest({
      action: 'systemSettings.save',
      payload: {
        baseDefaultFileHash: 'abc123',
        config: {
          ...validConfig,
          container_runtime: 'kvm',
          mcp_port: 70000,
          container_engine_host: 'wsl',
          container_engine_wsl_distro: 'a/b',
          repo_context_mcp_external_mount_roots: ['relative/path'],
        },
      },
    });
    const joined = errors.join(' ');
    expect(joined).toContain('payload.config.container_runtime');
    expect(joined).toContain('payload.config.mcp_port');
    expect(joined).toContain('payload.config.container_engine_wsl_distro');
    expect(joined).toContain('payload.config.repo_context_mcp_external_mount_roots');
  });

  it('rejects non-integer/out-of-range counts and invalid schema_version', () => {
    const errors = validateDesktopActionRequest({
      action: 'systemSettings.save',
      payload: {
        baseDefaultFileHash: 'abc123',
        config: {
          ...validConfig,
          schema_version: 2,
          max_parallel_tasks: 0,
          max_retained_failed_task_worktrees: -1,
        },
      },
    });
    const joined = errors.join(' ');
    expect(joined).toContain('payload.config.schema_version');
    expect(joined).toContain('payload.config.max_parallel_tasks');
    expect(joined).toContain('payload.config.max_retained_failed_task_worktrees');
  });

  it('rejects a non-object save payload', () => {
    expect(
      validateDesktopActionRequest({ action: 'systemSettings.save', payload: null }),
    ).toEqual(['payload must be an object.']);
  });

  it('accepts systemSettings.restart with no payload and rejects a payload', () => {
    expect(validateDesktopActionRequest({ action: 'systemSettings.restart' })).toEqual([]);
    expect(
      validateDesktopActionRequest({ action: 'systemSettings.restart', payload: {} }),
    ).toEqual(['payload must be omitted.']);
  });

  it('rejects an absolute mount root containing parent traversal', () => {
    const errors = validateDesktopActionRequest({
      action: 'systemSettings.save',
      payload: {
        baseDefaultFileHash: 'abc123',
        config: { ...validConfig, repo_context_mcp_external_mount_roots: ['/abs/../escape'] },
      },
    });
    expect(errors.join(' ')).toContain('payload.config.repo_context_mcp_external_mount_roots');
  });
});
