// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackSwitchPayload } from '../../../src/shared/desktopContract';
import type { ContextPackWorkspaceScriptRunner } from './shared';

const { setActiveContextPackEnvMock, errorSpy } = vi.hoisted(() => ({
  setActiveContextPackEnvMock: vi.fn(),
  errorSpy: vi.fn(),
}));

vi.mock('../../../../../backend/platform/context-pack/activate', () => ({
  setActiveContextPackEnv: setActiveContextPackEnvMock,
}));

vi.mock('../../log/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: errorSpy,
    child: vi.fn(),
  }),
}));

const APPLY_PAYLOAD = {
  contextPackDir: '/contextpacks/orders',
  scopeMode: 'focused',
  selectedRepoIds: ['orders-api'],
  selectedFocusIds: [],
  deepFocusEnabled: false,
} as unknown as ContextPackSwitchPayload;

function runnerReturning(stdout: string): ContextPackWorkspaceScriptRunner {
  return vi.fn().mockResolvedValue({ stdout, stderr: '', exitCode: 0 }) as unknown as
    ContextPackWorkspaceScriptRunner;
}

describe('executeContextPackWorkspaceAction env-activation boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    setActiveContextPackEnvMock.mockReset();
    errorSpy.mockReset();
  });

  it('logs a structured error and fails the action when post-apply env activation throws', async () => {
    setActiveContextPackEnvMock.mockRejectedValue(new Error('env write denied'));
    const runner = runnerReturning(JSON.stringify({
      ok: true,
      action: 'apply',
      workspace: { context_pack_id: 'orders', context_pack_dir: '/contextpacks/orders' },
    }));
    const { executeContextPackWorkspaceAction } = await import('./workspace');

    const result = await executeContextPackWorkspaceAction(
      'contextPack.applySwitch',
      'apply',
      APPLY_PAYLOAD,
      runner,
    );

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      'context-pack.workspace.activate-env.failed',
      expect.any(Error),
      expect.objectContaining({
        wrapperAction: 'apply',
        contextPackDir: '/contextpacks/orders',
      }),
    );
  });

  it('logs a structured error and fails the action when clear-time env reset throws', async () => {
    setActiveContextPackEnvMock.mockRejectedValue(new Error('env clear denied'));
    const runner = runnerReturning(JSON.stringify({
      ok: true,
      action: 'clear',
      workspace: {},
    }));
    const { executeContextPackWorkspaceAction } = await import('./workspace');

    const result = await executeContextPackWorkspaceAction(
      'contextPack.clearActive',
      'clear',
      undefined,
      runner,
    );

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      'context-pack.workspace.activate-env.failed',
      expect.any(Error),
      expect.objectContaining({ wrapperAction: 'clear' }),
    );
  });

  it('does not log the env-activation error on the happy path', async () => {
    setActiveContextPackEnvMock.mockResolvedValue(undefined);
    const runner = runnerReturning(JSON.stringify({
      ok: true,
      action: 'apply',
      workspace: { context_pack_id: 'orders', context_pack_dir: '/contextpacks/orders' },
    }));
    const { executeContextPackWorkspaceAction } = await import('./workspace');

    const result = await executeContextPackWorkspaceAction(
      'contextPack.applySwitch',
      'apply',
      APPLY_PAYLOAD,
      runner,
    );

    expect(result.ok).toBe(true);
    expect(setActiveContextPackEnvMock).toHaveBeenCalledWith(
      expect.any(String),
      '/contextpacks/orders',
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('buildContextPackWorkspaceArgs', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('preserves repo identity on cross-repo Deep Focus support targets', async () => {
    const { buildContextPackWorkspaceArgs } = await import('./workspace');

    const args = buildContextPackWorkspaceArgs('apply', {
      contextPackDir: '/contextpacks/demo',
      scopeMode: 'focused',
      selectedRepoIds: ['platform'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'platform',
      selectedFocusTargets: [{
        path: '',
        kind: 'directory',
        role: 'anchor',
        repoLocalPath: '/repos/platform',
        repoId: 'platform',
      }],
      selectedSupportTargets: [{
        path: 'Acme.Cli',
        kind: 'directory',
        repoLocalPath: '/repos/tools',
        repoId: 'tools',
      }],
    } as ContextPackSwitchPayload);

    const supportTargetIndex = args.indexOf('--selected-support-target');
    expect(supportTargetIndex).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(args[supportTargetIndex + 1]!)).toEqual({
      path: 'Acme.Cli',
      kind: 'directory',
      repo_local_path: '/repos/tools',
      repo_id: 'tools',
    });
  });
});
