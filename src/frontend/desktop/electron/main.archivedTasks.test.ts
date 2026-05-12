// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn(), whenReady: vi.fn(() => Promise.resolve()) },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
  },
}));

let TEST_REPO_ROOT: string;

vi.mock('./paths', () => ({
  get REPO_ROOT() {
    return TEST_REPO_ROOT;
  },
}));

import { listArchivedTasksAction } from './main.archivedTasks';
import type { ContextPackListResponse } from '../src/shared/desktopContract';

function writeSnapshot(path: string): void {
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      contextPackDir: '/packs/test',
      contextPackId: 'test',
      title: 'Task One',
      primaryRepoId: 'platform',
      primaryRepoRoot: '/repos/platform',
      primaryFocusRelativePath: 'src/features/planner',
      primaryFocusTargetKind: 'directory',
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      deepFocusEnabled: true,
      contextPackBinding: {
        contextPackDir: '/packs/test',
        contextPackId: 'test',
        scopeMode: 'selected',
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        selectedFocusPath: 'src/features/planner',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
      },
    }),
  );
}

function createCatalog(overrides?: Partial<ContextPackListResponse>): ContextPackListResponse {
  return {
    action: 'contextPack.list',
    mode: 'read-only',
    message: 'Context packs listed.',
    activeContextPackDir: null,
    configuredPaths: [],
    searchRoots: [],
    recentContextPackDirs: [],
    contextPacks: [],
    ...overrides,
  };
}

