// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readChildTaskChains: vi.fn(),
  listPlannerHistoryForPack: vi.fn(),
  getPlannerHistoryRecord: vi.fn(),
  readWorkspaceSyncStateSnapshot: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../../backend/platform/queue/childTaskChains.js', () => ({
  readChildTaskChains: mocks.readChildTaskChains,
}));
vi.mock('../../../backend/platform/planner-history/store.js', () => ({
  listPlannerHistoryForPack: mocks.listPlannerHistoryForPack,
  getPlannerHistoryRecord: mocks.getPlannerHistoryRecord,
  upsertPlannerHistoryRecord: vi.fn(),
}));
vi.mock('./main.contextPackCatalog', () => ({
  readWorkspaceSyncStateSnapshot: mocks.readWorkspaceSyncStateSnapshot,
}));
vi.mock('./paths', () => ({
  REPO_ROOT: '/repo',
  DESKTOP_ROOT: '/repo/src/frontend/desktop',
}));
vi.mock('./log/logger', () => ({
  createLogger: vi.fn(() => ({ warn: mocks.loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import type { PlannerConversationRecord } from '../../../backend/platform/planner-history/types.js';
import type { PlannerListConversationHistoryResponse } from '../src/shared/desktopContract';
import {
  assertPlannerHistoryRecordHydratable,
  derivePlannerHistoryTaskId,
  filterPlannerHistoryRecordsForRecents,
} from './plannerRecentChildTaskEligibility';
import {
  hydrateConversationAction,
  listConversationHistoryAction,
} from './plannerHistory';

function listResponse(result: Awaited<ReturnType<typeof listConversationHistoryAction>>): PlannerListConversationHistoryResponse {
  if (!result.ok || result.response.action !== 'planner.listConversationHistory') {
    throw new Error('Expected planner.listConversationHistory response.');
  }
  return result.response;
}

function sidecar(taskKind: 'standard' | 'child-task' = 'standard') {
  return {
    version: 1 as const,
    ownership: 'planner-session' as const,
    sessionId: 'planner-source',
    draftFilename: 'draft.md',
    draftPath: '/repo/AgentWorkSpace/dropbox/.staging/draft.md',
    createdAt: '2026-03-21T04:00:00Z',
    title: 'orders / api',
    primaryRepoId: 'orders-api',
    primaryRepoRoot: '/repos/orders-api',
    primaryFocusRelativePath: 'src/api',
    deepFocusEnabled: false,
    primaryFocusTargetKind: 'directory' as const,
    primaryFocusTargets: [],
    selectedTestTarget: null,
    supportTargets: [],
    lineage: {
      taskKind,
      parentTaskId: taskKind === 'child-task' ? 'parent' : '',
      rootTaskId: taskKind === 'child-task' ? 'root' : '',
      parentQmdRecordId: '',
      parentQmdScope: '',
      followUpReason: '',
    },
    contextPackBinding: {
      contextPackDir: '/contextpacks/orders',
      contextPackId: 'orders',
      scopeMode: 'focus-selection',
      selectedRepoIds: ['orders-api'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: false,
      selectedFocusPath: 'src/api',
      selectedFocusTargetKind: 'directory' as const,
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    },
  };
}

function record(id: string, taskKind: 'standard' | 'child-task' = 'standard', finalName = `${id}.md`): PlannerConversationRecord {
  return {
    id,
    contextPackDir: '/contextpacks/orders',
    contextPackId: 'orders',
    createdAt: `2026-03-21T04:0${id.length}:00Z`,
    title: `Task ${id}`,
    finalizedDestinationPath: `/repo/AgentWorkSpace/dropbox/${finalName}`,
    sidecarSnapshot: sidecar(taskKind),
    transcript: [{ id: `${id}-m`, role: 'operator', text: `secret prompt ${id}`, timestamp: '2026-03-21T04:00:00Z' }],
  };
}

function task(taskId: string, state = 'completed', rootTaskId = 'root') {
  return {
    taskId,
    rootTaskId,
    parentTaskId: taskId === rootTaskId ? null : rootTaskId,
    previousTaskId: null,
    depth: taskId === rootTaskId ? 0 : 1,
    state,
    archivePath: null,
    archiveArtifactDir: null,
    parentArchivePath: null,
    parentArchiveArtifactDir: null,
    parentContextSnapshot: null,
    childExecutionScope: null,
    branchChain: null,
    completedBranchHandoffs: null,
    completedAt: state === 'completed' ? '2026-03-21T04:00:00Z' : null,
    createdAt: '2026-03-21T04:00:00Z',
    updatedAt: '2026-03-21T04:00:00Z',
  };
}

function state(currentTipTaskId = 'tip', currentTipState = 'completed', extraTasks: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    updatedAt: '2026-03-21T04:00:00Z',
    chains: {
      root: {
        rootTaskId: 'root',
        currentTipTaskId,
        contextPackId: 'orders',
        contextPackDir: '/contextpacks/orders',
        taskIds: ['root', 'middle', 'tip'],
        createdAt: '2026-03-21T04:00:00Z',
        updatedAt: '2026-03-21T04:00:00Z',
      },
    },
    tasks: {
      root: task('root'),
      middle: task('middle'),
      tip: task('tip', currentTipState),
      ...extraTasks,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readWorkspaceSyncStateSnapshot.mockResolvedValue({
    activeContextPackDir: '/contextpacks/orders',
    activeContextPackId: 'orders',
  });
  mocks.readChildTaskChains.mockResolvedValue(state());
  mocks.listPlannerHistoryForPack.mockResolvedValue([]);
  mocks.getPlannerHistoryRecord.mockResolvedValue(null);
});

describe('recent child-task eligibility helper', () => {
  it('keeps regular records visible when child-chain state is empty, invalid, or unrelated', async () => {
    const regular = record('standard', 'standard', 'standard.md');
    mocks.readChildTaskChains.mockResolvedValueOnce({ schemaVersion: 1, updatedAt: 'now', chains: {}, tasks: {} });
    await expect(filterPlannerHistoryRecordsForRecents([regular], '/repo')).resolves.toMatchObject({
      visibleRecords: [regular],
      hiddenChildTaskCount: 0,
    });
    mocks.readChildTaskChains.mockRejectedValueOnce(new Error('invalid state'));
    await expect(filterPlannerHistoryRecordsForRecents([regular], '/repo')).resolves.toMatchObject({
      visibleRecords: [regular],
      hiddenChildTaskCount: 0,
      chainStateInvalid: false,
    });
  });

  it('uses finalizedDestinationPath basename as task id and ignores title or record id', async () => {
    const stale = record('tip', 'child-task', 'middle.md');
    stale.title = 'tip';

    const result = await filterPlannerHistoryRecordsForRecents([stale], '/repo');

    expect(derivePlannerHistoryTaskId(record('nested', 'child-task', 'nested/path/task-123.md'))).toBe('task-123');
    expect(result.visibleRecords).toEqual([]);
    expect(result.countsByReason['not-current-chain-tip']).toBe(1);
  });

  it('keeps only completed current-tip child records visible', async () => {
    const visible = record('visible', 'child-task', 'tip.md');
    const root = record('root-recent', 'child-task', 'root.md');
    const middle = record('middle-recent', 'child-task', 'middle.md');
    const legacy = record('legacy', 'child-task', 'legacy.md');

    const result = await filterPlannerHistoryRecordsForRecents([visible, root, middle, legacy], '/repo');

    expect(result.visibleRecords).toEqual([visible]);
    expect(result.countsByReason['current-completed-tip']).toBe(1);
    expect(result.countsByReason['not-current-chain-tip']).toBe(2);
    expect(result.countsByReason['legacy-child-without-chain-state']).toBe(1);
  });

  it.each(['planned', 'pending', 'active', 'failed'] as const)('hides %s current tips', async (tipState) => {
    mocks.readChildTaskChains.mockResolvedValueOnce(state('tip', tipState));

    const result = await filterPlannerHistoryRecordsForRecents([record('tip-recent', 'child-task', 'tip.md')], '/repo');

    expect(result.visibleRecords).toEqual([]);
    expect(result.countsByReason['chain-tip-state-not-completed']).toBe(1);
  });

  it('hides records with missing chain record', async () => {
    mocks.readChildTaskChains.mockResolvedValueOnce({
      schemaVersion: 1,
      updatedAt: 'now',
      chains: {},
      tasks: { tip: task('tip') },
    });

    const result = await filterPlannerHistoryRecordsForRecents([record('tip-recent', 'child-task', 'tip.md')], '/repo');

    expect(result.visibleRecords).toEqual([]);
    expect(result.countsByReason['missing-chain-record']).toBe(1);
  });

  it('invalid child-chain state hides child recents, keeps regular recents, and does not expose transcript text', async () => {
    mocks.readChildTaskChains.mockRejectedValueOnce(new Error('invalid state'));
    const regular = record('standard', 'standard', 'standard.md');
    const child = record('child', 'child-task', 'tip.md');

    const result = await filterPlannerHistoryRecordsForRecents([regular, child], '/repo');

    expect(result.visibleRecords).toEqual([regular]);
    expect(result.chainStateInvalid).toBe(true);
    expect(result.countsByReason['child-chain-state-invalid']).toBe(1);
    expect(JSON.stringify(result.countsByReason)).not.toContain('secret prompt');
  });

  it('does not read child-chain state when hydrating standard records', async () => {
    const regular = record('standard', 'standard', 'standard.md');

    await expect(assertPlannerHistoryRecordHydratable(regular, '/repo')).resolves.toMatchObject({
      visible: true,
      reason: 'not-child-task',
    });

    expect(mocks.readChildTaskChains).not.toHaveBeenCalled();
  });
});

describe('planner history recent list and hydrate filtering', () => {
  it('keeps regular records, hides stale child records, and preserves visible order', async () => {
    const regularNewest = record('regular-newest', 'standard', 'regular-newest.md');
    const staleChild = record('stale-child', 'child-task', 'middle.md');
    const tipChild = record('tip-child', 'child-task', 'tip.md');
    mocks.listPlannerHistoryForPack.mockResolvedValue([regularNewest, staleChild, tipChild]);

    const result = await listConversationHistoryAction();

    const response = listResponse(result);
    expect(response.mode).toBe('found');
    expect(response.conversations.map((item) => item.id)).toEqual(['regular-newest', 'tip-child']);
    expect(response.message).toBe('Some child-task recents are hidden because only completed current child-chain tips can be replayed.');
    expect(mocks.loggerWarn).toHaveBeenCalledWith('planner-history.recent-child-task.filtered', expect.objectContaining({
      hiddenChildTaskCount: 1,
      visibleCount: 2,
      contextPackDir: '/contextpacks/orders',
      contextPackId: 'orders',
    }));
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain('secret prompt');
  });

  it('invalid state hides child records, keeps regular records, and returns the exact invalid-state message', async () => {
    mocks.readChildTaskChains.mockRejectedValueOnce(new Error('invalid state'));
    mocks.listPlannerHistoryForPack.mockResolvedValue([
      record('regular', 'standard', 'regular.md'),
      record('child', 'child-task', 'tip.md'),
    ]);

    const result = await listConversationHistoryAction();

    const response = listResponse(result);
    expect(response.message).toBe('Some child-task recents are hidden because child-task chain state is invalid. Regular recents are still available.');
    expect(response.conversations.map((item) => item.id)).toEqual(['regular']);
    expect(mocks.loggerWarn).toHaveBeenCalledWith('planner-history.recent-child-task.filtered', expect.objectContaining({
      countsByReason: expect.objectContaining({ 'child-chain-state-invalid': 1 }),
    }));
  });

  it('returns empty when only hidden child records remain', async () => {
    mocks.listPlannerHistoryForPack.mockResolvedValue([record('stale-child', 'child-task', 'middle.md')]);

    const result = await listConversationHistoryAction();

    const response = listResponse(result);
    expect(response.mode).toBe('empty');
    expect(response.conversations).toEqual([]);
  });

  it('does not mutate planner history records or child-chain state', async () => {
    const records = [record('tip-child', 'child-task', 'tip.md')];
    const chainState = state();
    const recordsBefore = JSON.stringify(records);
    const stateBefore = JSON.stringify(chainState);
    mocks.listPlannerHistoryForPack.mockResolvedValue(records);
    mocks.readChildTaskChains.mockResolvedValueOnce(chainState);

    await listConversationHistoryAction();

    expect(JSON.stringify(records)).toBe(recordsBefore);
    expect(JSON.stringify(chainState)).toBe(stateBefore);
  });

  it('rejects stale child hydrate before replay can start', async () => {
    mocks.getPlannerHistoryRecord.mockResolvedValue(record('stale-child', 'child-task', 'middle.md'));

    const result = await hydrateConversationAction('stale-child');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toMatchObject({
      action: 'planner.hydrateConversation',
      mode: 'not-found',
      message: 'This child-task recent is no longer the current child-chain tip.',
      record: null,
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith('planner-history.recent-child-task.hydrate-rejected', expect.objectContaining({
      recordId: 'stale-child',
      reason: 'not-current-chain-tip',
    }));
  });

  it('hydrates standard and completed current-tip child records unchanged', async () => {
    const standard = record('standard', 'standard', 'standard.md');
    mocks.getPlannerHistoryRecord.mockResolvedValueOnce(standard);
    await expect(hydrateConversationAction('standard')).resolves.toMatchObject({
      ok: true,
      response: { mode: 'found', record: standard },
    });

    const child = record('tip-child', 'child-task', 'tip.md');
    mocks.getPlannerHistoryRecord.mockResolvedValueOnce(child);
    await expect(hydrateConversationAction('tip-child')).resolves.toMatchObject({
      ok: true,
      response: { mode: 'found', record: child },
    });
  });

  it('returns the invalid-state hydrate message for child records', async () => {
    mocks.readChildTaskChains.mockRejectedValueOnce(new Error('invalid state'));
    mocks.getPlannerHistoryRecord.mockResolvedValue(record('tip-child', 'child-task', 'tip.md'));

    const result = await hydrateConversationAction('tip-child');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toMatchObject({
      action: 'planner.hydrateConversation',
      mode: 'not-found',
      message: 'Child-task recents are temporarily unavailable because child-task chain state is invalid.',
      record: null,
    });
  });
});
