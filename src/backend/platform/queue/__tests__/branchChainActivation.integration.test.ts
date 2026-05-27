import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

import { formatBranchChainSection, formatContextPackBindingSection, type TaskBranchChainBinding } from '../markdown.js';
import { HANDOFF_FILES, SLICE_TEMPLATE_FILENAME, resolveQueuePaths } from '../paths.js';
import { loadTaskRegistry, registerTask } from '../taskRegistry.js';
import { writeQueueOrderManifest } from '../queueOrderManifest.js';
import {
  readChildTaskChains,
  writeChildTaskChains,
  type ChildTaskContextSnapshot,
} from '../childTaskChains.js';

const startPipeline = vi.fn();

vi.mock('../../agent-runner/pipelineSupervisor.js', () => ({
  startPipeline,
}));

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf-8' }).trim();
}

function initGitRepo(repoDir: string): string {
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, ['init']);
  git(repoDir, ['config', 'user.email', 'test@example.com']);
  git(repoDir, ['config', 'user.name', 'Test User']);
  writeFileSync(path.join(repoDir, 'README.md'), '# repo\n', 'utf-8');
  writeFileSync(path.join(repoDir, '.gitignore'), 'AgentWorkSpace/\n.platform-state/\ncontextpacks/\n', 'utf-8');
  git(repoDir, ['add', 'README.md', '.gitignore']);
  git(repoDir, ['commit', '-m', 'initial']);
  return git(repoDir, ['rev-parse', 'HEAD']);
}

function seedTemplates(templatesDir: string): void {
  mkdirSync(templatesDir, { recursive: true });
  for (const filename of HANDOFF_FILES) {
    writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`, 'utf-8');
  }
  writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n', 'utf-8');
}

function branchChain(repoRoot: string, taskIds: {
  rootTaskId?: string;
  parentTaskId?: string;
  chainSourceBranch?: string;
  targetBranch?: string | null;
} = {}): TaskBranchChainBinding {
  const rootTaskId = taskIds.rootTaskId ?? 'root-task';
  let parentBranchHead = '0'.repeat(40);
  try {
    parentBranchHead = git(repoRoot, ['rev-parse', 'HEAD']);
  } catch {
    // Missing repo roots are used by failure tests that must not get past mapping validation.
  }
  return {
    schemaVersion: 1,
    mode: 'continuation',
    rootTaskId,
    parentTaskId: taskIds.parentTaskId ?? 'parent-task',
    depth: 1,
    repos: [{
      repoRoot,
      repoLabel: path.basename(repoRoot),
      chainSourceBranch: taskIds.chainSourceBranch ?? `task/${rootTaskId}`,
      parentSourceBranch: taskIds.chainSourceBranch ?? `task/${rootTaskId}`,
      parentBranchHead,
      targetBranch: taskIds.targetBranch ?? 'main',
    }],
  };
}

function pendingMarkdown(taskId: string, title: string, options: {
  taskKind?: string;
  parentTaskId?: string;
  rootTaskId?: string;
  branchChain?: TaskBranchChainBinding | string;
  contextPackBinding?: string;
} = {}): string {
  const sections = [
    `# ${title}`,
    '',
    '## Task Lineage',
    '',
    `- Task Kind: ${options.taskKind ?? 'child-task'}`,
    `- Parent Task ID: ${options.parentTaskId ?? 'parent-task'}`,
    `- Root Task ID: ${options.rootTaskId ?? 'root-task'}`,
    '- Parent QMD Record ID:',
    '- Parent QMD Scope:',
    '- Follow-Up Reason:',
  ];
  if (options.contextPackBinding) {
    sections.push('', options.contextPackBinding);
  }
  if (typeof options.branchChain === 'string') {
    sections.push('', options.branchChain);
  } else if (options.branchChain) {
    sections.push('', formatBranchChainSection(options.branchChain));
  }
  return `${sections.join('\n')}\n`;
}

async function seedPending(repoRoot: string, taskId: string, content: string): Promise<void> {
  const paths = resolveQueuePaths(repoRoot);
  seedTemplates(paths.templatesDir);
  mkdirSync(paths.pendingDir, { recursive: true });
  writeFileSync(path.join(paths.pendingDir, `${taskId}.md`), content, 'utf-8');
  await writeQueueOrderManifest(paths.queueOrderPath, [`${taskId}.md`]);
  await registerTask(repoRoot, {
    taskId,
    fileName: `${taskId}.md`,
    title: taskId,
    state: 'pending',
    contextPackId: null,
    contextPackDir: null,
    scopeMode: null,
    selectedRepoIds: [],
    selectedFocusIds: [],
    createdAt: new Date().toISOString(),
    completedAt: null,
    archivePath: null,
  });
  try {
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-m', `seed ${taskId}`]);
  } catch {
    // Some fixtures use non-platform git roots; dirty guard is only relevant when this succeeds.
  }
}

