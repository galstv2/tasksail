// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeChildTaskChains, type ChildTaskChainsState, type ChildTaskChainTaskState } from '../../../../backend/platform/queue/childTaskChains.js';
import { saveTaskRegistry, type TaskRegistryEntry } from '../../../../backend/platform/queue/taskRegistry.js';
import { listArchivedTasksAction } from './archivedTasks';
import type { ContextPackListResponse, PlannerListArchivedTasksResponse } from '../../src/shared/desktopContract';

vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn(), whenReady: vi.fn(() => Promise.resolve()) },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeImage: { createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }) },
}));

let TEST_REPO_ROOT: string;

vi.mock('../paths', () => ({
  get REPO_ROOT() {
    return TEST_REPO_ROOT;
  },
}));

function catalog(): ContextPackListResponse {
  return {
    action: 'contextPack.list',
    mode: 'read-only',
    message: 'Context packs listed.',
    activeContextPackDir: null,
    configuredPaths: [],
    searchRoots: [],
    recentContextPackDirs: [],
    contextPacks: [{
      contextPackId: 'test',
      displayName: 'Test',
      contextPackDir: '/packs/test',
      manifestPath: null,
      bootstrapReady: false,
      source: 'configured-path',
      isActive: true,
      estateType: null,
      defaultScopeMode: null,
      repoCount: 0,
      primaryWorkingRepoIds: [],
      focusTargets: [],
    }],
  };
}

function writeArchiveTask(taskId: string, json: Record<string, unknown> = {}): void {
  const dir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'qmd', 'context-packs', 'test', 'archive', 'tasks', '2026');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${taskId}.md`), `# ${taskId}\n\n- Task ID: ${taskId}\n`);
  writeFileSync(join(dir, `${taskId}.json`), `${JSON.stringify({
    record_id: `task:test:${taskId}`,
    task_id: taskId,
    root_task_id: taskId,
    branch_handoffs: [{ repo_root: '/repo', repo_label: 'Repo', branch: 'task/x', base_commit_sha: 'base', head_commit_sha: 'head', commits_ahead: 1, status: 'ready-for-operator-review' }],
    ...json,
  }, null, 2)}\n`);
}

function task(taskId: string, rootTaskId: string, state: ChildTaskChainTaskState, depth: number, parentTaskId: string | null = depth === 0 ? null : 'ROOT') {
  return {
    taskId,
    rootTaskId,
    parentTaskId,
    previousTaskId: parentTaskId,
    depth,
    state,
    archivePath: state === 'completed' ? `/archive/${taskId}.md` : null,
    archiveArtifactDir: null,
    parentArchivePath: parentTaskId ? '/archive/root.md' : null,
    parentArchiveArtifactDir: null,
    parentContextSnapshot: null,
    childExecutionScope: null,
    branchChain: null,
    completedBranchHandoffs: null,
    completedAt: state === 'completed' ? '2026-05-22T00:00:00.000Z' : null,
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
  };
}

function chain(tipState: ChildTaskChainTaskState): ChildTaskChainsState {
  return {
    schemaVersion: 1,
    updatedAt: '2026-05-22T00:00:00.000Z',
    chains: { ROOT: { rootTaskId: 'ROOT', currentTipTaskId: 'CHILD', contextPackId: 'test', contextPackDir: '/packs/test', taskIds: ['ROOT', 'CHILD'], createdAt: '2026-05-22T00:00:00.000Z', updatedAt: '2026-05-22T00:00:00.000Z' } },
    tasks: { ROOT: task('ROOT', 'ROOT', 'completed', 0), CHILD: task('CHILD', 'ROOT', tipState, 1, 'ROOT') },
  };
}

function registryEntry(state: TaskRegistryEntry['state']): TaskRegistryEntry {
  return {
    taskId: 'CHILD',
    fileName: 'CHILD.md',
    title: `${state} child`,
    state,
    contextPackId: 'test',
    contextPackDir: '/packs/test',
    scopeMode: null,
    selectedRepoIds: [],
    selectedFocusIds: [],
    createdAt: null,
    completedAt: null,
    archivePath: null,
  };
}

async function list(): Promise<PlannerListArchivedTasksResponse> {
  const result = await listArchivedTasksAction(vi.fn().mockResolvedValue(catalog()));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.response as PlannerListArchivedTasksResponse;
}

describe('listArchivedTasksAction child parent blocked tips', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'archived-blocked-tips-'));
    TEST_REPO_ROOT = mkdtempSync(join(tmpRoot, 'repo-root-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it.each(['planned', 'pending', 'active', 'failed'] as const)('emits a disabled blocked row for a %s reserved tip without fabricating archive rows', async (tipState) => {
    writeArchiveTask('ROOT');
    await writeChildTaskChains(TEST_REPO_ROOT, chain(tipState));
    await saveTaskRegistry(TEST_REPO_ROOT, { schema_version: 2, tasks: { test: { open: tipState === 'planned' ? [registryEntry('open')] : [], pending: tipState === 'pending' ? [registryEntry('pending')] : [], active: tipState === 'active' ? [registryEntry('active')] : [], failed: tipState === 'failed' ? [registryEntry('failed')] : [], completed: [] } } });

    const response = await list();

    expect(response.tasks.map((entry) => entry.taskId)).toEqual(['ROOT']);
    expect(response.tasks[0]?.childParentEligibility).toEqual(expect.objectContaining({ eligible: false, reason: 'reserved-by-unarchived-tip' }));
    expect(response.childParentBlockedTips).toEqual([
      expect.objectContaining({
        rootTaskId: 'ROOT',
        blockedParentTaskId: 'ROOT',
        currentTipTaskId: 'CHILD',
        chainState: tipState,
        boardState: tipState === 'planned' ? 'open' : tipState,
      }),
    ]);
  });

  it('emits status-unavailable blocked rows when registry data is missing', async () => {
    writeArchiveTask('ROOT');
    await writeChildTaskChains(TEST_REPO_ROOT, chain('planned'));

    const response = await list();

    expect(response.childParentBlockedTips?.[0]).toEqual(expect.objectContaining({
      boardState: null,
      title: null,
      fileName: null,
    }));
  });

  it('does not emit blocked rows for standalone roots, completed current tips, or invalid chain state', async () => {
    writeArchiveTask('STANDALONE');
    expect((await list()).childParentBlockedTips).toBeUndefined();

    rmSync(TEST_REPO_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_REPO_ROOT, { recursive: true });
    writeArchiveTask('CHILD', { root_task_id: 'ROOT', parent_task_id: 'ROOT' });
    await writeChildTaskChains(TEST_REPO_ROOT, chain('completed'));
    expect((await list()).childParentBlockedTips).toBeUndefined();

    writeFileSync(join(TEST_REPO_ROOT, '.platform-state', 'child-task-chains.json'), '{bad json');
    const invalid = await list();
    expect(invalid.childChainStateStatus?.status).toBe('invalid');
    expect(invalid.childParentBlockedTips).toBeUndefined();
  });
});