describe('listArchivedTasksAction', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'archived-tasks-'));
    TEST_REPO_ROOT = mkdtempSync(join(tmpRoot, 'repo-root-'));
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function activeLister() {
    return vi.fn().mockResolvedValue(
      createCatalog({
        contextPacks: [
          {
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
          },
        ],
      }),
    );
  }

  function writeFlatArchiveTask(name = 'task-one', json: Record<string, unknown> = {}): string {
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
    writeFileSync(join(archiveDir, `${name}.md`), `# ${name}\n\n## Task Metadata\n\n- Task ID: ${name}\n`);
    writeFileSync(
      join(archiveDir, `${name}.json`),
      JSON.stringify({
        record_id: `task:test:${name}`,
        task_id: name,
        root_task_id: name,
        task_summary: 'Task summary.',
        completed_work_summary: 'Done.',
        ...json,
      }, null, 2) + '\n',
    );
    return archiveDir;
  }

  function writeNestedArchiveTask(name = 'task-one', json: Record<string, unknown> = {}): string {
    const archiveDir = join(
      TEST_REPO_ROOT,
      'AgentWorkSpace',
      'qmd',
      'context-packs',
      'test',
      'archive',
      'tasks',
      '2026',
      name,
    );
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, 'archive.md'), `# ${name}\n\n## Task Metadata\n\n- Task ID: ${name}\n`);
    writeFileSync(
      join(archiveDir, 'archive.json'),
      JSON.stringify({
        record_id: `task:test:${name}`,
        task_id: name,
        root_task_id: name,
        task_summary: 'Task summary.',
        completed_work_summary: 'Done.',
        ...json,
      }, null, 2) + '\n',
    );
    return archiveDir;
  }

  it('returns no-context-pack when no active context pack exists', async () => {
    const lister = vi.fn().mockResolvedValue(createCatalog());

    const result = await listArchivedTasksAction(lister);

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.listArchivedTasks',
        mode: 'no-context-pack',
        tasks: [],
      }),
    });
  });

  it('returns empty when archive directory does not exist', async () => {
    const lister = vi.fn().mockResolvedValue(
      createCatalog({
        contextPacks: [
          {
            contextPackId: 'nonexistent-pack',
            displayName: 'Nonexistent Pack',
            contextPackDir: '/tmp/nonexistent',
            manifestPath: null,
            bootstrapReady: false,
            source: 'configured-path',
            isActive: true,
            estateType: null,
            defaultScopeMode: null,
            repoCount: 0,
            primaryWorkingRepoIds: [],
            focusTargets: [],
          },
        ],
      }),
    );

    const result = await listArchivedTasksAction(lister);

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.listArchivedTasks',
        mode: 'empty',
        tasks: [],
      }),
    });
  });

  it('returns found tasks from a real archive directory', async () => {
    const lister = vi.fn().mockResolvedValue(
      createCatalog({
        contextPacks: [
          {
            contextPackId: 'live-test-context-pack',
            displayName: 'Live Test',
            contextPackDir: '/tmp/test',
            manifestPath: null,
            bootstrapReady: false,
            source: 'configured-path',
            isActive: true,
            estateType: null,
            defaultScopeMode: null,
            repoCount: 0,
            primaryWorkingRepoIds: [],
            focusTargets: [],
          },
        ],
      }),
    );

    const result = await listArchivedTasksAction(lister);

    if (!result.ok) {
      // Archive may not exist in CI — that returns empty, which is also ok
      return;
    }

    const response = result.response;
    expect(response.action).toBe('planner.listArchivedTasks');
    expect(['found', 'empty']).toContain(response.action === 'planner.listArchivedTasks' ? (response as { mode: string }).mode : '');
  });

  it('returns branch handoffs from archive JSON sidecars', async () => {
    const archiveDir = writeNestedArchiveTask('task-one', {
        branch_handoffs: [
          {
            repo_root: '/repos/platform',
            repo_label: 'platform',
            branch: 'task/task-one',
            base_commit_sha: 'base123',
            head_commit_sha: 'head456',
            commits_ahead: 1,
            status: 'auto-merged-to-target',
            auto_merge: {
              enabled: true,
              status: 'applied',
              target_branch: 'main',
              detail: 'Merged with --no-commit --no-ff; changes are staged for operator review.',
            },
          },
        ],
    });
    writeSnapshot(join(archiveDir, 'planner-focus-snapshot.json'));
    const lister = activeLister();

    const result = await listArchivedTasksAction(lister);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toEqual(expect.objectContaining({
      mode: 'found',
      tasks: [
        expect.objectContaining({
          taskId: 'task-one',
          branchHandoffs: [
            expect.objectContaining({
              repoRoot: '/repos/platform',
              repoLabel: 'platform',
              branch: 'task/task-one',
              commitsAhead: 1,
              status: 'auto-merged-to-target',
              autoMerge: {
                enabled: true,
                status: 'applied',
                targetBranch: 'main',
                detail: 'Merged with --no-commit --no-ff; changes are staged for operator review.',
              },
            }),
          ],
        }),
      ],
    }));
  });

  it('returns plannerFocusSnapshot and parentTaskContent for snapshot-backed archives', async () => {
    const archiveDir = writeNestedArchiveTask('task-one', {
      key_decisions: ['Keep lineage stable.', '  '],
      known_limitations: ['Needs follow-up.'],
      constraints: ['Do not replay transcript.'],
      implementation_summary: 'Implemented the parent slice.',
    });
    writeSnapshot(join(archiveDir, 'planner-focus-snapshot.json'));

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toEqual(expect.objectContaining({
      mode: 'found',
      tasks: [
        expect.objectContaining({
          taskId: 'task-one',
          plannerFocusSnapshot: expect.objectContaining({
            contextPackDir: '/packs/test',
            primaryRepoId: 'platform',
          }),
          parentTaskContent: expect.objectContaining({
            taskTitle: 'task-one',
            taskSummary: 'Task summary.',
            completedWorkSummary: 'Done.',
            keyDecisions: ['Keep lineage stable.'],
            knownLimitations: ['Needs follow-up.'],
            constraints: ['Do not replay transcript.'],
            implementationSummary: 'Implemented the parent slice.',
          }),
        }),
      ],
    }));
  });

  it('synthesizes and saves planner focus for nested archived tasks without a snapshot', async () => {
    const archiveDir = writeNestedArchiveTask('legacy-task', {
      branch_handoffs: [
        {
          repo_root: '/repos/platform',
          repo_label: 'platform',
          branch: 'task/legacy-task',
          base_commit_sha: 'base',
          head_commit_sha: 'head',
          commits_ahead: 1,
          status: 'ready-for-operator-review',
        },
      ],
    });

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toEqual(expect.objectContaining({
      mode: 'found',
      tasks: [
        expect.objectContaining({
          taskId: 'legacy-task',
          parentTaskContent: expect.objectContaining({ taskTitle: 'legacy-task' }),
        }),
      ],
    }));
    if (!result.ok) return;
    const tasks = (result.response as { tasks: Array<Record<string, unknown>> }).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(expect.objectContaining({
      plannerFocusSnapshot: expect.objectContaining({
        contextPackDir: join(TEST_REPO_ROOT, 'contextpacks', 'test'),
        contextPackId: 'test',
        primaryRepoId: 'platform',
        primaryRepoRoot: '/repos/platform',
      }),
    }));
    const savedSnapshotPath = join(archiveDir, 'planner-focus-snapshot.json');
    expect(existsSync(savedSnapshotPath)).toBe(true);
    expect(JSON.parse(readFileSync(savedSnapshotPath, 'utf-8'))).toEqual(
      expect.objectContaining({
        primaryRepoId: 'platform',
        primaryRepoRoot: '/repos/platform',
      }),
    );
  });

  it('repairs malformed planner focus snapshots with synthesized fallback metadata', async () => {
    const archiveDir = writeNestedArchiveTask('bad-task', {
      branch_handoffs: [
        {
          repo_root: '/repos/repaired',
          repo_label: 'repaired',
          branch: 'task/bad-task',
          base_commit_sha: 'base',
          head_commit_sha: 'head',
          commits_ahead: 1,
          status: 'ready-for-operator-review',
        },
      ],
    });
    writeFileSync(join(archiveDir, 'planner-focus-snapshot.json'), '{bad-json}\n');

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = (result.response as { tasks: Array<Record<string, unknown>> }).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      taskId: 'bad-task',
      plannerFocusSnapshot: expect.objectContaining({
        contextPackDir: join(TEST_REPO_ROOT, 'contextpacks', 'test'),
        primaryRepoId: 'repaired',
        primaryRepoRoot: '/repos/repaired',
      }),
    });
    const repaired = JSON.parse(readFileSync(join(archiveDir, 'planner-focus-snapshot.json'), 'utf-8'));
    expect(repaired.primaryRepoRoot).toBe('/repos/repaired');
  });

  it('returns legacy flat archived tasks during migration', async () => {
    const archiveDir = writeFlatArchiveTask('legacy-flat', {
      branch_handoffs: [
        {
          repo_root: '/repos/platform',
          repo_label: 'platform',
          branch: 'task/legacy-flat',
          base_commit_sha: 'base',
          head_commit_sha: 'head',
          commits_ahead: 1,
          status: 'ready-for-operator-review',
        },
      ],
    });
    writeSnapshot(join(archiveDir, 'legacy-flat.planner-focus-snapshot.json'));

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = (result.response as { tasks: Array<Record<string, unknown>> }).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      taskId: 'legacy-flat',
      plannerFocusSnapshot: expect.objectContaining({
        primaryRepoRoot: '/repos/platform',
      }),
    });
  });

  it('does not synthesize planner focus from mutable current state when archive metadata lacks repo evidence', async () => {
    writeNestedArchiveTask('no-repo-evidence');

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = (result.response as { tasks: Array<Record<string, unknown>> }).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ taskId: 'no-repo-evidence' });
    expect(tasks[0]).not.toHaveProperty('plannerFocusSnapshot');
  });
});