function readSidecar(repoRoot: string, taskId: string): {
  taskId: string;
  contextPackBinding: { repoBindings: Array<{
    worktreeRoot: string;
    worktreeBranch: string;
    baseCommitSha: string;
    branchOwnership?: string;
    branchChainRootTaskId?: string;
    branchChainTaskId?: string;
  }> };
} {
  return JSON.parse(readFileSync(
    path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json'),
    'utf-8',
  )) as ReturnType<typeof readSidecar>;
}

function childTaskSnapshot(): ChildTaskContextSnapshot {
  return {
    contextPackDir: null,
    contextPackId: null,
    scopeMode: 'focused',
    primaryRepoId: 'platform',
    primaryFocusId: null,
    selectedRepoIds: ['platform'],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
  };
}

function writeDistributedContextPack(contextPackDir: string, repos: Array<{ id: string; root: string }>): void {
  mkdirSync(path.join(contextPackDir, 'qmd'), { recursive: true });
  writeFileSync(path.join(contextPackDir, 'qmd', 'repo-sources.json'), JSON.stringify({
    manifest_version: 'qmd-repo-sources/v1',
    manifest_status: 'approved',
    context_pack_id: path.basename(contextPackDir),
    estate_type: 'distributed-platform',
    qmd_scope_root: `qmd/context-packs/${path.basename(contextPackDir)}`,
    repositories: repos.map((repo, index) => ({
      repo_id: repo.id,
      local_paths: [repo.root],
      repository_type: 'primary',
      default_focusable: true,
      activation_priority: 100 - index,
    })),
    primary_working_repo_ids: repos.map((repo) => repo.id),
    primary_focus_area_ids: [],
  }, null, 2), 'utf-8');
}

function distributedContextBinding(contextPackDir: string, selectedRepoIds: string[]): string {
  return formatContextPackBindingSection({
    contextPackDir,
    contextPackId: path.basename(contextPackDir),
    scopeMode: 'regular',
    selectedRepoIds,
    selectedFocusIds: [],
    repositoryTypes: Object.fromEntries(
      selectedRepoIds.map((repoId) => [repoId, 'primary' as const]),
    ),
    primaryRepoId: selectedRepoIds[0],
  });
}

function chainForRepos(repos: TaskBranchChainBinding['repos']): TaskBranchChainBinding {
  return {
    schemaVersion: 1,
    mode: 'continuation',
    rootTaskId: 'root-task',
    parentTaskId: 'parent-task',
    depth: 1,
    repos,
  };
}

