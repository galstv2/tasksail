import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const {
  activateNextPendingItemIfReadyMock,
  prepareChildTaskChainCloseoutMock,
  attachCompletedBranchHandoffsMock,
  advanceCompletedChildTaskChainMock,
  parseRecoveredChildTaskChainCloseoutMock,
  transitionTaskMock,
} = vi.hoisted(() => ({
  activateNextPendingItemIfReadyMock: vi.fn().mockResolvedValue({ activated: false }),
  prepareChildTaskChainCloseoutMock: vi.fn(),
  attachCompletedBranchHandoffsMock: vi.fn(),
  advanceCompletedChildTaskChainMock: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
  parseRecoveredChildTaskChainCloseoutMock: vi.fn((value) => ({ ...value, source: 'recovered' })),
  transitionTaskMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../archive.js', () => ({
  fileTaskArchive: vi.fn().mockResolvedValue({
    passed: true,
    stdout: '{}',
    stderr: '',
    exitCode: 0,
    data: { record_md_path: '/archive/tasks/2026/child/archive.md' },
  }),
}));

vi.mock('../policyValidation.js', () => ({ assertPolicyPasses: vi.fn() }));
vi.mock('../errorItems.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../errorItems.js')>()),
  commitTaskSnapshot: vi.fn().mockResolvedValue(true),
}));
vi.mock('../branchVerification.js', () => ({
  verifyTaskBranches: vi.fn().mockResolvedValue({ ok: true, failures: [] }),
}));
vi.mock('../../core/worktreeFinalize.js', () => ({
  finalizeTaskWorktrees: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: vi.fn().mockResolvedValue({
    schema_version: 1,
    cli_provider: 'copilot',
    container_runtime: 'direct',
    container_engine_host: 'auto',
    container_engine_wsl_distro: null,
    max_parallel_tasks: 10,
    retain_failed_task_worktrees: true,
    max_retained_failed_task_worktrees: 10,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: 3600000,
    auto_merge: false,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  }),
}));
vi.mock('../../agent-runner/pipeline/remediation.js', () => ({
  buildAdvisoryFindingSection: vi.fn().mockResolvedValue(null),
  ADVISORY_FINDING_HEADING: '## QA Advisory Finding',
}));
vi.mock('../taskRegistry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../taskRegistry.js')>()),
  transitionTask: transitionTaskMock,
}));
vi.mock('../operations.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../operations.js')>()),
  activateNextPendingItemIfReady: activateNextPendingItemIfReadyMock,
}));
vi.mock('../childTaskChainCloseout.js', () => ({
  prepareChildTaskChainCloseout: prepareChildTaskChainCloseoutMock,
  attachCompletedBranchHandoffs: attachCompletedBranchHandoffsMock,
  advanceCompletedChildTaskChain: advanceCompletedChildTaskChainMock,
  parseRecoveredChildTaskChainCloseout: parseRecoveredChildTaskChainCloseoutMock,
  resolveArchiveArtifactDir: vi.fn((archivePath: string | null) => (
    archivePath && path.basename(archivePath) === 'archive.md' ? path.dirname(archivePath) : null
  )),
}));

import { completePendingItem } from '../completePendingItem.js';

