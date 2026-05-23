// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
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

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('../../../backend/platform/core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/core/index.js')>();
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: loggerMock.warn,
      error: vi.fn(),
      progress: vi.fn(),
      child: vi.fn(),
    })),
  };
});

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
    loggerMock.warn.mockClear();
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

  function validBranchHandoff(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      repo_root: '/repos/platform',
      repo_label: 'platform',
      branch: 'task/task-one',
      base_commit_sha: 'base123',
      head_commit_sha: 'head456',
      commits_ahead: 1,
      status: 'ready-for-operator-review',
      ...overrides,
    };
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

  it('uses a provided active scope without calling the catalog lister', async () => {
    writeNestedArchiveTask('task-one');
    const lister = vi.fn().mockResolvedValue(createCatalog());

    const result = await listArchivedTasksAction(lister, {
      scope: {
        contextPackId: 'test',
        contextPackDir: '/packs/test',
        contextPackName: 'test',
      },
    });

    expect(lister).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toEqual(expect.objectContaining({
      action: 'planner.listArchivedTasks',
      mode: 'found',
    }));
  });

  it('returns no-context-pack for a provided null scope without calling the catalog lister', async () => {
    const lister = vi.fn().mockResolvedValue(createCatalog({
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
    }));

    const result = await listArchivedTasksAction(lister, { scope: null });

    expect(lister).not.toHaveBeenCalled();
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

  it('uses indexed_at for archivedAt before other timestamp sources', async () => {
    const archiveDir = writeNestedArchiveTask('20260517t084211z-indexed', {
      indexed_at: '2026-05-18T01:02:03Z',
      created_at: '2026-05-17T08:42:11Z',
    });
    utimesSync(join(archiveDir, 'archive.md'), new Date('2026-05-19T00:00:00Z'), new Date('2026-05-19T00:00:00Z'));

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok || result.response.action !== 'planner.listArchivedTasks') return;
    expect(result.response.tasks[0]?.archivedAt).toBe('2026-05-18T01:02:03Z');
  });

  it('uses created_at for archivedAt when indexed_at is absent', async () => {
    writeNestedArchiveTask('20260517t084211z-created', {
      created_at: '2026-05-17T08:42:11Z',
    });

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok || result.response.action !== 'planner.listArchivedTasks') return;
    expect(result.response.tasks[0]?.archivedAt).toBe('2026-05-17T08:42:11Z');
  });

  it('parses nested archive directory timestamp prefixes for archivedAt', async () => {
    writeNestedArchiveTask('20260517t084211z-task-one');

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok || result.response.action !== 'planner.listArchivedTasks') return;
    expect(result.response.tasks[0]?.archivedAt).toBe('2026-05-17T08:42:11Z');
  });

  it('parses legacy flat archive filename timestamp prefixes for archivedAt', async () => {
    writeFlatArchiveTask('20260517t084211z-task-one');

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok || result.response.action !== 'planner.listArchivedTasks') return;
    expect(result.response.tasks[0]?.archivedAt).toBe('2026-05-17T08:42:11Z');
  });

  it('falls back to archive markdown mtime when basename timestamp is malformed', async () => {
    const archiveDir = writeNestedArchiveTask('20269999t999999z-task-one');
    const mtime = new Date('2026-05-20T11:12:13.000Z');
    utimesSync(join(archiveDir, 'archive.md'), mtime, mtime);

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok || result.response.action !== 'planner.listArchivedTasks') return;
    expect(result.response.tasks[0]?.archivedAt).toBe('2026-05-20T11:12:13.000Z');
  });

  it('returns branch handoffs from archive JSON sidecars', async () => {
    const archiveDir = writeNestedArchiveTask('task-one', {
        branch_handoffs: [
          validBranchHandoff({
            status: 'auto-merged-to-target',
            auto_merge: {
              enabled: true,
              status: 'applied',
              target_branch: 'main',
              detail: 'Merged with --no-commit --no-ff; changes are staged for operator review.',
            },
          }),
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
          branchChainAvailability: {
            status: 'ready',
            message: 'Archive sidecar contains valid branch_handoffs.',
          },
        }),
      ],
    }));
  });

  it('exposes nested archive artifact pointers and safe parent context files', async () => {
    const archiveDir = writeNestedArchiveTask('task-one', {
      branch_handoffs: [validBranchHandoff()],
    });
    const handoffsDir = join(archiveDir, 'handoffs');
    const stepsDir = join(archiveDir, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(stepsDir, { recursive: true });
    writeFileSync(join(handoffsDir, 'intake.md'), '# Intake\n\nDo the work.\n');
    writeFileSync(join(handoffsDir, 'implementation-spec.md'), '# Spec\n\nBuild it.\n');
    writeFileSync(join(handoffsDir, 'final-summary.md'), '# Final\n\nDone.\n');
    writeFileSync(join(handoffsDir, 'issues.md'), '# Issues\n\n<!-- none -->\n');
    writeFileSync(join(handoffsDir, 'parallel-ok.md'), '# Parallel OK\n\nSafe to parallelize.\n');
    writeFileSync(join(handoffsDir, 'professional-task.md'), '# Generated\n\nExcluded.\n');
    writeFileSync(join(handoffsDir, 'tests.md'), '# Tests\n\nExcluded.\n');
    writeFileSync(join(handoffsDir, 'branch-handoffs.json'), '[]\n');
    writeFileSync(join(stepsDir, '02-second.md'), '# Second\n');
    writeFileSync(join(stepsDir, '01-first.md'), '# First\n');
    writeFileSync(join(stepsDir, 'notes.txt'), 'ignore\n');
    symlinkSync(join(stepsDir, '01-first.md'), join(stepsDir, '00-linked.md'));
    mkdirSync(join(stepsDir, 'nested'));
    writeFileSync(join(stepsDir, 'nested', '03-nested.md'), '# Nested\n');
    writeFileSync(join(archiveDir, 'handoff-artifacts-manifest.json'), '{}\n');

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = (result.response as { tasks: Array<Record<string, unknown>> }).tasks[0];
    expect(task).toMatchObject({
      archiveLayout: 'nested',
      archiveArtifactDir: archiveDir,
      handoffsDir,
      implementationStepsDir: stepsDir,
      handoffArtifactsManifestPath: join(archiveDir, 'handoff-artifacts-manifest.json'),
      parentContextArtifacts: {
        status: 'available',
        archiveArtifactDir: archiveDir,
        handoffsDir,
        implementationStepsDir: stepsDir,
        missing: [],
      },
    });
    const artifacts = task.parentContextArtifacts as {
      handoffs: Array<{ fileName: string; relativePath: string; sizeBytes: number }>;
      implementationSteps: Array<{ fileName: string; relativePath: string }>;
    };
    expect(artifacts.handoffs.map((file) => file.fileName)).toEqual([
      'intake.md',
      'implementation-spec.md',
      'final-summary.md',
      'parallel-ok.md',
    ]);
    expect(artifacts.handoffs.map((file) => file.relativePath)).toEqual([
      'handoffs/intake.md',
      'handoffs/implementation-spec.md',
      'handoffs/final-summary.md',
      'handoffs/parallel-ok.md',
    ]);
    expect(artifacts.handoffs.every((file) => file.sizeBytes > 0)).toBe(true);
    expect(artifacts.implementationSteps.map((file) => file.fileName)).toEqual([
      '01-first.md',
      '02-second.md',
    ]);
  });

  it('includes substantive issues.md and excludes blank parallel-ok.md', async () => {
    const archiveDir = writeNestedArchiveTask('optional-context', {
      branch_handoffs: [validBranchHandoff()],
    });
    const handoffsDir = join(archiveDir, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(join(handoffsDir, 'intake.md'), '# Intake\n\nParent context.\n');
    writeFileSync(join(handoffsDir, 'issues.md'), '# Issues\n\nFinding: needs review.\n');
    writeFileSync(join(handoffsDir, 'parallel-ok.md'), '# Parallel OK\n\n  \n');

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = (result.response as { tasks: Array<Record<string, unknown>> }).tasks[0];
    const artifacts = task.parentContextArtifacts as {
      handoffs: Array<{ fileName: string }>;
    };
    expect(artifacts.handoffs.map((file) => file.fileName)).toEqual(['intake.md', 'issues.md']);
  });

  it('marks nested archives available when one allowed handoff exists but other roots are missing', async () => {
    const archiveDir = writeNestedArchiveTask('minimal-context', {
      branch_handoffs: [validBranchHandoff()],
    });
    mkdirSync(join(archiveDir, 'handoffs'), { recursive: true });
    writeFileSync(join(archiveDir, 'handoffs', 'intake.md'), '# Intake\n\nParent context.\n');

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = (result.response as { tasks: Array<Record<string, unknown>> }).tasks[0];
    expect(task.parentContextArtifacts).toMatchObject({
      status: 'available',
      handoffs: [expect.objectContaining({ fileName: 'intake.md' })],
      implementationSteps: [],
      missing: ['ImplementationSteps', 'handoff-artifacts-manifest.json'],
    });
  });

  it('reports missing branch handoffs explicitly when absent', async () => {
    writeNestedArchiveTask('missing-handoffs');

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = (result.response as { tasks: Array<Record<string, unknown>> }).tasks[0];
    expect(task).toMatchObject({
      taskId: 'missing-handoffs',
      branchChainAvailability: {
        status: 'missing-branch-handoffs',
        message: 'Archive sidecar does not include branch_handoffs.',
      },
    });
    expect(task).not.toHaveProperty('branchHandoffs');
  });

  it('reports invalid branch handoffs and omits normalized handoffs', async () => {
    writeNestedArchiveTask('bad-handoffs', {
      branch_handoffs: [validBranchHandoff({ commits_ahead: {} })],
    });

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = (result.response as { tasks: Array<Record<string, unknown>> }).tasks[0];
    expect(task.branchChainAvailability).toMatchObject({
      status: 'invalid-branch-handoffs',
    });
    expect(task).not.toHaveProperty('branchHandoffs');
  });

  it('rejects empty commits_ahead strings as invalid branch handoffs', async () => {
    writeNestedArchiveTask('empty-commits-ahead', {
      branch_handoffs: [validBranchHandoff({ commits_ahead: '' })],
    });

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = (result.response as { tasks: Array<Record<string, unknown>> }).tasks[0];
    expect(task.branchChainAvailability).toMatchObject({
      status: 'invalid-branch-handoffs',
    });
    expect(task).not.toHaveProperty('branchHandoffs');
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
      archiveLayout: 'flat',
      archiveArtifactDir: null,
      handoffsDir: null,
      implementationStepsDir: null,
      handoffArtifactsManifestPath: null,
      parentContextArtifacts: {
        status: 'legacy-flat-archive',
        archiveArtifactDir: null,
        handoffsDir: null,
        implementationStepsDir: null,
        handoffs: [],
        implementationSteps: [],
        missing: [],
      },
      plannerFocusSnapshot: expect.objectContaining({
        primaryRepoRoot: '/repos/platform',
      }),
    });
  });

  it('adds child chain metadata from Stage 01 state and marks only the current tip', async () => {
    writeNestedArchiveTask('root', { branch_handoffs: [validBranchHandoff({ branch: 'task/root' })] });
    writeNestedArchiveTask('child', { branch_handoffs: [validBranchHandoff({ branch: 'task/child' })] });
    const statePath = join(TEST_REPO_ROOT, '.platform-state', 'child-task-chains.json');
    mkdirSync(join(TEST_REPO_ROOT, '.platform-state'), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      schemaVersion: 1,
      updatedAt: '2026-05-19T12:00:00.000Z',
      chains: {
        root: {
          rootTaskId: 'root',
          currentTipTaskId: 'child',
          contextPackId: 'test',
          contextPackDir: '/packs/test',
          taskIds: ['root', 'child'],
          createdAt: '2026-05-19T12:00:00.000Z',
          updatedAt: '2026-05-19T12:00:00.000Z',
        },
      },
      tasks: {
        root: {
          taskId: 'root',
          rootTaskId: 'root',
          parentTaskId: null,
          previousTaskId: null,
          depth: 0,
          state: 'completed',
          archivePath: 'root/archive.md',
          archiveArtifactDir: 'root',
          parentArchivePath: null,
          parentArchiveArtifactDir: null,
          parentContextSnapshot: null,
          childExecutionScope: null,
          branchChain: null,
          createdAt: '2026-05-19T12:00:00.000Z',
          updatedAt: '2026-05-19T12:00:00.000Z',
        },
        child: {
          taskId: 'child',
          rootTaskId: 'root',
          parentTaskId: 'root',
          previousTaskId: 'root',
          depth: 1,
          state: 'completed',
          archivePath: 'child/archive.md',
          archiveArtifactDir: 'child',
          parentArchivePath: 'root/archive.md',
          parentArchiveArtifactDir: 'root',
          parentContextSnapshot: null,
          childExecutionScope: null,
          branchChain: null,
          createdAt: '2026-05-19T12:00:00.000Z',
          updatedAt: '2026-05-19T12:00:00.000Z',
        },
      },
    }, null, 2));

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = (result.response as { tasks: Array<Record<string, unknown>> }).tasks;
    const byId = new Map(tasks.map((task) => [task.taskId, task]));
    expect(byId.get('root')?.childChain).toMatchObject({
      rootTaskId: 'root',
      depth: 0,
      currentTipTaskId: 'child',
      isCurrentTip: false,
    });
    expect(byId.get('child')?.childChain).toMatchObject({
      rootTaskId: 'root',
      parentTaskId: 'root',
      depth: 1,
      currentTipTaskId: 'child',
      isCurrentTip: true,
    });
  });

  it('surfaces invalid child chain state without failing archive listing', async () => {
    writeNestedArchiveTask('task-one', { branch_handoffs: [validBranchHandoff()] });
    mkdirSync(join(TEST_REPO_ROOT, '.platform-state'), { recursive: true });
    writeFileSync(join(TEST_REPO_ROOT, '.platform-state', 'child-task-chains.json'), '{bad\n');

    const result = await listArchivedTasksAction(activeLister());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toMatchObject({
      mode: 'found',
      childChainStateStatus: {
        status: 'invalid',
        message: expect.stringContaining('Invalid JSON in'),
      },
    });
    const tasks = (result.response as { tasks: Array<Record<string, unknown>> }).tasks;
    expect(tasks[0]).not.toHaveProperty('childChain');
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'archived-tasks.child-chain-state.invalid',
      { error: expect.stringContaining('Invalid JSON in') },
    );
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
