import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { formatBranchChainSection, type TaskBranchChainBinding } from '../markdown.js';
import { HANDOFF_FILES, SLICE_TEMPLATE_FILENAME, resolveQueuePaths } from '../paths.js';
import { registerTask, loadTaskRegistry, transitionTask } from '../taskRegistry.js';
import { writeQueueOrderManifest } from '../queueOrderManifest.js';

const startPipeline = vi.fn();

vi.mock('../../agent-runner/pipelineSupervisor.js', () => ({
  startPipeline,
}));

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf-8' }).trim();
}

function initGitRepo(repoRoot: string): void {
  mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'test@example.com']);
  git(repoRoot, ['config', 'user.name', 'Test User']);
  writeFileSync(path.join(repoRoot, 'README.md'), '# repo\n', 'utf-8');
  writeFileSync(path.join(repoRoot, '.gitignore'), 'AgentWorkSpace/\n.platform-state/\n', 'utf-8');
  git(repoRoot, ['add', 'README.md', '.gitignore']);
  git(repoRoot, ['commit', '-m', 'initial']);
}

function seedTemplates(templatesDir: string): void {
  mkdirSync(templatesDir, { recursive: true });
  for (const filename of HANDOFF_FILES) {
    writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`, 'utf-8');
  }
  writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n', 'utf-8');
}

function writePlatformConfig(repoRoot: string): void {
  mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
  writeFileSync(path.join(repoRoot, '.platform-state', 'platform.json'), JSON.stringify({
    schema_version: 1,
    cli_provider: 'copilot',
    container_runtime: 'podman',
    max_parallel_tasks: 2,
    retain_failed_task_worktrees: true,
    max_retained_failed_task_worktrees: 10,
    max_retry_generations_per_slug: 5,
    completed_task_runtime_retention_ms: 3600000,
    mcp_port: 8811,
    repo_context_mcp_external_mount_roots: [],
  }), 'utf-8');
}

function branchChain(repoRoot: string, sourceBranch = 'task/root'): TaskBranchChainBinding {
  return {
    schemaVersion: 1,
    mode: 'continuation',
    rootTaskId: 'root-task',
    parentTaskId: 'parent-task',
    depth: 1,
    repos: [{
      repoRoot,
      repoLabel: path.basename(repoRoot),
      chainSourceBranch: sourceBranch,
      parentSourceBranch: sourceBranch,
      parentBranchHead: git(repoRoot, ['rev-parse', 'HEAD']),
      targetBranch: 'main',
    }],
  };
}

function childMarkdown(repoRoot: string, taskId: string, sourceBranch = 'task/root'): string {
  return [
    `# ${taskId}`,
    '',
    '## Task Lineage',
    '',
    '- Task Kind: child-task',
    '- Parent Task ID: parent-task',
    '- Root Task ID: root-task',
    '',
    formatBranchChainSection(branchChain(repoRoot, sourceBranch)),
  ].join('\n');
}

function standardMarkdown(taskId: string): string {
  return `# ${taskId}\n`;
}

function writeActiveSidecar(repoRoot: string, taskId: string, worktreeBranch: string): void {
  const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({
    schema_version: 2,
    taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: [{
        originalRoot: repoRoot,
        worktreeRoot: path.join(taskDir, 'worktrees', path.basename(repoRoot)),
        worktreeBranch,
        baseCommitSha: git(repoRoot, ['rev-parse', 'HEAD']),
      }],
    },
    materialization: { strategy: 'copy', cloned: [], skipped: [] },
    frozenAt: '2026-05-19T00:00:00Z',
    finalizedAt: null,
    state: 'active',
  }, null, 2), 'utf-8');
}

async function registerPending(repoRoot: string, taskId: string): Promise<void> {
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
    createdAt: '2026-05-19T00:00:00Z',
    completedAt: null,
    archivePath: null,
  });
}

