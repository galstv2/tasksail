// @vitest-environment jsdom
import { act, cleanup, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider } from '../../contexts/ObservabilityContext';
import { ToastProvider } from '../../contexts/ToastContext';
import type { DesktopShellClient } from '../../services/desktopShellClient';
import { IpcTimeoutError } from '../../services/ipcErrorHelpers';
import { createMockClient, createSwitchResponse } from '../../../test';
import { createListContextPacksResponse } from '../../../test';
import {
  useContextPackSwitching,
  type SwitchingStateSnapshot,
} from './useContextPackSwitching';

const { logEmit } = vi.hoisted(() => {
  const logEmit = vi.fn(() => Promise.resolve({ ok: true }));
  Object.defineProperty(window, 'desktopShell', {
    configurable: true,
    writable: true,
    value: {
      getBootstrapInfo: vi.fn().mockResolvedValue({
        appName: 'TaskSail',
        platform: 'test',
        logLevel: 'info',
        rendererForwardLevel: 'info',
        versions: { chrome: undefined, electron: undefined, node: 'test' },
      }),
      log: { emit: logEmit },
    },
  });
  return { logEmit };
});

afterEach(() => {
  cleanup();
});

function makeWrapper(client: DesktopShellClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ToastProvider>
        <ObservabilityProvider client={client}>{children}</ObservabilityProvider>
      </ToastProvider>
    );
  };
}

