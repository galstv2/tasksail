// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider } from '../contexts/ObservabilityContext';
import { ToastProvider } from '../contexts/ToastContext';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { IpcTimeoutError } from '../services/ipcErrorHelpers';
import { createMockClient, createSwitchResponse } from '../../test';
import { createListContextPacksResponse } from '../../test';
import {
  useContextPackSwitching,
  type SwitchingStateSnapshot,
} from './useContextPackSwitching';

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
  it('starts with no pending action and no results', () => {
    const { result } = renderSwitchingHook(createMockClient());
    expect(result.current.actionPending).toBeNull();
    expect(result.current.lastResult).toBeNull();
    expect(result.current.lastReseedResult).toBeNull();
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
});
