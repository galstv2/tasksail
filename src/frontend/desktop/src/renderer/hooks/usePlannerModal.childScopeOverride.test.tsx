// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry, PlannerChildTaskExecutionScope } from '../../shared/desktopContract';
import {
  createArchivedTask,
  createClient,
  createFocusSnapshot,
  renderPlannerModalHook,
} from './usePlannerModal.testSetup';

const contextPack: ContextPackCatalogEntry = {
  contextPackId: 'test-pack',
  displayName: 'Test Pack',
  contextPackDir: '/tmp/test-context-pack',
  manifestPath: null,
  bootstrapReady: true,
  source: 'configured-path',
  isActive: true,
  estateType: 'distributed-platform',
  defaultScopeMode: null,
  repoCount: 2,
  primaryWorkingRepoIds: [],
  focusTargets: [
    {
      focusId: 'platform',
      displayName: 'Platform',
      kind: 'repository',
      repoId: 'platform',
      repoLocalPath: '/repo/platform',
      serviceName: null,
      systemLayer: null,
      repoRole: null,
      repositoryType: null,
      relativePath: null,
      focusType: null,
      group: null,
      defaultFocusable: true,
      activationPriority: 0,
      adjacentRepoIds: [],
      adjacentFocusIds: [],
    },
    {
      focusId: 'support',
      displayName: 'Support',
      kind: 'repository',
      repoId: 'support',
      repoLocalPath: '/repo/support',
      serviceName: null,
      systemLayer: null,
      repoRole: null,
      repositoryType: null,
      relativePath: null,
      focusType: null,
      group: null,
      defaultFocusable: true,
      activationPriority: 1,
      adjacentRepoIds: [],
      adjacentFocusIds: [],
    },
  ],
};