const defaultSnapshot: SwitchingStateSnapshot = {
  selectedContextPackDir: '/tmp/pack',
  catalogResponse: null,
  scopeMode: 'focused',
  selectedRepoIds: ['repo-1'],
  selectedFocusIds: [],
  deepFocusEnabled: false,
  deepFocusPrimaryRepoId: null,
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

function renderSwitchingHook(
  client: DesktopShellClient,
  getState?: () => SwitchingStateSnapshot,
) {
  const setError = vi.fn();
  const setMessage = vi.fn();
  const refreshCatalog = vi.fn().mockResolvedValue(undefined);

  return {
    ...renderHook(
      () =>
        useContextPackSwitching(
          client,
          getState ?? (() => defaultSnapshot),
          setError,
          setMessage,
          refreshCatalog,
        ),
      { wrapper: makeWrapper(client) },
    ),
    setError,
    setMessage,
    refreshCatalog,
  };
}

describe('useContextPackSwitching', () => {
  beforeEach(() => {
    logEmit.mockClear();
  });

  it('preview calls previewContextPackSwitch and sets lastResult', async () => {
    const previewResponse = createSwitchResponse('contextPack.previewSwitch', 'preview');
    const client = createMockClient({
      previewContextPackSwitch: vi.fn().mockResolvedValue({
        ok: true,
        response: previewResponse,
      }),
    });

    const { result, setMessage } = renderSwitchingHook(client);

    await act(async () => {
      await result.current.runAction('preview');
    });

    expect(client.previewContextPackSwitch).toHaveBeenCalledWith(
      '/tmp/pack',
      'focused',
      ['repo-1'],
      [],
      {},
    );
    expect(result.current.lastResult).not.toBeNull();
    expect(setMessage).toHaveBeenCalledWith(previewResponse.message);
    expect(result.current.actionPending).toBeNull();
  });

  it('apply calls applyContextPackSwitch and triggers refresh', async () => {
    const applyResponse = createSwitchResponse('contextPack.applySwitch', 'applied');
    const client = createMockClient({
      applyContextPackSwitch: vi.fn().mockResolvedValue({
        ok: true,
        response: applyResponse,
      }),
    });

    const { result, refreshCatalog } = renderSwitchingHook(client);

    await act(async () => {
      await result.current.runAction('apply');
    });

    expect(client.applyContextPackSwitch).toHaveBeenCalled();
    expect(refreshCatalog).toHaveBeenCalledWith({
      preferredContextPackDir: '/tmp/pack',
      preserveFeedback: true,
    });
  });

  it('forwards deep focus selections through apply', async () => {
    const client = createMockClient({
      applyContextPackSwitch: vi.fn().mockResolvedValue({
        ok: true,
        response: createSwitchResponse('contextPack.applySwitch', 'applied'),
      }),
    });

    const { result } = renderSwitchingHook(
      client,
      () => ({
        ...defaultSnapshot,
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'repo-1',
        deepFocusPrimaryFocusId: null,
        selectedRepoIds: ['repo-1'],
        selectedFocusPath: 'src/features/orders',
        selectedFocusTargetKind: 'directory',
        selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
        selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }),
    );

    await act(async () => {
      await result.current.runAction('apply');
    });

    expect(client.applyContextPackSwitch).toHaveBeenCalledWith(
      '/tmp/pack',
      'focused',
      ['repo-1'],
      [],
      {
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'repo-1',
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: 'src/features/orders',
        selectedFocusTargetKind: 'directory',
        selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
        selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      },
    );
  });

  it('clear calls clearActiveContextPack and triggers refresh', async () => {
    const clearResponse = createSwitchResponse('contextPack.clearActive', 'cleared');
    const client = createMockClient({
      clearActiveContextPack: vi.fn().mockResolvedValue({
        ok: true,
        response: clearResponse,
      }),
    });

    const { result, refreshCatalog } = renderSwitchingHook(
      client,
      () => ({
        ...defaultSnapshot,
        catalogResponse: createListContextPacksResponse([], {
          activeContextPackDir: '/tmp/pack',
        }),
      }),
    );

    await act(async () => {
      await result.current.runAction('clear');
    });

    expect(client.clearActiveContextPack).toHaveBeenCalled();
    expect(refreshCatalog).toHaveBeenCalledWith({
      preferredContextPackDir: undefined,
      preserveFeedback: true,
    });
  });

  it('sets error when no context pack is selected for preview', async () => {
    const { result, setError } = renderSwitchingHook(
      createMockClient(),
      () => ({ ...defaultSnapshot, selectedContextPackDir: '' }),
    );

    await act(async () => {
      await result.current.runAction('preview');
    });

    expect(setError).toHaveBeenCalledWith(
      'Select a context pack before running workspace actions.',
    );
  });

  it('sets error on failed IPC result', async () => {
    const client = createMockClient({
      previewContextPackSwitch: vi.fn().mockResolvedValue({
        ok: false,
        error: 'IPC failed.',
      }),
    });

    const { result, setError, setMessage } = renderSwitchingHook(client);

    await act(async () => {
      await result.current.runAction('preview');
    });

    expect(setError).toHaveBeenCalledWith('IPC failed.');
    expect(setMessage).toHaveBeenCalledWith('Context-pack workspace action failed.');
  });

  it('blocks clear when no active context pack is applied', async () => {
    const client = createMockClient({
      clearActiveContextPack: vi.fn(),
    });

    const { result, setError } = renderSwitchingHook(
      client,
      () => ({
        ...defaultSnapshot,
        catalogResponse: createListContextPacksResponse([], {
          message: 'No active context pack.',
          activeContextPackDir: null,
        }),
      }),
    );

    await act(async () => {
      await result.current.runAction('clear');
    });

    expect(client.clearActiveContextPack).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith('No active context pack is currently applied.');
  });

  it('reseed calls reseedContextPack and sets lastReseedResult', async () => {
    const client = createMockClient({
      reseedContextPack: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'contextPack.reseed',
          mode: 'reseeded',
          message: 'Reseed complete.',
          commandPath: 'src/backend/scripts/python/repo-context-app.py',
          result: {
            contextPackDir: '/tmp/pack',
            overallStatus: 'seeded',
            reportPath: null,
            seededRepoCount: 2,
            blockedRepoCount: 0,
            conventionsSummaryStatus: null,
            conventionsPolicy: 'only-if-missing',
          },
        },
      }),
    });

    const { result, refreshCatalog } = renderSwitchingHook(client);

    await act(async () => {
      await result.current.runReseedAction();
    });

    expect(client.reseedContextPack).toHaveBeenCalledWith('/tmp/pack');
    expect(result.current.lastReseedResult).not.toBeNull();
    expect(result.current.lastReseedResult?.seededRepoCount).toBe(2);
    expect(refreshCatalog).toHaveBeenCalled();
  });

  it('warns and refreshes catalog when reseed is already in progress', async () => {
    const client = createMockClient({
      reseedContextPack: vi.fn().mockResolvedValue({
        ok: false,
        action: 'contextPack.reseed',
        error: 'reseed_in_progress',
        details: ['pid=1234', 'host=host-a'],
      }),
    });

    const { result, refreshCatalog, setMessage } = renderSwitchingHook(client);

    await act(async () => {
      await result.current.runReseedAction();
    });

    expect(result.current.lastReseedResult).toBeNull();
    expect(setMessage).toHaveBeenCalledWith('Context-pack reseed is already in progress.');
    expect(refreshCatalog).toHaveBeenCalledWith({
      preferredContextPackDir: '/tmp/pack',
      preserveFeedback: true,
    });
    expect(screen.getByText('Another reseed is already in progress on PID 1234')).toBeInTheDocument();
  });

  it('runAction resets actionPending when IPC throws', async () => {
    const client = createMockClient({
      previewContextPackSwitch: vi.fn().mockRejectedValue(new Error('Network failure')),
    });

    const { result, setError, setMessage } = renderSwitchingHook(client);

    await act(async () => {
      await result.current.runAction('preview');
    });

    expect(result.current.actionPending).toBeNull();
    expect(setError).toHaveBeenCalledWith('Network failure');
    expect(setMessage).toHaveBeenCalledWith('Context-pack workspace action failed.');
  });

  it('runReseedAction resets actionPending when refreshCatalog throws', async () => {
    const client = createMockClient({
      reseedContextPack: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'contextPack.reseed',
          mode: 'reseeded',
          message: 'Reseed complete.',
          commandPath: 'src/backend/scripts/python/repo-context-app.py',
          result: {
            contextPackDir: '/tmp/pack',
            overallStatus: 'seeded',
            reportPath: null,
            seededRepoCount: 2,
            blockedRepoCount: 0,
            conventionsSummaryStatus: null,
            conventionsPolicy: 'only-if-missing',
          },
        },
      }),
    });

    const { result, setError, refreshCatalog } = renderSwitchingHook(client);
    refreshCatalog.mockRejectedValue(new Error('Catalog fetch failed'));

    await act(async () => {
      await result.current.runReseedAction();
    });

    expect(result.current.actionPending).toBeNull();
    expect(setError).toHaveBeenCalledWith('Catalog fetch failed');
  });

  it('reseed sets error when no pack selected', async () => {
    const { result, setError } = renderSwitchingHook(
      createMockClient(),
      () => ({ ...defaultSnapshot, selectedContextPackDir: '' }),
    );

    await act(async () => {
      await result.current.runReseedAction();
    });

    expect(setError).toHaveBeenCalledWith(
      'Select a context pack before reseeding pack memory.',
    );
  });

  it('refreshes catalog after a failed apply action', async () => {
    const client = createMockClient({
      applyContextPackSwitch: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Activation validation failed.',
      }),
    });

    const { result, setError, refreshCatalog } = renderSwitchingHook(client);

    await act(async () => {
      await result.current.runAction('apply');
    });

    expect(setError).toHaveBeenCalledWith(expect.stringContaining('Activation validation failed'));
    expect(refreshCatalog).toHaveBeenCalledWith({ preserveFeedback: true });
  });

  it('logs when refresh after a failed apply action rejects', async () => {
    const client = createMockClient({
      applyContextPackSwitch: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Activation validation failed.',
      }),
    });

    const { result, refreshCatalog } = renderSwitchingHook(client);
    refreshCatalog.mockRejectedValue(new Error('Catalog refresh failed.'));

    await act(async () => {
      await result.current.runAction('apply');
    });

    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'context-pack.switch.refresh-after-failure.failed',
      level: 'warn',
      extra: {
        stage: 'failed-result',
        reason: 'Catalog refresh failed.',
      },
    }));
  });

  it('refreshes catalog after a thrown error', async () => {
    const client = createMockClient({
      applyContextPackSwitch: vi.fn().mockRejectedValue(new Error('Network down')),
    });

    const { result, setError, refreshCatalog } = renderSwitchingHook(client);

    await act(async () => {
      await result.current.runAction('apply');
    });

    expect(setError).toHaveBeenCalledWith('Network down');
    expect(refreshCatalog).toHaveBeenCalledWith({ preserveFeedback: true });
  });

  it('logs when refresh after a thrown action error rejects', async () => {
    const client = createMockClient({
      applyContextPackSwitch: vi.fn().mockRejectedValue(new Error('Network down')),
    });

    const { result, refreshCatalog } = renderSwitchingHook(client);
    refreshCatalog.mockRejectedValue(new Error('Catalog refresh failed.'));

    await act(async () => {
      await result.current.runAction('apply');
    });

    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'context-pack.switch.refresh-after-failure.failed',
      level: 'warn',
      extra: {
        stage: 'thrown-error',
        reason: 'Catalog refresh failed.',
      },
    }));
  });

  it('shows timeout-specific guidance when IPC times out', async () => {
    const client = createMockClient({
      applyContextPackSwitch: vi.fn().mockRejectedValue(
        new IpcTimeoutError('contextPack.applySwitch', 30_000),
      ),
    });

    const { result, setError } = renderSwitchingHook(client);

    await act(async () => {
      await result.current.runAction('apply');
    });

    expect(setError).toHaveBeenCalledWith(
      expect.stringContaining('may still be running'),
    );
    expect(setError).toHaveBeenCalledWith(
      expect.stringContaining('click Refresh'),
    );
  });

  it('blocks monolith apply when no typed primary focus area is selected', async () => {
    const client = createMockClient();
    const monolithPack = {
      ...createListContextPacksResponse([
        {
          contextPackId: 'mono',
          displayName: 'Monolith Pack',
          contextPackDir: '/tmp/pack',
          manifestPath: null,
          bootstrapReady: true,
          source: 'configured-path' as const,
          isActive: false,
          estateType: 'monolith',
          defaultScopeMode: 'focused' as const,
          repoCount: 1,
          primaryWorkingRepoIds: [],
          focusTargets: [
            {
              focusId: 'core',
              displayName: 'Core',
              kind: 'focus-area' as const,
              repoId: null,
              serviceName: null,
              systemLayer: null,
              repoRole: null,
              repositoryType: 'primary' as const,
              relativePath: 'src/core',
              focusType: 'service',
              group: null,
              defaultFocusable: true,
              activationPriority: 100,
              adjacentRepoIds: [],
              adjacentFocusIds: [],
            },
            {
              focusId: 'docs',
              displayName: 'Docs',
              kind: 'focus-area' as const,
              repoId: null,
              serviceName: null,
              systemLayer: null,
              repoRole: null,
              repositoryType: 'support' as const,
              relativePath: 'docs',
              focusType: 'docs',
              group: null,
              defaultFocusable: false,
              activationPriority: 90,
              adjacentRepoIds: [],
              adjacentFocusIds: [],
            },
          ],
        },
      ]),
    };

    const { result } = renderSwitchingHook(
      client,
      () => ({
        ...defaultSnapshot,
        selectedRepoIds: [],
        selectedFocusIds: ['docs'],
        catalogResponse: monolithPack,
      }),
    );

    await act(async () => {
      await result.current.runAction('apply');
    });

    expect(result.current.showMultiPrimaryWarning).toBe(true);
    expect(client.applyContextPackSwitch).not.toHaveBeenCalled();
  });

  it('allows distributed apply when multiple typed primary repos are selected', async () => {
    const applyResponse = createSwitchResponse('contextPack.applySwitch', 'applied');
    const client = createMockClient({
      applyContextPackSwitch: vi.fn().mockResolvedValue({
        ok: true,
        response: applyResponse,
      }),
    });
    const distributedPack = createListContextPacksResponse([
      {
        contextPackId: 'distributed',
        displayName: 'Distributed Pack',
        contextPackDir: '/tmp/pack',
        manifestPath: null,
        bootstrapReady: true,
        source: 'configured-path',
        isActive: false,
        estateType: 'distributed-platform',
        defaultScopeMode: 'focused',
        repoCount: 3,
        primaryWorkingRepoIds: ['api', 'web'],
        focusTargets: [
          {
            focusId: 'api',
            displayName: 'API',
            kind: 'repository',
            repoId: 'api',
            serviceName: null,
            systemLayer: 'backend',
            repoRole: null,
            repositoryType: 'primary',
            relativePath: null,
            focusType: null,
            group: null,
            defaultFocusable: true,
            activationPriority: 100,
            adjacentRepoIds: [],
            adjacentFocusIds: [],
          },
          {
            focusId: 'web',
            displayName: 'Web',
            kind: 'repository',
            repoId: 'web',
            serviceName: null,
            systemLayer: 'frontend',
            repoRole: null,
            repositoryType: 'primary',
            relativePath: null,
            focusType: null,
            group: null,
            defaultFocusable: true,
            activationPriority: 90,
            adjacentRepoIds: [],
            adjacentFocusIds: [],
          },
          {
            focusId: 'docs',
            displayName: 'Docs',
            kind: 'repository',
            repoId: 'docs',
            serviceName: null,
            systemLayer: 'documentation',
            repoRole: null,
            repositoryType: 'support',
            relativePath: null,
            focusType: null,
            group: null,
            defaultFocusable: false,
            activationPriority: 10,
            adjacentRepoIds: [],
            adjacentFocusIds: [],
          },
        ],
      },
    ]);

    const { result } = renderSwitchingHook(
      client,
      () => ({
        ...defaultSnapshot,
        selectedRepoIds: ['api', 'web'],
        selectedFocusIds: [],
        catalogResponse: distributedPack,
      }),
    );

    await act(async () => {
      await result.current.runAction('apply');
    });

    expect(result.current.showMultiPrimaryWarning).toBe(false);
    expect(client.applyContextPackSwitch).toHaveBeenCalled();
  });

  it('allows legacy monolith packs with untyped focus areas to pass through', async () => {
    const applyResponse = createSwitchResponse('contextPack.applySwitch', 'applied');
    const client = createMockClient({
      applyContextPackSwitch: vi.fn().mockResolvedValue({
        ok: true,
        response: applyResponse,
      }),
    });

    const { result } = renderSwitchingHook(
      client,
      () => ({
        ...defaultSnapshot,
        selectedRepoIds: [],
        selectedFocusIds: ['core'],
        catalogResponse: createListContextPacksResponse([
          {
            contextPackId: 'mono',
            displayName: 'Legacy Monolith',
            contextPackDir: '/tmp/pack',
            manifestPath: null,
            bootstrapReady: true,
            source: 'configured-path',
            isActive: false,
            estateType: 'monolith',
            defaultScopeMode: 'focused',
            repoCount: 1,
            primaryWorkingRepoIds: [],
            focusTargets: [
              {
                focusId: 'core',
                displayName: 'Core',
                kind: 'focus-area',
                repoId: null,
                serviceName: null,
                systemLayer: null,
                repoRole: null,
                repositoryType: null,
                relativePath: 'src/core',
                focusType: 'service',
                group: null,
                defaultFocusable: true,
                activationPriority: 100,
                adjacentRepoIds: [],
                adjacentFocusIds: [],
              },
            ],
          },
        ]),
      }),
    );

    await act(async () => {
      await result.current.runAction('apply');
    });

    expect(result.current.showMultiPrimaryWarning).toBe(false);
    expect(client.applyContextPackSwitch).toHaveBeenCalled();
  });

    // Bootstrap-empty packs gate Apply behind a confirm dialog.
  // The dialog state is consumed by ContextPackSidebarExpanded; here we
  // verify the hook surfaces the pending flag and that the two confirm
  // callbacks resolve to the documented next-action.
  describe('bootstrap-empty gate', () => {
    function bootstrapEmptyPack() {
      return createListContextPacksResponse([
        {
          contextPackId: 'empty',
          displayName: 'Empty Pack',
          contextPackDir: '/tmp/pack',
          manifestPath: null,
          bootstrapReady: true,
          source: 'configured-path' as const,
          isActive: false,
          estateType: 'distributed-platform',
          defaultScopeMode: 'focused' as const,
          repoCount: 0,
          primaryWorkingRepoIds: [],
          focusTargets: [],
          packSeedState: 'bootstrap-empty',
          packSeedStateInfo: { state: 'bootstrap-empty', reason: 'new-flow-seed-skipped' },
        },
      ]);
    }

    it('apply on a bootstrap-empty pack opens the confirm dialog without calling IPC', async () => {
      const client = createMockClient();
      const { result } = renderSwitchingHook(client, () => ({
        ...defaultSnapshot,
        selectedRepoIds: [],
        catalogResponse: bootstrapEmptyPack(),
      }));

      await act(async () => {
        await result.current.runAction('apply');
      });

      expect(result.current.bootstrapEmptyConfirmPending).toBe(true);
      expect(client.applyContextPackSwitch).not.toHaveBeenCalled();
      expect(result.current.actionPending).toBeNull();
    });

    it('preview on a bootstrap-empty pack is NOT gated', async () => {
      const previewResponse = createSwitchResponse('contextPack.previewSwitch', 'preview');
      const client = createMockClient({
        previewContextPackSwitch: vi.fn().mockResolvedValue({ ok: true, response: previewResponse }),
      });
      const { result } = renderSwitchingHook(client, () => ({
        ...defaultSnapshot,
        selectedRepoIds: [],
        catalogResponse: bootstrapEmptyPack(),
      }));

      await act(async () => {
        await result.current.runAction('preview');
      });

      expect(result.current.bootstrapEmptyConfirmPending).toBe(false);
      expect(client.previewContextPackSwitch).toHaveBeenCalled();
    });

    it('confirmActivateAnyway dismisses the dialog and proceeds with apply', async () => {
      const applyResponse = createSwitchResponse('contextPack.applySwitch', 'applied');
      const client = createMockClient({
        applyContextPackSwitch: vi.fn().mockResolvedValue({ ok: true, response: applyResponse }),
      });
      const { result } = renderSwitchingHook(client, () => ({
        ...defaultSnapshot,
        selectedRepoIds: [],
        catalogResponse: bootstrapEmptyPack(),
      }));

      await act(async () => {
        await result.current.runAction('apply');
      });
      expect(result.current.bootstrapEmptyConfirmPending).toBe(true);

      await act(async () => {
        await result.current.confirmActivateAnyway();
      });

      expect(result.current.bootstrapEmptyConfirmPending).toBe(false);
      expect(client.applyContextPackSwitch).toHaveBeenCalledTimes(1);
    });

    it('confirmPopulateAndSeed dismisses the dialog and triggers a reseed instead', async () => {
      const reseedResponse = {
        action: 'contextPack.reseed' as const,
        mode: 'reseeded' as const,
        message: 'Reseed complete.',
        commandPath: 'src/backend/platform/context-pack/switch.ts',
        result: {
          contextPackDir: '/tmp/pack',
          overallStatus: 'seeded',
          reportPath: null,
          seededRepoCount: 1,
          blockedRepoCount: 0,
          conventionsSummaryStatus: null,
          conventionsPolicy: 'only-if-missing',
          workspaceFolderCount: null,
          workspaceFileCount: null,
        },
      };
      const client = createMockClient({
        reseedContextPack: vi.fn().mockResolvedValue({ ok: true, response: reseedResponse }),
      });
      const { result } = renderSwitchingHook(client, () => ({
        ...defaultSnapshot,
        selectedRepoIds: [],
        catalogResponse: bootstrapEmptyPack(),
      }));

      await act(async () => {
        await result.current.runAction('apply');
      });
      await act(async () => {
        await result.current.confirmPopulateAndSeed();
      });

      expect(result.current.bootstrapEmptyConfirmPending).toBe(false);
      expect(client.reseedContextPack).toHaveBeenCalledWith('/tmp/pack');
      expect(client.applyContextPackSwitch).not.toHaveBeenCalled();
    });
  });
});