describe('branch chain activation integration', () => {
  let repoRoot: string;
  let previousAutostart: string | undefined;
  const extraTempDirs: string[] = [];

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'branch-chain-activation-'));
    previousAutostart = process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = 'true';
    startPipeline.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    if (previousAutostart === undefined) {
      delete process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'];
    } else {
      process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] = previousAutostart;
    }
    rmSync(repoRoot, { recursive: true, force: true });
    for (const dir of extraTempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('activates a chained child on chainSourceBranch without creating task/<childTaskId>', async () => {
    const baseSha = initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);
    const taskId = 'child-task';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Child Task', {
      branchChain: branchChain(repoRoot),
    }));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    const result = await activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot });

    expect(result).toEqual({ activated: true, activatedTaskId: taskId });
    const sidecar = readSidecar(repoRoot, taskId);
    const binding = sidecar.contextPackBinding.repoBindings[0]!;
    expect(sidecar.taskId).toBe(taskId);
    expect(binding.worktreeBranch).toBe('task/root-task');
    expect(binding.baseCommitSha).toBe(baseSha);
    expect(binding.worktreeRoot).toContain(path.join('AgentWorkSpace', 'tasks', taskId, 'worktrees'));
    expect(binding.branchOwnership).toBe('chain-owned');
    expect(binding.branchChainRootTaskId).toBe('root-task');
    expect(binding.branchChainTaskId).toBe(taskId);
    expect(git(repoRoot, ['branch', '--list', `task/${taskId}`])).toBe('');
    expect(git(binding.worktreeRoot, ['branch', '--show-current'])).toBe('task/root-task');
  });

  it('uses chainSourceBranch instead of targetBranch', async () => {
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);
    const taskId = 'child-target-ignored';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Child Task', {
      branchChain: branchChain(repoRoot, { targetBranch: 'main' }),
    }));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: true, activatedTaskId: taskId });

    const binding = readSidecar(repoRoot, taskId).contextPackBinding.repoBindings[0]!;
    expect(binding.worktreeBranch).toBe('task/root-task');
    expect(git(binding.worktreeRoot, ['branch', '--show-current'])).toBe('task/root-task');
  });

  it('activates a grandchild on the same chainSourceBranch without creating task/<grandchildTaskId>', async () => {
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);
    const taskId = 'grandchild-task';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Grandchild Task', {
      parentTaskId: 'child-task',
      rootTaskId: 'root-task',
      branchChain: branchChain(repoRoot, { parentTaskId: 'child-task' }),
    }));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: true, activatedTaskId: taskId });

    const binding = readSidecar(repoRoot, taskId).contextPackBinding.repoBindings[0]!;
    expect(binding.worktreeBranch).toBe('task/root-task');
    expect(git(repoRoot, ['branch', '--list', `task/${taskId}`])).toBe('');
  });

  it('keeps legacy child tasks without Branch Chain compatible with task/<childTaskId>', async () => {
    initGitRepo(repoRoot);
    const taskId = 'legacy-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Legacy Child'));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: true, activatedTaskId: taskId });

    const binding = readSidecar(repoRoot, taskId).contextPackBinding.repoBindings[0]!;
    expect(binding.worktreeBranch).toBe(`task/${taskId}`);
    expect(git(repoRoot, ['branch', '--list', `task/${taskId}`])).toContain(`task/${taskId}`);
  });

  it('fails closed before materialization for malformed Branch Chain', async () => {
    initGitRepo(repoRoot);
    const taskId = 'malformed-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Malformed Child', {
      branchChain: '## Branch Chain\n\n```json\n{bad\n```',
    }));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .rejects.toThrow('activation-branch-chain-invalid for task "malformed-child": malformed-json');

    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId))).toBe(false);
    expect(existsSync(path.join(resolveQueuePaths(repoRoot).activeItemsDir, taskId))).toBe(false);
    expect(existsSync(path.join(resolveQueuePaths(repoRoot).pendingDir, `${taskId}.md`))).toBe(true);
    expect(git(repoRoot, ['branch', '--list', `task/${taskId}`])).toBe('');
  });

  it('moves missing chain branch activation failures to failed items', async () => {
    initGitRepo(repoRoot);
    const taskId = 'missing-branch';
    const chain = branchChain(repoRoot, { parentTaskId: 'root-task' });
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Missing Branch', {
      parentTaskId: 'root-task',
      rootTaskId: 'root-task',
      branchChain: chain,
    }));
    const now = '2026-05-27T12:00:00.000Z';
    const snapshot = childTaskSnapshot();
    await writeChildTaskChains(repoRoot, {
      schemaVersion: 1,
      updatedAt: now,
      chains: {
        'root-task': {
          rootTaskId: 'root-task',
          currentTipTaskId: taskId,
          contextPackId: null,
          contextPackDir: null,
          taskIds: ['root-task', taskId],
          createdAt: now,
          updatedAt: now,
        },
      },
      tasks: {
        'root-task': {
          taskId: 'root-task',
          rootTaskId: 'root-task',
          parentTaskId: null,
          previousTaskId: null,
          depth: 0,
          state: 'completed',
          archivePath: 'archive/root.md',
          archiveArtifactDir: 'archive/root',
          parentArchivePath: null,
          parentArchiveArtifactDir: null,
          parentContextSnapshot: snapshot,
          childExecutionScope: snapshot,
          branchChain: null,
          completedBranchHandoffs: null,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        [taskId]: {
          taskId,
          rootTaskId: 'root-task',
          parentTaskId: 'root-task',
          previousTaskId: 'root-task',
          depth: 1,
          state: 'planned',
          archivePath: null,
          archiveArtifactDir: null,
          parentArchivePath: 'archive/root.md',
          parentArchiveArtifactDir: 'archive/root',
          parentContextSnapshot: snapshot,
          childExecutionScope: snapshot,
          branchChain: chain,
          completedBranchHandoffs: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: false, reason: 'activation-branch-chain-base-unresolved' });

    const paths = resolveQueuePaths(repoRoot);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId))).toBe(false);
    expect(existsSync(path.join(paths.activeItemsDir, taskId))).toBe(false);
    expect(existsSync(path.join(paths.pendingDir, `${taskId}.md`))).toBe(false);
    expect(existsSync(path.join(paths.errorItemsDir, `${taskId}.md`))).toBe(true);
    expect(git(repoRoot, ['branch', '--list', `task/${taskId}`])).toBe('');
    const registry = await loadTaskRegistry(repoRoot);
    expect(registry.tasks._unbound?.pending).toEqual([]);
    expect(registry.tasks._unbound?.failed.map((entry) => entry.taskId)).toContain(taskId);
    const childChainState = await readChildTaskChains(repoRoot);
    expect(childChainState.tasks[taskId]?.state).toBe('failed');
  });

  it('fails closed for lineage mismatch, missing Branch Chain repo, and checked-out chain branch', async () => {
    initGitRepo(repoRoot);
    const cases: Array<{ taskId: string; chain: TaskBranchChainBinding; error: string; setup?: () => void }> = [
      {
        taskId: 'lineage-mismatch',
        chain: branchChain(repoRoot, { rootTaskId: 'other-root' }),
        error: 'activation-branch-chain-mismatch for task "lineage-mismatch":',
      },
      {
        taskId: 'missing-repo',
        chain: branchChain(path.join(repoRoot, 'missing-repo')),
        error: 'activation-branch-chain-repo-missing for task "missing-repo":',
      },
      {
        taskId: 'checked-out-branch',
        chain: branchChain(repoRoot),
        error: 'activation-branch-chain-precondition-failed for task "checked-out-branch": worktree-already-bound',
        setup: () => {
          git(repoRoot, ['branch', 'task/root-task']);
          const worktreeParent = mkdtempSync(path.join(tmpdir(), 'checked-out-chain-'));
          extraTempDirs.push(worktreeParent);
          git(repoRoot, ['worktree', 'add', path.join(worktreeParent, 'repo'), 'task/root-task']);
        },
      },
    ];

    for (const testCase of cases) {
      testCase.setup?.();
      await seedPending(repoRoot, testCase.taskId, pendingMarkdown(testCase.taskId, testCase.taskId, {
        rootTaskId: 'root-task',
        branchChain: testCase.chain,
      }));
      const { activateNextPendingItemIfReady } = await import('../operations.js');
      await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
        .rejects.toThrow(testCase.error);
      expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', testCase.taskId, '.task.json'))).toBe(false);
      expect(existsSync(path.join(resolveQueuePaths(repoRoot).activeItemsDir, testCase.taskId))).toBe(false);
      expect(existsSync(path.join(resolveQueuePaths(repoRoot).pendingDir, `${testCase.taskId}.md`))).toBe(true);
      expect(git(repoRoot, ['branch', '--list', `task/${testCase.taskId}`])).toBe('');
      rmSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems'), { recursive: true, force: true });
      rmSync(path.join(repoRoot, '.platform-state', 'tasks.json'), { force: true });
    }
  });

  it('matches a monolith subtree scope by git root and records a child-specific worktree path', async () => {
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);
    const focusPath = path.join(repoRoot, 'src', 'backend');
    mkdirSync(focusPath, { recursive: true });
    const contextPackDir = path.join(repoRoot, 'contextpacks', 'mono');
    mkdirSync(path.join(contextPackDir, 'qmd'), { recursive: true });
    writeFileSync(path.join(contextPackDir, 'qmd', 'repo-sources.json'), JSON.stringify({
      manifest_version: 'qmd-repo-sources/v2',
      manifest_status: 'approved',
      context_pack_id: 'mono',
      estate_type: 'monolith',
      qmd_scope_root: 'qmd/context-packs/mono',
      repositories: [{ repo_id: 'src', local_paths: [{ host: focusPath, git_root: repoRoot }] }],
      focusable_areas: [{ focus_id: 'backend', relative_path: 'src/backend', focus_type: 'backend' }],
      primary_working_repo_ids: [],
      primary_focus_area_ids: ['backend'],
    }, null, 2), 'utf-8');
    const taskId = 'monolith-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Monolith Child', {
      contextPackBinding: formatContextPackBindingSection({
        contextPackDir,
        contextPackId: 'mono',
        scopeMode: 'regular',
        selectedRepoIds: [],
        selectedFocusIds: ['backend'],
        deepFocusEnabled: true,
        deepFocusPrimaryFocusId: 'backend',
        selectedFocusTargets: [{
          path: '',
          kind: 'directory',
          repoLocalPath: focusPath,
          focusId: 'backend',
          role: 'anchor',
        }],
      }).replace('- Deep Focus Enabled: true', '- Selected Focus IDs: backend\n- Deep Focus Enabled: true'),
      branchChain: branchChain(focusPath),
    }));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: true, activatedTaskId: taskId });

    const binding = readSidecar(repoRoot, taskId).contextPackBinding.repoBindings[0]!;
    expect(binding.worktreeBranch).toBe('task/root-task');
    expect(binding.worktreeRoot).toContain(path.join('AgentWorkSpace', 'tasks', taskId, 'worktrees'));
  });

  it('activates distributed repos by normalized repoRoot with separate chain branches and child worktree paths', async () => {
    initGitRepo(repoRoot);
    const repoA = mkdtempSync(path.join(tmpdir(), 'chain-repo-a-'));
    const repoB = mkdtempSync(path.join(tmpdir(), 'chain-repo-b-'));
    extraTempDirs.push(repoA, repoB);
    const shaA = initGitRepo(repoA);
    const shaB = initGitRepo(repoB);
    git(repoA, ['branch', 'task/root-a']);
    git(repoB, ['branch', 'task/root-b']);
    const contextPackDir = path.join(repoRoot, 'contextpacks', 'distributed');
    mkdirSync(path.join(contextPackDir, 'qmd'), { recursive: true });
    writeFileSync(path.join(contextPackDir, 'qmd', 'repo-sources.json'), JSON.stringify({
      manifest_version: 'qmd-repo-sources/v1',
      manifest_status: 'approved',
      context_pack_id: 'distributed',
      estate_type: 'distributed-platform',
      qmd_scope_root: 'qmd/context-packs/distributed',
      repositories: [
        { repo_id: 'api', local_paths: [repoA], repository_type: 'primary', default_focusable: true, activation_priority: 100 },
        { repo_id: 'web', local_paths: [repoB], repository_type: 'primary', default_focusable: true, activation_priority: 90 },
      ],
      primary_working_repo_ids: ['api', 'web'],
      primary_focus_area_ids: [],
    }, null, 2), 'utf-8');
    const taskId = 'distributed-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Distributed Child', {
      contextPackBinding: formatContextPackBindingSection({
        contextPackDir,
        contextPackId: 'distributed',
        scopeMode: 'regular',
        selectedRepoIds: ['api', 'web'],
        selectedFocusIds: [],
        repositoryTypes: { api: 'primary', web: 'primary' },
        primaryRepoId: 'api',
      }),
      branchChain: {
        schemaVersion: 1,
        mode: 'continuation',
        rootTaskId: 'root-task',
        parentTaskId: 'parent-task',
        depth: 1,
        repos: [
          { ...branchChain(repoA).repos[0]!, repoRoot: `${repoA}/.`, repoLabel: 'not-used', chainSourceBranch: 'task/root-a' },
          { ...branchChain(repoB).repos[0]!, repoRoot: repoB, repoLabel: 'not-used', chainSourceBranch: 'task/root-b' },
        ],
      },
    }));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: true, activatedTaskId: taskId });

    const bindings = readSidecar(repoRoot, taskId).contextPackBinding.repoBindings;
    expect(bindings).toHaveLength(2);
    expect(bindings.map((binding) => binding.worktreeBranch).sort()).toEqual(['task/root-a', 'task/root-b']);
    expect(bindings.find((binding) => binding.worktreeBranch === 'task/root-a')?.baseCommitSha).toBe(shaA);
    expect(bindings.find((binding) => binding.worktreeBranch === 'task/root-b')?.baseCommitSha).toBe(shaB);
    expect(bindings.every((binding) => binding.worktreeRoot.includes(path.join('AgentWorkSpace', 'tasks', taskId, 'worktrees')))).toBe(true);
    expect(git(repoA, ['branch', '--list', `task/${taskId}`])).toBe('');
    expect(git(repoB, ['branch', '--list', `task/${taskId}`])).toBe('');
  });

  it('activates existing immediate-parent and historical chain repos as chain-owned', async () => {
    initGitRepo(repoRoot);
    const platformRepo = mkdtempSync(path.join(tmpdir(), 'chain-existing-platform-'));
    const toolsRepo = mkdtempSync(path.join(tmpdir(), 'chain-history-tools-'));
    extraTempDirs.push(platformRepo, toolsRepo);
    initGitRepo(platformRepo);
    initGitRepo(toolsRepo);
    git(platformRepo, ['branch', 'task/root-platform']);
    git(toolsRepo, ['branch', 'task/ancestor-tools']);
    const contextPackDir = path.join(repoRoot, 'contextpacks', 'existing-history');
    writeDistributedContextPack(contextPackDir, [
      { id: 'platform', root: platformRepo },
      { id: 'tools', root: toolsRepo },
    ]);
    const taskId = 'existing-history-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Existing History Child', {
      contextPackBinding: distributedContextBinding(contextPackDir, ['platform', 'tools']),
      branchChain: chainForRepos([
        { ...branchChain(platformRepo).repos[0]!, repoRoot: platformRepo, repoLabel: 'platform', chainSourceBranch: 'task/root-platform' },
        {
          ...branchChain(toolsRepo).repos[0]!,
          repoRoot: toolsRepo,
          repoLabel: 'tools',
          chainSourceBranch: 'task/ancestor-tools',
          parentSourceBranch: 'task/ancestor-tools',
          sourceKind: 'chain-history-handoff',
        },
      ]),
    }));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: true, activatedTaskId: taskId });

    const bindings = readSidecar(repoRoot, taskId).contextPackBinding.repoBindings;
    expect(bindings).toHaveLength(2);
    expect(bindings.map((binding) => binding.worktreeBranch).sort()).toEqual(['task/ancestor-tools', 'task/root-platform']);
    expect(bindings.every((binding) => binding.branchOwnership === 'chain-owned')).toBe(true);
    expect(bindings.every((binding) => binding.branchChainRootTaskId === 'root-task')).toBe(true);
    expect(bindings.every((binding) => binding.branchChainTaskId === taskId)).toBe(true);
    expect(git(platformRepo, ['branch', '--list', `task/${taskId}`])).toBe('');
    expect(git(toolsRepo, ['branch', '--list', `task/${taskId}`])).toBe('');
  });

  it('activates existing chain repos as chain-owned and introduced repos as task-owned', async () => {
    initGitRepo(repoRoot);
    const platformRepo = mkdtempSync(path.join(tmpdir(), 'chain-existing-platform-'));
    const toolsRepo = mkdtempSync(path.join(tmpdir(), 'chain-introduced-tools-'));
    extraTempDirs.push(platformRepo, toolsRepo);
    initGitRepo(platformRepo);
    const toolsHead = initGitRepo(toolsRepo);
    git(platformRepo, ['branch', 'task/root-platform']);
    const contextPackDir = path.join(repoRoot, 'contextpacks', 'existing-introduced');
    writeDistributedContextPack(contextPackDir, [
      { id: 'platform', root: platformRepo },
      { id: 'tools', root: toolsRepo },
    ]);
    const taskId = 'existing-introduced-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Existing Introduced Child', {
      contextPackBinding: distributedContextBinding(contextPackDir, ['platform', 'tools']),
      branchChain: chainForRepos([
        { ...branchChain(platformRepo).repos[0]!, repoRoot: platformRepo, repoLabel: 'platform', chainSourceBranch: 'task/root-platform' },
        {
          ...branchChain(toolsRepo).repos[0]!,
          repoRoot: toolsRepo,
          repoLabel: 'tools',
          chainSourceBranch: 'task/root-task',
          parentBranchHead: toolsHead,
          targetBranch: null,
          sourceKind: 'introduced-by-child',
        },
      ]),
    }));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: true, activatedTaskId: taskId });

    const bindings = readSidecar(repoRoot, taskId).contextPackBinding.repoBindings;
    const existing = bindings.find((binding) => binding.worktreeBranch === 'task/root-platform')!;
    const introduced = bindings.find((binding) => binding.worktreeBranch === 'task/root-task')!;
    expect(existing.branchOwnership).toBe('chain-owned');
    expect(existing.branchChainRootTaskId).toBe('root-task');
    expect(introduced.branchOwnership).toBe('task-owned');
    expect(introduced.branchChainRootTaskId).toBeUndefined();
    expect(introduced.branchChainTaskId).toBeUndefined();
    expect(introduced.baseCommitSha).toBe(toolsHead);
    expect(git(toolsRepo, ['branch', '--list', 'task/root-task'])).toContain('task/root-task');
  });

  it('activates a fully divergent historical repo without materializing the omitted immediate-parent repo', async () => {
    initGitRepo(repoRoot);
    const platformRepo = mkdtempSync(path.join(tmpdir(), 'chain-omitted-platform-'));
    const toolsRepo = mkdtempSync(path.join(tmpdir(), 'chain-only-history-tools-'));
    extraTempDirs.push(platformRepo, toolsRepo);
    initGitRepo(platformRepo);
    initGitRepo(toolsRepo);
    git(platformRepo, ['branch', 'task/root-platform']);
    git(toolsRepo, ['branch', 'task/ancestor-tools']);
    const contextPackDir = path.join(repoRoot, 'contextpacks', 'history-only');
    writeDistributedContextPack(contextPackDir, [
      { id: 'platform', root: platformRepo },
      { id: 'tools', root: toolsRepo },
    ]);
    const taskId = 'history-only-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'History Only Child', {
      contextPackBinding: distributedContextBinding(contextPackDir, ['tools']),
      branchChain: chainForRepos([{
        ...branchChain(toolsRepo).repos[0]!,
        repoRoot: toolsRepo,
        repoLabel: 'tools',
        chainSourceBranch: 'task/ancestor-tools',
        parentSourceBranch: 'task/ancestor-tools',
        sourceKind: 'chain-history-handoff',
      }]),
    }));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: true, activatedTaskId: taskId });

    const bindings = readSidecar(repoRoot, taskId).contextPackBinding.repoBindings;
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual(expect.objectContaining({
      worktreeBranch: 'task/ancestor-tools',
      branchOwnership: 'chain-owned',
      branchChainRootTaskId: 'root-task',
    }));
    expect(git(platformRepo, ['worktree', 'list', '--porcelain'])).not.toContain(taskId);
  });

  it('activates a fully divergent introduced repo as task-owned', async () => {
    initGitRepo(repoRoot);
    const platformRepo = mkdtempSync(path.join(tmpdir(), 'chain-omitted-platform-'));
    const toolsRepo = mkdtempSync(path.join(tmpdir(), 'chain-only-introduced-tools-'));
    extraTempDirs.push(platformRepo, toolsRepo);
    initGitRepo(platformRepo);
    const toolsHead = initGitRepo(toolsRepo);
    git(platformRepo, ['branch', 'task/root-platform']);
    const contextPackDir = path.join(repoRoot, 'contextpacks', 'introduced-only');
    writeDistributedContextPack(contextPackDir, [
      { id: 'platform', root: platformRepo },
      { id: 'tools', root: toolsRepo },
    ]);
    const taskId = 'introduced-only-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Introduced Only Child', {
      contextPackBinding: distributedContextBinding(contextPackDir, ['tools']),
      branchChain: chainForRepos([{
        ...branchChain(toolsRepo).repos[0]!,
        repoRoot: toolsRepo,
        repoLabel: 'tools',
        chainSourceBranch: 'task/root-task',
        parentBranchHead: toolsHead,
        targetBranch: null,
        sourceKind: 'introduced-by-child',
      }]),
    }));

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .resolves.toEqual({ activated: true, activatedTaskId: taskId });

    const bindings = readSidecar(repoRoot, taskId).contextPackBinding.repoBindings;
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual(expect.objectContaining({
      worktreeBranch: 'task/root-task',
      branchOwnership: 'task-owned',
      baseCommitSha: toolsHead,
    }));
    expect(bindings[0]?.branchChainRootTaskId).toBeUndefined();
    expect(git(toolsRepo, ['branch', '--list', 'task/root-task'])).toContain('task/root-task');
    expect(git(platformRepo, ['worktree', 'list', '--porcelain'])).not.toContain(taskId);
  });

  it('rolls back accumulated multi-repo chained worktrees when a later materialization fails', async () => {
    initGitRepo(repoRoot);
    const repoA = mkdtempSync(path.join(tmpdir(), 'chain-fail-repo-a-'));
    const repoB = mkdtempSync(path.join(tmpdir(), 'chain-fail-repo-b-'));
    extraTempDirs.push(repoA, repoB);
    initGitRepo(repoA);
    initGitRepo(repoB);
    git(repoA, ['branch', 'task/root-a']);
    git(repoB, ['branch', 'task/root-b']);
    const contextPackDir = path.join(repoRoot, 'contextpacks', 'distributed-fail');
    mkdirSync(path.join(contextPackDir, 'qmd'), { recursive: true });
    writeFileSync(path.join(contextPackDir, 'qmd', 'repo-sources.json'), JSON.stringify({
      manifest_version: 'qmd-repo-sources/v1',
      manifest_status: 'approved',
      context_pack_id: 'distributed-fail',
      estate_type: 'distributed-platform',
      qmd_scope_root: 'qmd/context-packs/distributed-fail',
      repositories: [
        { repo_id: 'api', local_paths: [repoA], repository_type: 'primary', default_focusable: true, activation_priority: 100 },
        { repo_id: 'web', local_paths: [repoB], repository_type: 'primary', default_focusable: true, activation_priority: 90 },
      ],
      primary_working_repo_ids: ['api', 'web'],
      primary_focus_area_ids: [],
    }, null, 2), 'utf-8');
    const taskId = 'distributed-fail-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Distributed Fail Child', {
      contextPackBinding: formatContextPackBindingSection({
        contextPackDir,
        contextPackId: 'distributed-fail',
        scopeMode: 'regular',
        selectedRepoIds: ['api', 'web'],
        selectedFocusIds: [],
        repositoryTypes: { api: 'primary', web: 'primary' },
        primaryRepoId: 'api',
      }),
      branchChain: {
        schemaVersion: 1,
        mode: 'continuation',
        rootTaskId: 'root-task',
        parentTaskId: 'parent-task',
        depth: 1,
        repos: [
          { ...branchChain(repoA).repos[0]!, repoRoot: repoA, repoLabel: 'api', chainSourceBranch: 'task/root-a' },
          { ...branchChain(repoB).repos[0]!, repoRoot: repoB, repoLabel: 'web', chainSourceBranch: 'task/root-b' },
        ],
      },
    }));
    let materializeCalls = 0;
    vi.doMock('../../core/worktreeMaterialization.js', async () => {
      const actual = await vi.importActual<typeof import('../../core/worktreeMaterialization.js')>(
        '../../core/worktreeMaterialization.js',
      );
      return {
        ...actual,
        materializeWorktreeDeps: vi.fn(async () => {
          materializeCalls += 1;
          if (materializeCalls === 2) {
            throw new Error('second clone failed');
          }
          return { strategy: 'copy', cloned: [], skipped: [] };
        }),
      };
    });

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .rejects.toThrow('second clone failed');

    expect(git(repoA, ['branch', '--list', 'task/root-a'])).toContain('task/root-a');
    expect(git(repoB, ['branch', '--list', 'task/root-b'])).toContain('task/root-b');
    expect(git(repoA, ['branch', '--list', `task/${taskId}`])).toBe('');
    expect(git(repoB, ['branch', '--list', `task/${taskId}`])).toBe('');
    expect(git(repoA, ['worktree', 'list', '--porcelain'])).not.toContain(taskId);
    expect(git(repoB, ['worktree', 'list', '--porcelain'])).not.toContain(taskId);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json'))).toBe(false);
    expect(existsSync(path.join(resolveQueuePaths(repoRoot).activeItemsDir, taskId))).toBe(false);
    expect(existsSync(path.join(resolveQueuePaths(repoRoot).pendingDir, `${taskId}.md`))).toBe(true);
  });

  it('rolls back introduced branches while preserving existing chain branches', async () => {
    initGitRepo(repoRoot);
    const platformRepo = mkdtempSync(path.join(tmpdir(), 'rollback-existing-platform-'));
    const toolsRepo = mkdtempSync(path.join(tmpdir(), 'rollback-introduced-tools-'));
    extraTempDirs.push(platformRepo, toolsRepo);
    initGitRepo(platformRepo);
    const toolsHead = initGitRepo(toolsRepo);
    git(platformRepo, ['branch', 'task/root-platform']);
    const contextPackDir = path.join(repoRoot, 'contextpacks', 'rollback-introduced');
    writeDistributedContextPack(contextPackDir, [
      { id: 'platform', root: platformRepo },
      { id: 'tools', root: toolsRepo },
    ]);
    const taskId = 'rollback-introduced-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Rollback Introduced Child', {
      contextPackBinding: distributedContextBinding(contextPackDir, ['platform', 'tools']),
      branchChain: chainForRepos([
        { ...branchChain(platformRepo).repos[0]!, repoRoot: platformRepo, repoLabel: 'platform', chainSourceBranch: 'task/root-platform' },
        {
          ...branchChain(toolsRepo).repos[0]!,
          repoRoot: toolsRepo,
          repoLabel: 'tools',
          chainSourceBranch: 'task/root-task',
          parentBranchHead: toolsHead,
          targetBranch: null,
          sourceKind: 'introduced-by-child',
        },
      ]),
    }));
    let materializeCalls = 0;
    vi.doMock('../../core/worktreeMaterialization.js', async () => {
      const actual = await vi.importActual<typeof import('../../core/worktreeMaterialization.js')>(
        '../../core/worktreeMaterialization.js',
      );
      return {
        ...actual,
        materializeWorktreeDeps: vi.fn(async () => {
          materializeCalls += 1;
          if (materializeCalls === 2) {
            throw new Error('introduced clone failed');
          }
          return { strategy: 'copy', cloned: [], skipped: [] };
        }),
      };
    });

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .rejects.toThrow('introduced clone failed');

    expect(git(platformRepo, ['branch', '--list', 'task/root-platform'])).toContain('task/root-platform');
    expect(git(toolsRepo, ['branch', '--list', 'task/root-task'])).toBe('');
    expect(git(platformRepo, ['worktree', 'list', '--porcelain'])).not.toContain(taskId);
    expect(git(toolsRepo, ['worktree', 'list', '--porcelain'])).not.toContain(taskId);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json'))).toBe(false);
    expect(existsSync(path.join(resolveQueuePaths(repoRoot).activeItemsDir, taskId))).toBe(false);
    expect(existsSync(path.join(resolveQueuePaths(repoRoot).pendingDir, `${taskId}.md`))).toBe(true);
  });

  it('rolls back a chained materialization failure without deleting chainSourceBranch', async () => {
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);
    const taskId = 'rollback-child';
    await seedPending(repoRoot, taskId, pendingMarkdown(taskId, 'Rollback Child', {
      branchChain: branchChain(repoRoot),
    }));
    vi.doMock('../../core/worktreeMaterialization.js', async () => {
      const actual = await vi.importActual<typeof import('../../core/worktreeMaterialization.js')>(
        '../../core/worktreeMaterialization.js',
      );
      return {
        ...actual,
        materializeWorktreeDeps: vi.fn(async () => {
          throw new Error('clone failed');
        }),
      };
    });

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths: resolveQueuePaths(repoRoot), repoRoot }))
      .rejects.toThrow('clone failed');

    expect(git(repoRoot, ['branch', '--list', 'task/root-task'])).toContain('task/root-task');
    expect(git(repoRoot, ['branch', '--list', `task/${taskId}`])).toBe('');
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json'))).toBe(false);
    expect(existsSync(path.join(resolveQueuePaths(repoRoot).activeItemsDir, taskId))).toBe(false);
    expect(existsSync(path.join(resolveQueuePaths(repoRoot).pendingDir, `${taskId}.md`))).toBe(true);
    expect(git(repoRoot, ['worktree', 'list', '--porcelain'])).not.toContain(path.join('tasks', taskId, 'worktrees'));
  });
});
