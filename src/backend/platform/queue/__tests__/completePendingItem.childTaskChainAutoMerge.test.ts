import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHILD_CHAIN_AUTO_MERGE_SKIP_MESSAGE } from '../childTaskChainCloseoutValidation.js';
import type { AutoMergeResult } from '../autoMerge.js';
import type { TaskRepoBinding } from '../taskJson.js';

const tempRepos: string[] = [];

const {
  commitTaskSnapshotMock,
  verifyTaskBranchesMock,
  stageAutoMergeCloseoutMock,
  getPlatformConfigMock,
  prepareChildTaskChainCloseoutMock,
  attachCompletedBranchHandoffsMock,
  advanceCompletedChildTaskChainMock,
  activateNextPendingItemIfReadyMock,
} = vi.hoisted(() => ({
  commitTaskSnapshotMock: vi.fn().mockResolvedValue(true),
  verifyTaskBranchesMock: vi.fn().mockResolvedValue({ ok: true, failures: [] }),
  stageAutoMergeCloseoutMock: vi.fn(),
  getPlatformConfigMock: vi.fn(),
  prepareChildTaskChainCloseoutMock: vi.fn(),
  attachCompletedBranchHandoffsMock: vi.fn((prepared) => prepared),
  advanceCompletedChildTaskChainMock: vi.fn().mockResolvedValue({ schemaVersion: 1 }),
  activateNextPendingItemIfReadyMock: vi.fn().mockResolvedValue({ activated: false }),
}));

vi.mock('../archive.js', () => ({
  fileTaskArchive: vi.fn().mockResolvedValue({
    passed: true,
    stdout: '{}',
    stderr: '',
    exitCode: 0,
    data: { record_md_path: '/archive/child/archive.md' },
  }),
}));
vi.mock('../policyValidation.js', () => ({ assertPolicyPasses: vi.fn() }));
vi.mock('../errorItems.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../errorItems.js')>()),
  commitTaskSnapshot: commitTaskSnapshotMock,
}));
vi.mock('../branchVerification.js', () => ({ verifyTaskBranches: verifyTaskBranchesMock }));
vi.mock('../autoMerge.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../autoMerge.js')>()),
  stageAutoMergeCloseout: stageAutoMergeCloseoutMock,
}));
vi.mock('../../core/worktreeFinalize.js', () => ({ finalizeTaskWorktrees: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../platform-config/get.js', () => ({ getPlatformConfig: getPlatformConfigMock }));
vi.mock('../../agent-runner/pipeline/remediation.js', () => ({
  buildAdvisoryFindingSection: vi.fn().mockResolvedValue(null),
  ADVISORY_FINDING_HEADING: '## QA Advisory Finding',
}));
vi.mock('../operations.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../operations.js')>()),
  activateNextPendingItemIfReady: activateNextPendingItemIfReadyMock,
}));
vi.mock('../childTaskChainCloseout.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../childTaskChainCloseout.js')>()),
  prepareChildTaskChainCloseout: prepareChildTaskChainCloseoutMock,
  attachCompletedBranchHandoffs: attachCompletedBranchHandoffsMock,
  advanceCompletedChildTaskChain: advanceCompletedChildTaskChainMock,
}));

import { completePendingItem } from '../completePendingItem.js';