describe('completePendingItem child-chain closeout wiring', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'complete-child-chain-'));
    vi.clearAllMocks();
    activateNextPendingItemIfReadyMock.mockResolvedValue({ activated: false });
    transitionTaskMock.mockResolvedValue(undefined);
    advanceCompletedChildTaskChainMock.mockResolvedValue({ schemaVersion: 1 });
    const prepared = preparedCloseout();
    prepareChildTaskChainCloseoutMock.mockResolvedValue(prepared);
    attachCompletedBranchHandoffsMock.mockReturnValue({
      ...prepared,
      completedBranchHandoffs: [{ chainSourceBranch: 'task/root', headCommitSha: 'head' }],
    });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('advances child-chain state after archive, finalize, and registry transition', async () => {
    const taskId = 'child';
    await seedActiveTask(repoRoot, taskId, childMarkdown());

    await completePendingItem({ repoRoot, taskId, skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') });

    expect(advanceCompletedChildTaskChainMock).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({
        taskId,
        archivePath: '/archive/tasks/2026/child/archive.md',
        archiveArtifactDir: '/archive/tasks/2026/child',
        completedBranchHandoffs: [expect.objectContaining({ chainSourceBranch: 'task/root' })],
      }),
    );
    expect(activateNextPendingItemIfReadyMock).toHaveBeenCalledOnce();
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace/pendingitems/.active-items/child.completing'))).toBe(false);
  });

  it('attaches branch handoffs from adjusted child repo bindings before advancing the chain tip', async () => {
    const taskId = 'child';
    const platformRepo = await createRepo(repoRoot, 'platform', 'task/root');
    const toolsRepo = await createRepo(repoRoot, 'tools', 'task/root');
    await seedActiveTask(repoRoot, taskId, childMarkdown());
    await seedTaskJson(repoRoot, taskId, [{
      originalRoot: platformRepo.root,
      worktreeRoot: path.join(repoRoot, 'AgentWorkSpace/tasks/child/worktrees/platform'),
      worktreeBranch: 'task/root',
      baseCommitSha: platformRepo.baseCommitSha,
    }, {
      originalRoot: toolsRepo.root,
      worktreeRoot: path.join(repoRoot, 'AgentWorkSpace/tasks/child/worktrees/tools'),
      worktreeBranch: 'task/root',
      baseCommitSha: toolsRepo.baseCommitSha,
    }]);

    await completePendingItem({ repoRoot, taskId, skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') });

    expect(attachCompletedBranchHandoffsMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId }),
      expect.arrayContaining([
        expect.objectContaining({ repo_root: platformRepo.root, repo_label: 'platform', branch: 'task/root' }),
        expect.objectContaining({ repo_root: toolsRepo.root, repo_label: 'tools', branch: 'task/root' }),
      ]),
    );
    expect(advanceCompletedChildTaskChainMock).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({ taskId }),
    );
  });

  it('does not backfill target_branch for child-chain branch handoffs even when the target repo has a branch', async () => {
    const taskId = 'child';
    // Both target repos are checked out on main. A standard (non-child-chain)
    // closeout would backfill auto_merge.target_branch to "main" via the best-effort
    // resolver. Child-chain closeout must keep its pre-feature null targetBranch.
    const platformRepo = await createRepo(repoRoot, 'platform', 'task/root');
    const toolsRepo = await createRepo(repoRoot, 'tools', 'task/root');
    await seedActiveTask(repoRoot, taskId, childMarkdown());
    await seedTaskJson(repoRoot, taskId, [{
      originalRoot: platformRepo.root,
      worktreeRoot: path.join(repoRoot, 'AgentWorkSpace/tasks/child/worktrees/platform'),
      worktreeBranch: 'task/root',
      baseCommitSha: platformRepo.baseCommitSha,
    }, {
      originalRoot: toolsRepo.root,
      worktreeRoot: path.join(repoRoot, 'AgentWorkSpace/tasks/child/worktrees/tools'),
      worktreeBranch: 'task/root',
      baseCommitSha: toolsRepo.baseCommitSha,
    }]);

    await completePendingItem({ repoRoot, taskId, skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') });

    expect(attachCompletedBranchHandoffsMock).toHaveBeenCalledTimes(1);
    const branchHandoffsArg = attachCompletedBranchHandoffsMock.mock.calls[0][1] as Array<{
      repo_root: string;
      auto_merge: { target_branch: string | null };
    }>;
    expect(branchHandoffsArg).toHaveLength(2);
    for (const handoff of branchHandoffsArg) {
      expect(handoff.auto_merge.target_branch).toBeNull();
    }
  });

  it('leaves the sentinel and blocks queue activation when child-chain state advance fails', async () => {
    const taskId = 'child';
    await seedActiveTask(repoRoot, taskId, childMarkdown());
    advanceCompletedChildTaskChainMock.mockRejectedValueOnce(new Error('write failed'));

    await expect(completePendingItem({ repoRoot, taskId, skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') }))
      .rejects.toThrow('child-task-chain-closeout-advance-failed for task "child": write failed');

    const sentinelPath = path.join(repoRoot, 'AgentWorkSpace/pendingitems/.active-items/child.completing');
    expect(existsSync(sentinelPath)).toBe(true);
    expect(JSON.parse(readFileSync(sentinelPath, 'utf-8')).childChainCloseout.taskId).toBe(taskId);
    expect(activateNextPendingItemIfReadyMock).not.toHaveBeenCalled();
  });

  it('blocks child-chain advancement and queue activation when chained registry transition throws', async () => {
    const taskId = 'child';
    await seedActiveTask(repoRoot, taskId, childMarkdown());
    transitionTaskMock.mockRejectedValueOnce(new Error('registry failed'));

    await expect(completePendingItem({ repoRoot, taskId, skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') }))
      .rejects.toThrow('child-task-chain-closeout-registry-transition-failed for task "child": registry failed');

    expect(advanceCompletedChildTaskChainMock).not.toHaveBeenCalled();
    expect(activateNextPendingItemIfReadyMock).not.toHaveBeenCalled();
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace/pendingitems/.active-items/child.completing'))).toBe(true);
  });

  it('recovers child-chain closeout from sentinel without preparing or reattaching branch handoffs', async () => {
    const taskId = 'child';
    await seedActiveTask(repoRoot, taskId, childMarkdown());
    const activeDir = path.join(repoRoot, 'AgentWorkSpace/pendingitems/.active-items');
    const recovered = {
      ...preparedCloseout(),
      branchChain: {
        ...preparedCloseout().branchChain,
        repos: [{
          repoRoot: path.join(repoRoot, 'missing-original-repo'),
          repoLabel: 'platform',
          chainSourceBranch: 'task/root',
          parentSourceBranch: 'task/parent',
          parentBranchHead: 'parent-head',
          targetBranch: 'main',
        }],
      },
      completedBranchHandoffs: [{ chainSourceBranch: 'task/root', headCommitSha: 'head' }],
      archivePath: '/archive/tasks/2026/child/archive.md',
      archiveArtifactDir: '/archive/tasks/2026/child',
    };
    await writeFile(path.join(activeDir, `${taskId}.completing`), JSON.stringify({
      ts: Date.now(),
      archiveSucceeded: true,
      childChainCloseout: recovered,
    }));
    await rm(path.join(activeDir, taskId), { force: true });
    await rm(path.join(repoRoot, 'AgentWorkSpace/pendingitems', `${taskId}.md`), { force: true });
    await rm(path.join(repoRoot, 'AgentWorkSpace/tasks', taskId, '.task.json'), { force: true });

    await completePendingItem({
      repoRoot,
      taskId,
      skipValidation: true,
      skipArchive: true,
      recoveryArchivePath: '/archive/tasks/2026/child/archive.md',
      contextPackDir: path.join(repoRoot, 'context-pack'),
    });

    expect(parseRecoveredChildTaskChainCloseoutMock).toHaveBeenCalledWith(expect.objectContaining({ taskId }));
    expect(prepareChildTaskChainCloseoutMock).not.toHaveBeenCalled();
    expect(attachCompletedBranchHandoffsMock).not.toHaveBeenCalled();
    expect(advanceCompletedChildTaskChainMock).toHaveBeenCalledWith(repoRoot, expect.objectContaining({
      source: 'recovered',
      taskId,
      completedBranchHandoffs: [expect.objectContaining({ chainSourceBranch: 'task/root' })],
    }));
    expect(existsSync(path.join(activeDir, `${taskId}.completing`))).toBe(false);
  });

  it('keeps registry transition best-effort for standard tasks', async () => {
    const taskId = 'standard';
    await seedActiveTask(repoRoot, taskId, '# standard\n');
    prepareChildTaskChainCloseoutMock.mockResolvedValue(null);
    transitionTaskMock.mockRejectedValueOnce(new Error('registry down'));

    await completePendingItem({ repoRoot, taskId, skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') });

    expect(advanceCompletedChildTaskChainMock).not.toHaveBeenCalled();
    expect(activateNextPendingItemIfReadyMock).toHaveBeenCalledOnce();
  });
});

async function seedActiveTask(repoRoot: string, taskId: string, markdown: string): Promise<void> {
  const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
  const activeDir = path.join(pendingDir, '.active-items');
  const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs');
  await mkdir(activeDir, { recursive: true });
  await mkdir(handoffsDir, { recursive: true });
  await mkdir(path.join(repoRoot, 'context-pack'), { recursive: true });
  await writeFile(path.join(pendingDir, `${taskId}.md`), markdown);
  await writeFile(path.join(activeDir, taskId), `${taskId}.md`);
  await writeFile(path.join(handoffsDir, 'professional-task.md'), '# Task\n');
  await writeFile(path.join(handoffsDir, 'implementation-spec.md'), '# Spec\n');
  await writeFile(path.join(handoffsDir, 'retrospective-input.md'), '# Retro\n\n- Retrospective Required: false\n');
  await writeFile(path.join(handoffsDir, 'final-summary.md'), '# Final\n');
  await writeFile(path.join(handoffsDir, 'issues.md'), '# Issues\n');
}

async function seedTaskJson(
  repoRoot: string,
  taskId: string,
  repoBindings: Array<{
    originalRoot: string;
    worktreeRoot: string;
    worktreeBranch: string;
    baseCommitSha: string;
  }>,
): Promise<void> {
  const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
  await mkdir(taskDir, { recursive: true });
  await writeFile(path.join(taskDir, '.task.json'), JSON.stringify({
    schema_version: 2,
    taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings,
    },
    materialization: { strategy: 'copy', cloned: [], skipped: [] },
    frozenAt: '2026-05-19T12:00:00.000Z',
    finalizedAt: null,
    state: 'active',
  }, null, 2));
}

async function createRepo(repoRoot: string, label: string, branch: string): Promise<{ root: string; baseCommitSha: string }> {
  const root = path.join(repoRoot, label);
  await mkdir(root, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(root, 'README.md'), '# base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'base']);
  const baseCommitSha = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', '-b', branch]);
  await writeFile(path.join(root, `${label}.txt`), 'child\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'child']);
  git(root, ['checkout', '-q', 'main']);
  return { root, baseCommitSha };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function childMarkdown(): string {
  return [
    '# child',
    '',
    '## Task Lineage',
    '',
    '- Task Kind: child-task',
    '- Parent Task ID: root',
    '- Root Task ID: root',
    '- Depth: 1',
  ].join('\n');
}

function preparedCloseout() {
  return {
    schemaVersion: 1 as const,
    source: 'fresh' as const,
    taskId: 'child',
    rootTaskId: 'root',
    parentTaskId: 'root',
    previousTaskId: 'root',
    depth: 1,
    branchChain: {
      schemaVersion: 1 as const,
      mode: 'continuation' as const,
      rootTaskId: 'root',
      parentTaskId: 'root',
      depth: 1,
      repos: [],
    },
    archivePath: null,
    archiveArtifactDir: null,
    completedBranchHandoffs: [],
    preparedAt: '2026-05-19T12:00:00.000Z',
  };
}