describe('active branch conflict guard activation integration', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.stubEnv('TASKSAIL_DISABLE_PIPELINE_AUTOSTART', 'true');
    startPipeline.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  it('returns a conflicted chained child to open without creating activation artifacts', async () => {
    const repoRoot = tempDir('branch-conflict-integration-');
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root']);
    writePlatformConfig(repoRoot);
    const paths = resolveQueuePaths(repoRoot);
    seedTemplates(paths.templatesDir);
    mkdirSync(paths.pendingDir, { recursive: true });
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activeItemsDir, 'active-a'), 'active-a.md', 'utf-8');
    writeActiveSidecar(repoRoot, 'active-a', 'task/root');
    writeFileSync(path.join(paths.pendingDir, 'child-a.md'), childMarkdown(repoRoot, 'child-a'), 'utf-8');
    await writeQueueOrderManifest(paths.queueOrderPath, ['child-a.md']);
    await registerPending(repoRoot, 'child-a');

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths, repoRoot })).resolves.toEqual({
      activated: false,
      reason: 'branch-conflict-returned-open',
    });

    expect(existsSync(path.join(paths.pendingDir, 'child-a.md'))).toBe(false);
    expect(existsSync(path.join(paths.dropboxDir, 'child-a.md'))).toBe(true);
    expect(existsSync(path.join(paths.errorItemsDir, 'child-a.md'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'child-a'))).toBe(false);
    expect(existsSync(path.join(paths.activeItemsDir, 'child-a'))).toBe(false);
    expect(git(repoRoot, ['branch', '--list', 'task/child-a'])).toBe('');
    expect(startPipeline).not.toHaveBeenCalled();
    expect(readRuntimeEvents(repoRoot, 'child-a')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: 'queue.active.skipped:branch-conflict-returned-open',
          severity: 'warning',
        }),
        expect.objectContaining({
          eventId: 'activation.returned-open.branch-conflict:task/root:active-a',
          severity: 'warning',
        }),
      ]),
    );
    const registry = await loadTaskRegistry(repoRoot);
    expect(registry.tasks._unbound?.open.map((entry) => entry.taskId)).toContain('child-a');

    rmSync(path.join(paths.activeItemsDir, 'active-a'), { force: true });
    rmSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'active-a'), { recursive: true, force: true });
    renameSync(path.join(paths.dropboxDir, 'child-a.md'), path.join(paths.pendingDir, 'child-a.md'));
    await writeQueueOrderManifest(paths.queueOrderPath, ['child-a.md']);
    await transitionTask(repoRoot, 'child-a', 'open', 'pending');

    const { activateNextPendingItemIfReady: activateAgain } = await import('../operations.js');
    await expect(activateAgain({ paths, repoRoot })).resolves.toEqual({
      activated: true,
      activatedTaskId: 'child-a',
    });
    expect(JSON.parse(readFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'child-a', '.task.json'), 'utf-8'))
      .contextPackBinding.repoBindings[0].worktreeBranch).toBe('task/root');
  });

  it('returns a conflicted first candidate and activates a later unrelated task in the same call', async () => {
    const repoRoot = tempDir('branch-conflict-next-');
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root']);
    writePlatformConfig(repoRoot);
    const paths = resolveQueuePaths(repoRoot);
    seedTemplates(paths.templatesDir);
    mkdirSync(paths.pendingDir, { recursive: true });
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activeItemsDir, 'active-a'), 'active-a.md', 'utf-8');
    writeActiveSidecar(repoRoot, 'active-a', 'task/root');
    writeFileSync(path.join(paths.pendingDir, 'child-a.md'), childMarkdown(repoRoot, 'child-a'), 'utf-8');
    writeFileSync(path.join(paths.pendingDir, 'later-a.md'), standardMarkdown('later-a'), 'utf-8');
    await writeQueueOrderManifest(paths.queueOrderPath, ['child-a.md', 'later-a.md']);
    await registerPending(repoRoot, 'child-a');
    await registerPending(repoRoot, 'later-a');

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths, repoRoot })).resolves.toEqual({
      activated: true,
      activatedTaskId: 'later-a',
    });

    expect(existsSync(path.join(paths.dropboxDir, 'child-a.md'))).toBe(true);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'child-a'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'later-a', '.task.json'))).toBe(true);
    expect(readFileSync(path.join(paths.activeItemsDir, 'later-a'), 'utf-8')).toBe('later-a.md');
    expect(startPipeline).not.toHaveBeenCalled();
  });

  it('does not treat an active target branch as a chained child source conflict', async () => {
    const repoRoot = tempDir('branch-conflict-target-main-');
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root']);
    writePlatformConfig(repoRoot);
    const paths = resolveQueuePaths(repoRoot);
    seedTemplates(paths.templatesDir);
    mkdirSync(paths.pendingDir, { recursive: true });
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activeItemsDir, 'active-main'), 'active-main.md', 'utf-8');
    writeActiveSidecar(repoRoot, 'active-main', 'main');
    writeFileSync(path.join(paths.pendingDir, 'child-a.md'), childMarkdown(repoRoot, 'child-a'), 'utf-8');
    await writeQueueOrderManifest(paths.queueOrderPath, ['child-a.md']);
    await registerPending(repoRoot, 'child-a');

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths, repoRoot })).resolves.toEqual({
      activated: true,
      activatedTaskId: 'child-a',
    });
    const sidecar = JSON.parse(readFileSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'child-a', '.task.json'), 'utf-8'));
    expect(sidecar.contextPackBinding.repoBindings[0].worktreeBranch).toBe('task/root');
  });

  it('returns a standard task to open only when an active sidecar owns task/<taskId>', async () => {
    const repoRoot = tempDir('branch-conflict-standard-');
    initGitRepo(repoRoot);
    writePlatformConfig(repoRoot);
    const paths = resolveQueuePaths(repoRoot);
    seedTemplates(paths.templatesDir);
    mkdirSync(paths.pendingDir, { recursive: true });
    mkdirSync(paths.activeItemsDir, { recursive: true });
    writeFileSync(path.join(paths.activeItemsDir, 'active-standard'), 'active-standard.md', 'utf-8');
    writeActiveSidecar(repoRoot, 'active-standard', 'task/standard-a');
    writeFileSync(path.join(paths.pendingDir, 'standard-a.md'), standardMarkdown('standard-a'), 'utf-8');
    await writeQueueOrderManifest(paths.queueOrderPath, ['standard-a.md']);
    await registerPending(repoRoot, 'standard-a');

    const { activateNextPendingItemIfReady } = await import('../operations.js');
    await expect(activateNextPendingItemIfReady({ paths, repoRoot })).resolves.toEqual({
      activated: false,
      reason: 'branch-conflict-returned-open',
    });

    expect(existsSync(path.join(paths.dropboxDir, 'standard-a.md'))).toBe(true);
    expect(existsSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'standard-a'))).toBe(false);
    expect(git(repoRoot, ['branch', '--list', 'task/standard-a'])).toBe('');
  });
});

function readRuntimeEvents(repoRoot: string, taskId: string): Array<Record<string, unknown>> {
  const eventPath = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId, 'terminal-events.json');
  return JSON.parse(readFileSync(eventPath, 'utf-8')).events;
}
