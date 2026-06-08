// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeChildTaskChains, type ChildTaskChainsState } from '../../../../backend/platform/queue/childTaskChains.js';
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

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../../backend/platform/core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../backend/platform/core/index.js')>();
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: loggerMock.info,
      warn: loggerMock.warn,
      error: vi.fn(),
      progress: vi.fn(),
      child: vi.fn(),
    })),
  };
});

function createCatalog(): ContextPackListResponse {
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
  const archiveDir = join(
    TEST_REPO_ROOT,
    'AgentWorkSpace',
    'qmd',
    'context-packs',
    'test',
    'archive',
    'tasks',
    '2026',
  );
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(join(archiveDir, `${taskId}.md`), `# ${taskId}\n\n- Task ID: ${taskId}\n`);
  writeFileSync(
    join(archiveDir, `${taskId}.json`),
    `${JSON.stringify({
      record_id: `task:test:${taskId}`,
      task_id: taskId,
      root_task_id: taskId,
      completed_work_summary: 'Done.',
      branch_handoffs: [{
        repo_root: '/repo',
        repo_label: 'Repo',
        branch: `task/${taskId}`,
        base_commit_sha: 'base',
        head_commit_sha: 'head',
        commits_ahead: 1,
        status: 'ready-for-operator-review',
      }],
      ...json,
    }, null, 2)}\n`,
  );
}

function state(overrides: Partial<ChildTaskChainsState>): ChildTaskChainsState {
  return {
    schemaVersion: 1,
    updatedAt: '2026-05-19T00:00:00.000Z',
    chains: {},
    tasks: {},
    ...overrides,
  };
}

function taskRecord(taskId: string, rootTaskId: string, depth: number, taskState: 'planned' | 'pending' | 'active' | 'completed' | 'failed') {
  return {
    taskId,
    rootTaskId,
    parentTaskId: depth === 0 ? null : 'ROOT',
    previousTaskId: depth === 0 ? null : 'ROOT',
    depth,
    state: taskState,
    archivePath: `/archive/${taskId}.md`,
    archiveArtifactDir: null,
    parentArchivePath: null,
    parentArchiveArtifactDir: null,
    parentContextSnapshot: null,
    childExecutionScope: null,
    branchChain: null,
    completedBranchHandoffs: null,
    completedAt: taskState === 'completed' ? '2026-05-19T00:00:00.000Z' : null,
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
  };
}

async function listTasks(): Promise<PlannerListArchivedTasksResponse> {
  const result = await listArchivedTasksAction(vi.fn().mockResolvedValue(createCatalog()));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.response.action).toBe('planner.listArchivedTasks');
  return result.response as PlannerListArchivedTasksResponse;
}

describe('listArchivedTasksAction child parent eligibility', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'archived-parent-eligibility-'));
    TEST_REPO_ROOT = mkdtempSync(join(tmpRoot, 'repo-root-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('marks standalone roots absent from chain state eligible', async () => {
    writeArchiveTask('ROOT');

    const response = await listTasks();

    expect(response.tasks[0]?.childParentEligibility).toEqual(expect.objectContaining({
      eligible: true,
      reason: 'standalone-root',
      rootTaskId: 'ROOT',
      currentTipTaskId: null,
      currentTipState: null,
    }));
  });

  it('marks only the completed current chain tip eligible', async () => {
    writeArchiveTask('ROOT');
    writeArchiveTask('CHILD', { root_task_id: 'ROOT', parent_task_id: 'ROOT' });
    await writeChildTaskChains(TEST_REPO_ROOT, state({
      chains: { ROOT: { rootTaskId: 'ROOT', currentTipTaskId: 'CHILD', contextPackId: 'test', contextPackDir: '/packs/test', taskIds: ['ROOT', 'CHILD'], createdAt: '2026-05-19T00:00:00.000Z', updatedAt: '2026-05-19T00:00:00.000Z' } },
      tasks: {
        ROOT: taskRecord('ROOT', 'ROOT', 0, 'completed'),
        CHILD: taskRecord('CHILD', 'ROOT', 1, 'completed'),
      },
    }));

    const response = await listTasks();
    const byId = new Map(response.tasks.map((task) => [task.taskId, task.childParentEligibility]));

    expect(byId.get('CHILD')).toEqual(expect.objectContaining({ eligible: true, reason: 'current-chain-tip' }));
    expect(byId.get('ROOT')).toEqual(expect.objectContaining({ eligible: false, reason: 'not-current-chain-tip' }));
  });

  it.each(['planned', 'pending', 'active', 'failed'] as const)('marks previous parent ineligible when a %s tip is reserved', async (tipState) => {
    writeArchiveTask('ROOT');
    await writeChildTaskChains(TEST_REPO_ROOT, state({
      chains: { ROOT: { rootTaskId: 'ROOT', currentTipTaskId: 'CHILD', contextPackId: 'test', contextPackDir: '/packs/test', taskIds: ['ROOT', 'CHILD'], createdAt: '2026-05-19T00:00:00.000Z', updatedAt: '2026-05-19T00:00:00.000Z' } },
      tasks: {
        ROOT: taskRecord('ROOT', 'ROOT', 0, 'completed'),
        CHILD: taskRecord('CHILD', 'ROOT', 1, tipState),
      },
    }));

    const response = await listTasks();

    expect(response.tasks[0]?.childParentEligibility).toEqual(expect.objectContaining({
      eligible: false,
      reason: 'reserved-by-unarchived-tip',
      currentTipTaskId: 'CHILD',
      currentTipState: tipState,
    }));
  });

  it('marks legacy archived children absent from chain state ineligible', async () => {
    writeArchiveTask('LEGACY-CHILD', { root_task_id: 'ROOT', parent_task_id: 'ROOT' });

    const response = await listTasks();

    expect(response.tasks[0]?.childParentEligibility).toEqual(expect.objectContaining({
      eligible: false,
      reason: 'legacy-child-without-chain-state',
      rootTaskId: 'ROOT',
    }));
  });

  it('fails parent eligibility closed when child-chain state is invalid', async () => {
    writeArchiveTask('ROOT');
    mkdirSync(join(TEST_REPO_ROOT, '.platform-state'), { recursive: true });
    writeFileSync(join(TEST_REPO_ROOT, '.platform-state', 'child-task-chains.json'), '{"schemaVersion":1}\n');

    const response = await listTasks();

    expect(response.childChainStateStatus?.status).toBe('invalid');
    expect(response.tasks[0]?.childParentEligibility).toEqual(expect.objectContaining({
      eligible: false,
      reason: 'child-chain-state-invalid',
    }));
  });
});