const standardParentScope: PlannerChildTaskExecutionScope = {
  contextPackDir: '/tmp/test-context-pack',
  contextPackId: 'test-pack',
  scopeMode: 'selected',
  selectedRepoIds: ['platform'],
  selectedFocusIds: [],
  repositoryTypes: { platform: 'primary' },
  deepFocusEnabled: false,
  deepFocusPrimaryRepoId: null,
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

function createStandardArchivedTask() {
  return createArchivedTask({
    plannerFocusSnapshot: createFocusSnapshot({
      deepFocusEnabled: false,
      contextPackBinding: {
        contextPackDir: standardParentScope.contextPackDir,
        contextPackId: standardParentScope.contextPackId,
        scopeMode: standardParentScope.scopeMode,
        primaryRepoId: 'platform',
        selectedRepoIds: standardParentScope.selectedRepoIds,
        selectedFocusIds: standardParentScope.selectedFocusIds,
        deepFocusEnabled: false,
        selectedFocusPath: null,
        selectedFocusTargetKind: null,
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
      },
    }),
  });
}

describe('usePlannerModal child scope override', () => {
  it('exposes default parent scope and no-ops unchanged saves', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const endPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.endSession', mode: 'ended', accepted: true, message: 'Ended.' },
    });
    const client = createClient({ startPlannerSession, endPlannerSession });
    const { result } = renderPlannerModalHook(client, { childScopeContextPacks: [contextPack] });

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    await waitFor(() => expect(result.current.plannerModalProps.childTaskMode).toBe(true));
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createStandardArchivedTask());
    });

    await waitFor(() => expect(result.current.plannerModalProps.childScopeStatusLabel).toBe('Using parent scope'));
    const endCountAfterParentSelection = endPlannerSession.mock.calls.length;
    expect(result.current.plannerModalProps.onOpenChildScopePanel).toBeDefined();
    act(() => result.current.plannerModalProps.onOpenChildScopePanel?.());
    expect(result.current.plannerModalProps.childScopePanelOpen).toBe(true);

    await act(async () => {
      result.current.plannerModalProps.childScopePanelProps?.onSave(
        result.current.plannerModalProps.childScopePanelProps.childScope,
      );
    });

    expect(result.current.plannerModalProps.childScopePanelOpen).toBe(false);
    expect(startPlannerSession).toHaveBeenCalledTimes(1);
    expect(endPlannerSession).toHaveBeenCalledTimes(endCountAfterParentSelection);
  });

  it('restarts Lily with Child Execution Scope and Lily Planning Reload Scope after changed save', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const client = createClient({ startPlannerSession });
    const { result } = renderPlannerModalHook(client, { childScopeContextPacks: [contextPack] });

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    await waitFor(() => expect(result.current.plannerModalProps.childTaskMode).toBe(true));
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createStandardArchivedTask());
    });
    await waitFor(() => expect(result.current.plannerModalProps.childScopePanelProps).toBeDefined());
    act(() => {
      result.current.plannerModalProps.onLilyPersonalityChange?.('clinical');
    });
    act(() => result.current.plannerModalProps.onOpenChildScopePanel?.());

    const savedScope = result.current.plannerModalProps.childScopePanelProps!.childScope;
    await act(async () => {
      result.current.plannerModalProps.childScopePanelProps?.onSave({
        ...savedScope,
        selectedRepoIds: ['support'],
        repositoryTypes: { support: 'primary' },
      });
    });

    await waitFor(() => expect(result.current.plannerModalProps.childScopeStatusLabel).toBe('Child scope adjusted'));
    expect(startPlannerSession).toHaveBeenLastCalledWith(expect.objectContaining({
      lilyPersonalityId: 'clinical',
      childTaskExecutionScope: expect.objectContaining({ selectedRepoIds: ['support'] }),
      lilyPlanningReloadScope: expect.objectContaining({
        purpose: 'lily-planning-read-context',
        selectedRepoIds: ['support', 'platform'],
      }),
      parentTaskBranchView: expect.objectContaining({
        parentTaskId: 'TASK-001',
        branchChainAvailability: expect.objectContaining({ status: 'missing-branch-handoffs' }),
      }),
    }));
  });

  it('blocks child scope saves that do not contain a Primary', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const client = createClient({ startPlannerSession });
    const { result } = renderPlannerModalHook(client, { childScopeContextPacks: [contextPack] });

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    await waitFor(() => expect(result.current.plannerModalProps.childTaskMode).toBe(true));
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createStandardArchivedTask());
    });
    await waitFor(() => expect(result.current.plannerModalProps.childScopePanelProps).toBeDefined());
    act(() => result.current.plannerModalProps.onOpenChildScopePanel?.());

    const savedScope = result.current.plannerModalProps.childScopePanelProps!.childScope;
    await act(async () => {
      result.current.plannerModalProps.childScopePanelProps?.onSave({
        ...savedScope,
        selectedRepoIds: ['support'],
        repositoryTypes: { support: 'support' },
      });
    });

    expect(result.current.plannerModalProps.childScopePanelOpen).toBe(true);
    expect(result.current.plannerModalProps.childScopePanelProps?.error).toContain('Primary Selection Required');
    expect(result.current.plannerModalProps.childScopePanelProps?.error).toContain('Select at least one Primary in your working focus before applying.');
    expect(startPlannerSession).toHaveBeenCalledTimes(1);
  });

  it('blocks Deep Focus child scope saves that do not contain a Primary', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const client = createClient({ startPlannerSession });
    const { result } = renderPlannerModalHook(client, { childScopeContextPacks: [contextPack] });

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    await waitFor(() => expect(result.current.plannerModalProps.childTaskMode).toBe(true));
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createStandardArchivedTask());
    });
    await waitFor(() => expect(result.current.plannerModalProps.childScopePanelProps).toBeDefined());
    act(() => result.current.plannerModalProps.onOpenChildScopePanel?.());

    await act(async () => {
      result.current.plannerModalProps.childScopePanelProps?.onSave({
        ...standardParentScope,
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: null,
        selectedFocusPath: null,
        selectedFocusTargetKind: null,
        selectedFocusTargets: [],
      });
    });

    expect(result.current.plannerModalProps.childScopePanelOpen).toBe(true);
    expect(result.current.plannerModalProps.childScopePanelProps?.error).toContain('Primary Selection Required');
    expect(startPlannerSession).toHaveBeenCalledTimes(1);
  });

  it('labels the child scope as using parent scope after saving back to the parent selection', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const client = createClient({ startPlannerSession });
    const { result } = renderPlannerModalHook(client, { childScopeContextPacks: [contextPack] });

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    await waitFor(() => expect(result.current.plannerModalProps.childTaskMode).toBe(true));
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createStandardArchivedTask());
    });
    await waitFor(() => expect(result.current.plannerModalProps.childScopePanelProps).toBeDefined());

    await act(async () => {
      result.current.plannerModalProps.childScopePanelProps?.onSave({
        ...standardParentScope,
        selectedRepoIds: ['support'],
        repositoryTypes: { support: 'primary' },
      });
    });
    await waitFor(() => expect(result.current.plannerModalProps.childScopeStatusLabel).toBe('Child scope adjusted'));

    act(() => result.current.plannerModalProps.onOpenChildScopePanel?.());
    await act(async () => {
      result.current.plannerModalProps.childScopePanelProps?.onSave(standardParentScope);
    });

    await waitFor(() => expect(result.current.plannerModalProps.childScopeStatusLabel).toBe('Using parent scope'));
    expect(result.current.plannerModalProps.childScopeWarning).toBeUndefined();
  });

  it('does not expose child scope override until parent context is ready', async () => {
    const readParentContextBundle = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Parent archive unavailable.',
    });
    const client = createClient({ readParentContextBundle });
    const { result } = renderPlannerModalHook(client, { childScopeContextPacks: [contextPack] });

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    await waitFor(() => expect(result.current.plannerModalProps.childTaskMode).toBe(true));
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
    });

    await waitFor(() => expect(result.current.plannerModalProps.draftError).toBe('Parent archive unavailable.'));
    expect(result.current.plannerModalProps.childScopeStatusLabel).toBeUndefined();
    expect(result.current.plannerModalProps.onOpenChildScopePanel).toBeUndefined();
  });
});