describe('completePendingItem child-chain auto-merge policy', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'complete-chain-auto-merge-'));
    vi.clearAllMocks();
    getPlatformConfigMock.mockResolvedValue(platformConfig(true));
    stageAutoMergeCloseoutMock.mockImplementation(async ({ enabled, bindings }: { enabled: boolean; bindings: TaskRepoBinding[] }): Promise<AutoMergeResult> => ({
      enabled,
      applied: false,
      results: bindings.map((binding) => ({
        originalRoot: binding.originalRoot,
        repoLabel: path.basename(binding.originalRoot),
        targetBranch: enabled ? 'main' : null,
        sourceBranch: binding.worktreeBranch,
        status: enabled ? 'skipped-merge-not-needed' : 'disabled',
        detail: enabled ? 'No merge needed.' : 'Auto-merge is disabled.',
      })),
    }));
    prepareChildTaskChainCloseoutMock.mockResolvedValue(null);
    attachCompletedBranchHandoffsMock.mockImplementation((prepared) => prepared);
    advanceCompletedChildTaskChainMock.mockResolvedValue({ schemaVersion: 1 });
    activateNextPendingItemIfReadyMock.mockResolvedValue({ activated: false });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    for (const repo of tempRepos.splice(0)) {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('forces valid Branch Chain child closeout auto-merge disabled and records child-chain detail', async () => {
    const taskId = 'child';
    const repo = createRepo('child');
    const binding = taskBinding(repo, 'task/root');
    seedActiveTask(repoRoot, taskId, '# child\n');
    seedTaskJson(repoRoot, taskId, binding);
    prepareChildTaskChainCloseoutMock.mockResolvedValue(preparedCloseout(taskId, repo, 'task/root'));

    await completePendingItem({ repoRoot, taskId, skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') });

    expect(stageAutoMergeCloseoutMock).toHaveBeenCalledWith({ enabled: false, bindings: [binding] });
    expect(advanceCompletedChildTaskChainMock).toHaveBeenCalledOnce();
    const handoffs = JSON.parse(readFileSync(path.join(repoRoot, 'AgentWorkSpace/tasks/child/handoffs/branch-handoffs.json'), 'utf-8'));
    expect(handoffs[0]).toEqual(expect.objectContaining({
      branch: 'task/root',
      status: 'ready-for-operator-review',
      auto_merge: expect.objectContaining({
        enabled: false,
        status: 'disabled',
        detail: CHILD_CHAIN_AUTO_MERGE_SKIP_MESSAGE,
      }),
    }));
    const terminalEvents = JSON.parse(readFileSync(path.join(repoRoot, '.platform-state/runtime/tasks/child/terminal-events.json'), 'utf-8')).events;
    expect(terminalEvents.filter((event: { eventId: string }) => event.eventId === 'auto_merge.skipped_child_chain')).toHaveLength(1);
  });

  it('keeps standard and legacy child auto-merge behavior enabled when platform config enables it', async () => {
    const standardRepo = createRepo('standard');
    seedActiveTask(repoRoot, 'standard', '# standard\n');
    seedTaskJson(repoRoot, 'standard', taskBinding(standardRepo, 'task/standard'));
    prepareChildTaskChainCloseoutMock.mockResolvedValueOnce(null);

    await completePendingItem({ repoRoot, taskId: 'standard', skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') });

    const legacyRepo = createRepo('legacy');
    seedActiveTask(repoRoot, 'legacy', '# legacy child without Branch Chain\n');
    seedTaskJson(repoRoot, 'legacy', taskBinding(legacyRepo, 'task/legacy'));
    prepareChildTaskChainCloseoutMock.mockResolvedValueOnce(null);

    await completePendingItem({ repoRoot, taskId: 'legacy', skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') });

    expect(stageAutoMergeCloseoutMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ enabled: true }));
    expect(stageAutoMergeCloseoutMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ enabled: true }));
  });

  it('uses existing disabled logging when chained child platform auto-merge is disabled', async () => {
    const taskId = 'child-disabled';
    const repo = createRepo('child-disabled');
    seedActiveTask(repoRoot, taskId, '# child\n');
    seedTaskJson(repoRoot, taskId, taskBinding(repo, 'task/root'));
    prepareChildTaskChainCloseoutMock.mockResolvedValue(preparedCloseout(taskId, repo, 'task/root'));
    getPlatformConfigMock.mockResolvedValue(platformConfig(false));

    await completePendingItem({ repoRoot, taskId, skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') });

    expect(stageAutoMergeCloseoutMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    const terminalEvents = JSON.parse(readFileSync(path.join(repoRoot, `.platform-state/runtime/tasks/${taskId}/terminal-events.json`), 'utf-8')).events;
    expect(terminalEvents.some((event: { eventId: string }) => event.eventId === 'auto_merge.skipped_child_chain')).toBe(false);
    expect(terminalEvents.some((event: { eventId: string }) => event.eventId === 'auto_merge.disabled')).toBe(true);
  });

  it('blocks closeout side effects when the child-chain source branch is missing', async () => {
    const taskId = 'missing-source';
    const repo = createRepo('missing-source');
    seedActiveTask(repoRoot, taskId, '# child\n');
    seedTaskJson(repoRoot, taskId, taskBinding(repo, 'task/root'));
    prepareChildTaskChainCloseoutMock.mockResolvedValue(preparedCloseout(taskId, repo, 'task/root'));
    git(repo, ['branch', '-D', 'task/root']);

    await expect(completePendingItem({ repoRoot, taskId, skipValidation: true, contextPackDir: path.join(repoRoot, 'context-pack') }))
      .rejects.toThrow('Completion blocked: child task chain source branch task/root is missing');

    expect(commitTaskSnapshotMock).not.toHaveBeenCalled();
    expect(verifyTaskBranchesMock).not.toHaveBeenCalled();
    expect(stageAutoMergeCloseoutMock).not.toHaveBeenCalled();
    expect(advanceCompletedChildTaskChainMock).not.toHaveBeenCalled();
    expect(activateNextPendingItemIfReadyMock).not.toHaveBeenCalled();
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace/tasks/missing-source/handoffs/branch-handoffs.json'))).toBe(false);
  });
});

function seedActiveTask(root: string, taskId: string, markdown: string): void {
  const pendingDir = path.join(root, 'AgentWorkSpace', 'pendingitems');
  const activeDir = path.join(pendingDir, '.active-items');
  const handoffsDir = path.join(root, 'AgentWorkSpace', 'tasks', taskId, 'handoffs');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(handoffsDir, { recursive: true });
  mkdirSync(path.join(root, 'context-pack'), { recursive: true });
  writeFileSync(path.join(pendingDir, `${taskId}.md`), markdown);
  writeFileSync(path.join(activeDir, taskId), `${taskId}.md`);
  for (const name of ['professional-task.md', 'implementation-spec.md', 'final-summary.md', 'issues.md']) {
    writeFileSync(path.join(handoffsDir, name), `# ${name}\n`);
  }
  writeFileSync(path.join(handoffsDir, 'retrospective-input.md'), '# Retro\n\n- Retrospective Required: false\n');
}

function seedTaskJson(root: string, taskId: string, binding: TaskRepoBinding): void {
  const taskDir = path.join(root, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({
    schema_version: 2,
    taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: [binding],
    },
    materialization: { strategy: 'copy', cloned: [], skipped: [] },
    frozenAt: '2026-05-22T12:00:00.000Z',
    finalizedAt: null,
    state: 'active',
  }, null, 2));
}

function createRepo(label: string): string {
  const repo = mkdtempSync(path.join(tmpdir(), `complete-chain-${label}-`));
  tempRepos.push(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  writeFileSync(path.join(repo, 'README.md'), '# base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  git(repo, ['checkout', '-q', '-b', `task/${label === 'child' || label === 'child-disabled' || label === 'missing-source' ? 'root' : label}`]);
  writeFileSync(path.join(repo, `${label}.txt`), 'child\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'task']);
  git(repo, ['checkout', '-q', 'main']);
  return repo;
}

function taskBinding(repo: string, branch: string): TaskRepoBinding {
  return {
    originalRoot: repo,
    worktreeRoot: path.join(repo, '.task-worktree'),
    worktreeBranch: branch,
    baseCommitSha: git(repo, ['rev-list', '--max-parents=0', 'HEAD']),
  };
}

function preparedCloseout(taskId: string, repo: string, chainSourceBranch: string) {
  return {
    schemaVersion: 1 as const,
    source: 'fresh' as const,
    taskId,
    rootTaskId: 'root',
    parentTaskId: 'parent',
    previousTaskId: 'parent',
    depth: 1,
    branchChain: {
      schemaVersion: 1 as const,
      mode: 'continuation' as const,
      rootTaskId: 'root',
      parentTaskId: 'parent',
      depth: 1,
      repos: [{
        repoRoot: repo,
        repoLabel: 'platform',
        chainSourceBranch,
        parentSourceBranch: 'task/parent',
        parentBranchHead: 'parent-head',
        targetBranch: 'main',
      }],
    },
    archivePath: null,
    archiveArtifactDir: null,
    completedBranchHandoffs: [],
    preparedAt: '2026-05-22T12:00:00.000Z',
  };
}

function platformConfig(autoMerge: boolean) {
  return {
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
    auto_merge: autoMerge,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
